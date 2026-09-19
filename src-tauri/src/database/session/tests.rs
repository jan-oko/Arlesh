use super::super::DatabasePool;
use super::*;
use sqlx::sqlite::SqlitePoolOptions;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

/// Distinguishes the scratch databases of tests running concurrently in one process.
static NEXT_DATABASE: AtomicU32 = AtomicU32::new(0);

/// A throwaway database with one `scratch` table, deleted when the test drops it.
///
/// It is **file-backed**, which these tests need for two reasons. Observing whether one
/// session's writes are visible to another requires two connections onto the *same*
/// database, and plain `sqlite::memory:` gives each connection a private one — a second
/// connection there reads a different database entirely, so an isolation assertion would
/// pass for the wrong reason. A named shared-cache in-memory database (`mode=memory&
/// cache=shared`) does share correctly, but shared-cache locking is table-level and has no
/// WAL: a reader on the second connection blocks indefinitely while the first holds an open
/// write transaction, which is exactly the state under test. A file-backed database gets
/// sqlx's default WAL journal, where a reader never blocks on a writer and simply sees the
/// last committed snapshot.
struct ScratchDatabase {
    /// Connections onto the scratch database.
    pool: DatabasePool,
    /// Where the database file lives, so it can be removed again.
    path: PathBuf,
}

impl ScratchDatabase {
    /// Creates the database and its `scratch` table, allowing `max_connections` at once.
    async fn open(max_connections: u32) -> Self {
        let path = std::env::temp_dir().join(format!(
            "arlesh-session-test-{}-{}.db",
            std::process::id(),
            NEXT_DATABASE.fetch_add(1, Ordering::Relaxed)
        ));
        // `mode=rwc` opens an existing file rather than failing, so a database leaked by an
        // aborted earlier run would be reused once the OS recycles that pid — and the
        // `CREATE TABLE` below would then panic on a table that already exists.
        remove_database_files(&path);
        let pool = SqlitePoolOptions::new()
            .max_connections(max_connections)
            .connect(&format!("sqlite://{}?mode=rwc", path.display()))
            .await
            .expect("failed to open scratch SQLite database");

        sqlx::query("CREATE TABLE scratch (value TEXT NOT NULL)")
            .execute(&pool)
            .await
            .expect("failed to create scratch table");

        Self { pool, path }
    }

    /// Counts scratch rows over a connection the session under test does not hold.
    async fn rows_seen_by_others(&self) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM scratch")
            .fetch_one(&self.pool)
            .await
            .expect("failed to count scratch rows")
    }

    /// A factory over this database, as the application would build one.
    fn factory(&self) -> SessionFactory {
        SessionFactory::new(self.pool.clone())
    }
}

impl Drop for ScratchDatabase {
    fn drop(&mut self) {
        remove_database_files(&self.path);
    }
}

/// Deletes a scratch database and the WAL sidecars sqlx creates beside it, if they exist.
fn remove_database_files(path: &std::path::Path) {
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
    }
}

#[tokio::test]
async fn a_transactional_session_hides_its_writes_until_commit() {
    let database = ScratchDatabase::open(2).await;
    let factory = database.factory();

    let mut session = factory.begin().await.expect("begin failed");
    sqlx::query("INSERT INTO scratch (value) VALUES ('pending')")
        .execute(session.connection())
        .await
        .expect("insert failed");

    assert_eq!(
        database.rows_seen_by_others().await,
        0,
        "an uncommitted write must not be visible on another connection"
    );

    session.commit().await.expect("commit failed");

    assert_eq!(
        database.rows_seen_by_others().await,
        1,
        "a committed write must be visible on another connection"
    );
}

#[tokio::test]
async fn a_transactional_session_dropped_without_commit_writes_nothing() {
    // One connection only: the read afterwards is forced onto the very connection the
    // abandoned transaction used, so it proves the rollback was applied rather than merely
    // that the write is not yet visible elsewhere.
    let database = ScratchDatabase::open(1).await;
    let factory = database.factory();

    {
        let mut session = factory.begin().await.expect("begin failed");
        sqlx::query("INSERT INTO scratch (value) VALUES ('abandoned')")
            .execute(session.connection())
            .await
            .expect("insert failed");
        // Dropped here without `commit`, which is the sharpest edge of this design.
    }

    assert_eq!(
        database.rows_seen_by_others().await,
        0,
        "a session dropped without commit must leave nothing behind"
    );
}

#[tokio::test]
async fn a_pooled_session_writes_immediately() {
    let database = ScratchDatabase::open(2).await;
    let factory = database.factory();

    let mut session = factory.connect().await.expect("connect failed");
    sqlx::query("INSERT INTO scratch (value) VALUES ('committed')")
        .execute(session.connection())
        .await
        .expect("insert failed");

    assert_eq!(
        database.rows_seen_by_others().await,
        1,
        "a pooled session has no transaction to hold its write back"
    );
}
