//! Database connection and migration management.

pub mod session;

use std::time::Duration;

use sqlx::sqlite::SqlitePoolOptions;
use sqlx::{SqliteConnection, SqlitePool};

/// Shared connection pool type used throughout the application.
pub type DatabasePool = SqlitePool;

/// How long a connection waits for a lock another connection holds before giving up.
///
/// It is set here rather than left to sqlx's identical default because the value is part of this
/// application's concurrency argument, not the driver's: a mindmap load can hold the writer lock
/// for a fifth of a second while it mints the scope rows a daily Habit's iterations land on, and
/// the two or more loads a single startup fires have to be willing to queue behind each other.
/// Five seconds is twenty such loads, and far short of a wait a user would read as a hang.
///
/// The timeout is not a cure on its own: SQLite skips the busy handler entirely when a
/// transaction that already holds a read lock asks for the writer lock, because waiting there
/// could deadlock. That is what [`session::SessionFactory::begin`] is for.
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// Opens a SQLite connection pool at the given file path.
pub async fn connect(database_url: &str) -> anyhow::Result<DatabasePool> {
    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .after_connect(|conn, _meta| Box::pin(apply_connection_settings(conn)))
        .connect(database_url)
        .await?;
    Ok(pool)
}

/// Applies the settings every connection onto an Arlesh database needs, in the order it needs
/// them.
///
/// Reachable from the crate rather than sealed inside [`connect`]'s closure so that a test can
/// build a pool of its own size and still be testing the real configuration. Nothing outside the
/// database module should call it: a connection that skipped it would enforce no foreign keys and
/// would read a different journal from everyone else.
///
/// # Why each one
///
/// **`busy_timeout`** installs the handler that makes a lock wait rather than fail. It goes
/// first, because the two pragmas after it are themselves statements that can meet a lock.
///
/// **`foreign_keys`** is SQLite's own default-off setting, and the schema depends on it being on:
/// `migrations/0030_undo_journal.sql` reasons explicitly about foreign keys being enforced here.
///
/// **`journal_mode`** is set explicitly because sqlx deliberately does not set it — see its
/// `SqliteConnectOptions::default`, "Don't set `journal_mode` unless the user requested it" — so
/// a database sqlx creates is left in SQLite's own default, `delete`, the rollback journal. Under
/// a rollback journal a writer excludes every reader and a reader excludes every writer, so two
/// concurrent commands on an eight-connection pool contend over the whole file. Under WAL a
/// reader never blocks on a writer and a writer never blocks on a reader; writers are still
/// serialised against each other, which is the guarantee the undo journal's suppression flag
/// rests on (see `docs/spec/undo.md`).
///
/// WAL is **not** what fixes the read-then-write collision `Arlesh-odd` reported, and it should
/// not be mistaken for it. Measured against the regression test in `session/tests.rs`: with WAL
/// and a deferred `BEGIN` the collision still fails, only with `SQLITE_BUSY_SNAPSHOT` (517) in
/// place of `SQLITE_BUSY` (5); with a rollback journal and an immediate `BEGIN` it passes.
/// [`session::SessionFactory::begin`] is the fix. WAL is here for the reader/writer independence
/// — a mindmap load can hold the writer lock for a fifth of a second, and under a rollback
/// journal every concurrent read waits it out and its own commit waits for every reader.
///
/// Journal mode is a property of the **database file**, not of a connection: the first connection
/// to a `delete`-mode database converts it, every connection afterwards finds it already `wal`
/// and the pragma is a no-op that takes no lock. It is therefore set at connect time and not by a
/// migration — sqlx runs each migration inside a transaction, and SQLite refuses to change
/// journal mode inside one.
///
/// `synchronous` is deliberately left alone. SQLite's compiled-in default is `FULL`, which in WAL
/// mode fsyncs the log at every commit, so durability is what it was under the rollback journal.
/// The visible change is on disk: a WAL database is three files, `arlesh.db` plus `-wal` and
/// `-shm` sidecars, and copying only the first of them loses whatever has not been checkpointed.
pub(crate) async fn apply_connection_settings(
    connection: &mut SqliteConnection,
) -> Result<(), sqlx::Error> {
    let busy_timeout_ms = BUSY_TIMEOUT.as_millis();
    sqlx::query(&format!("PRAGMA busy_timeout = {busy_timeout_ms}"))
        .execute(&mut *connection)
        .await?;

    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&mut *connection)
        .await?;

    // `PRAGMA journal_mode = ...` answers with the mode in force afterwards, which is how a
    // refusal shows itself: SQLite reports the mode it kept rather than raising. An in-memory
    // database has no journal to switch and answers `memory`, which is not a refusal.
    let journal_mode: String = sqlx::query_scalar("PRAGMA journal_mode = WAL")
        .fetch_one(&mut *connection)
        .await?;
    if journal_mode != "wal" && journal_mode != "memory" {
        tracing::warn!(
            journal_mode = %journal_mode,
            "database refused WAL and stayed on a rollback journal: concurrent commands will contend"
        );
    }

    Ok(())
}

/// Runs all pending migrations against the pool.
pub async fn run_migrations(pool: &DatabasePool) -> anyhow::Result<()> {
    sqlx::migrate!("./migrations").run(pool).await?;
    Ok(())
}
