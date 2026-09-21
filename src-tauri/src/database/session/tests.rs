use super::super::{apply_connection_settings, DatabasePool, BUSY_TIMEOUT};
use super::*;
use sqlx::sqlite::SqlitePoolOptions;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::sync::Arc;

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
/// write transaction, which is exactly the state under test. A file-backed database in WAL
/// mode is the one arrangement where a reader never blocks on a writer and simply sees the
/// last committed snapshot.
///
/// It applies [`apply_connection_settings`], the very hook
/// [`crate::database::connect`] gives the application's pool, rather than taking sqlx's
/// defaults. That is load-bearing rather than tidy: sqlx deliberately leaves `journal_mode`
/// alone, so a scratch database opened without the hook is in `delete` mode and these tests
/// would be measuring a configuration the app does not run. Only `max_connections` differs,
/// because a test that wants to force two sessions onto one connection has to say so.
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
            .after_connect(|conn, _| Box::pin(apply_connection_settings(conn)))
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

/// Deletes a scratch database and the WAL sidecars that appear beside it, if they exist.
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

/// How many times a half of [`two_sessions_that_read_before_they_write_both_commit`] offers the
/// runtime a chance to advance its partner before giving up on the rendezvous.
///
/// A budget is needed because the rendezvous is unmeetable in exactly the case the fix produces:
/// with an immediate `BEGIN`, the second half is still waiting for the writer lock and cannot
/// reach the meeting point until the first half has committed. Before the fix the meeting point
/// is reached at once and the budget is never touched. Either way both halves arrive at their
/// `INSERT` with the other's session open or queued, which is the state under test — what differs
/// is whether the database lets the second one write.
///
/// Every iteration is a runtime poll, not a sleep, so exhausting the budget costs milliseconds.
const RENDEZVOUS_YIELDS: usize = 10_000;

/// Counts how many halves have taken their read, so each can wait for the other.
type Rendezvous = Arc<AtomicUsize>;

/// One half of the collision: a session that reads, waits for its partner to have read too, then
/// writes and commits. It is the shape of every composite operation in the crate, and of
/// `load_mindmap` in particular, which reads thirteen resource lists before it mints the first
/// scope row a Habit's iterations need.
async fn read_then_write(
    factory: &SessionFactory,
    value: &'static str,
    rendezvous: Rendezvous,
) -> Result<(), sqlx::Error> {
    let mut session = factory.begin().await?;

    let _: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM scratch")
        .fetch_one(session.connection())
        .await?;

    rendezvous.fetch_add(1, Ordering::SeqCst);
    for _ in 0..RENDEZVOUS_YIELDS {
        if rendezvous.load(Ordering::SeqCst) == 2 {
            break;
        }
        tokio::task::yield_now().await;
    }

    sqlx::query("INSERT INTO scratch (value) VALUES (?)")
        .bind(value)
        .execute(session.connection())
        .await?;

    session.commit().await
}

/// The regression test for `Arlesh-odd`: startup fires several whole-board loads at once, each of
/// which reads before it writes, and one of them used to die with `database is locked`.
///
/// With a deferred `BEGIN` both halves hold a read lock by the time either tries to write, and
/// SQLite refuses the second one's upgrade to a writer immediately — it skips the busy handler
/// there on purpose, because making a reader wait for a writer that is waiting for that reader is
/// a deadlock. No timeout and no journal mode can rescue that; only taking the writer lock at the
/// `BEGIN` can, which is what [`SessionFactory::begin`] now does. The two halves then queue
/// instead of colliding, and both of their writes land.
#[tokio::test]
async fn two_sessions_that_read_before_they_write_both_commit() {
    let database = ScratchDatabase::open(2).await;
    let factory = database.factory();
    let rendezvous: Rendezvous = Arc::new(AtomicUsize::new(0));

    let (first, second) = tokio::join!(
        read_then_write(&factory, "first", Arc::clone(&rendezvous)),
        read_then_write(&factory, "second", Arc::clone(&rendezvous)),
    );

    first.expect("the first session's read-then-write must not be refused");
    second.expect("the second session's read-then-write must not be refused");

    assert_eq!(
        database.rows_seen_by_others().await,
        2,
        "both sessions must have committed, not merely returned"
    );
}

/// Journal mode is a property of the database file and sqlx deliberately never sets it, so a
/// database sqlx creates stays on SQLite's own default rollback journal — where a writer excludes
/// every reader and a reader excludes every writer. The application sets it explicitly instead,
/// and the setting has to arrive with the connection rather than with a migration: sqlx runs each
/// migration inside a transaction, and SQLite refuses to change journal mode inside one.
#[tokio::test]
async fn a_file_database_is_put_into_wal_mode() {
    let database = ScratchDatabase::open(1).await;

    let journal_mode: String = sqlx::query_scalar("PRAGMA journal_mode")
        .fetch_one(&database.pool)
        .await
        .expect("failed to read journal_mode");

    assert_eq!(journal_mode, "wal");
}

/// The busy timeout is what turns "another session is writing" from a failure into a wait, and
/// with an immediate `BEGIN` it is the wait every second writer now takes. Asserting on the value
/// rather than merely on it being non-zero is the point: it is this application's number, not the
/// driver's, and a silent change to it changes how long a queued command hangs.
#[tokio::test]
async fn every_connection_gets_the_configured_busy_timeout() {
    let database = ScratchDatabase::open(1).await;

    let busy_timeout: i64 = sqlx::query_scalar("PRAGMA busy_timeout")
        .fetch_one(&database.pool)
        .await
        .expect("failed to read busy_timeout");

    assert_eq!(u128::try_from(busy_timeout), Ok(BUSY_TIMEOUT.as_millis()));
}
