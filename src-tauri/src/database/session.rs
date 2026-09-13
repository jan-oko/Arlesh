//! Database sessions: a factory owning the pool, and sessions owning one connection each.
//!
//! A pool's contract is "give me *any* free connection", while a transaction is a claim on
//! *one*: a `BEGIN` issued on one connection has no authority over writes sent to another. So
//! atomicity requires the connection to be chosen once, at an operation's boundary, and used by
//! every write beneath it. That is what a [`Db`] session is — one connection, held for the
//! session's whole life, reached only through the per-resource operators it hands out.
//!
//! [`SessionFactory`] is the single owner of the pool. [`SessionFactory::connect`] yields a
//! `Db<Pooled>` for ordinary single-statement work; [`SessionFactory::begin`] yields a
//! `Db<Transactional>`, on which — and only on which — [`Db::commit`] exists. The two are
//! distinct types, so an operation that requires atomicity says so in its signature and cannot
//! be handed a pooled session by mistake.
//!
//! See `docs/adr/0004-database-sessions-and-resource-operators.md`.

use std::ops::DerefMut;

use sqlx::pool::PoolConnection;
use sqlx::{Sqlite, SqliteConnection, Transaction};

use super::DatabasePool;
use crate::block_reasons::BlockReasonOperator;
use crate::domains::DomainOperator;
use crate::flows::FlowOperator;
use crate::infos::InfoOperator;
use crate::knowledge_base::{EventOperator, PersonOperator, ThreadOperator};
use crate::scopes::ScopeOperator;
use crate::tasks::{GoalOperator, TaskOperator};

/// How a [`Db`] session holds its one connection: see [`Pooled`] and [`Transactional`].
///
/// The two implementors are markers only — they carry no data and exist solely to give the two
/// session modes distinct types. Both handles dereference to [`SqliteConnection`], so every
/// resource operator is written once and serves both modes.
pub trait SessionMode {
    /// The owned connection handle a session in this mode keeps for its whole life.
    type Handle: DerefMut<Target = SqliteConnection> + Send;
}

/// A session holding one connection checked out of the pool, with no transaction open.
///
/// Each statement commits on its own. A `Db<Pooled>` has nothing to commit, and so has no
/// [`Db::commit`] method.
#[derive(Debug, Clone, Copy)]
pub struct Pooled;

/// A session holding one connection with a transaction open on it.
///
/// Writes are invisible to other connections until [`Db::commit`] is called, and are rolled back
/// if the session is dropped without it.
#[derive(Debug, Clone, Copy)]
pub struct Transactional;

impl SessionMode for Pooled {
    type Handle = PoolConnection<Sqlite>;
}

impl SessionMode for Transactional {
    type Handle = Transaction<'static, Sqlite>;
}

/// One database session, owning exactly one connection for its whole life.
///
/// Work is done through the per-resource operators the session hands out — `db.goals()`,
/// `db.tasks()`, `db.scopes()` and so on. Each accessor borrows the session mutably for the
/// duration of a single call, so operators are used inline (`db.goals().create(…).await?`) and
/// never stored: binding two at once is a compile error, because both would be borrowing the one
/// connection the session owns.
///
/// A composite operation that must be atomic takes `&mut Db<Transactional>`, and nested
/// operations join the caller's session rather than opening their own — only the outermost
/// caller decides the transaction boundary.
pub struct Db<M: SessionMode> {
    /// The one connection this session owns, either pooled or with a transaction open on it.
    handle: M::Handle,
}

impl<M: SessionMode> Db<M> {
    /// The one connection this session owns, as a plain sqlx executor.
    ///
    /// Private: callers reach the connection only through a resource operator, which is what
    /// keeps SQL out of the rest of the crate.
    fn connection(&mut self) -> &mut SqliteConnection {
        &mut self.handle
    }

    /// Block reasons — the reasons a task or goal is blocked.
    pub fn block_reasons(&mut self) -> BlockReasonOperator<'_> {
        BlockReasonOperator::new(self.connection())
    }

    /// Aspects, projects, domains and tags.
    pub fn domains(&mut self) -> DomainOperator<'_> {
        DomainOperator::new(self.connection())
    }

    /// Knowledge-base events.
    pub fn events(&mut self) -> EventOperator<'_> {
        EventOperator::new(self.connection())
    }

    /// Flow templates and their items, cycles, recurrences and instances.
    pub fn flows(&mut self) -> FlowOperator<'_> {
        FlowOperator::new(self.connection())
    }

    /// Goals — desired states.
    pub fn goals(&mut self) -> GoalOperator<'_> {
        GoalOperator::new(self.connection())
    }

    /// Free-standing notes attached to other resources.
    pub fn infos(&mut self) -> InfoOperator<'_> {
        InfoOperator::new(self.connection())
    }

    /// Knowledge-base people.
    pub fn people(&mut self) -> PersonOperator<'_> {
        PersonOperator::new(self.connection())
    }

    /// Seasons, months, weeks and days.
    pub fn scopes(&mut self) -> ScopeOperator<'_> {
        ScopeOperator::new(self.connection())
    }

    /// Tasks — action items.
    pub fn tasks(&mut self) -> TaskOperator<'_> {
        TaskOperator::new(self.connection())
    }

    /// Knowledge-base threads.
    pub fn threads(&mut self) -> ThreadOperator<'_> {
        ThreadOperator::new(self.connection())
    }
}

impl Db<Transactional> {
    /// Commits everything written through this session and releases its connection.
    ///
    /// Consumes the session, so nothing can be written after the commit. Dropping a
    /// `Db<Transactional>` without calling this rolls the transaction back silently — the one
    /// mistake the type system does not catch.
    ///
    /// ```no_run
    /// # use arlesh_lib::database::session::SessionFactory;
    /// # async fn atomically(factory: &SessionFactory) -> Result<(), sqlx::Error> {
    /// let session = factory.begin().await?;
    /// session.commit().await?;
    /// # Ok(())
    /// # }
    /// ```
    ///
    /// A pooled session has nothing to commit, and saying otherwise does not compile — the same
    /// code with `connect` in place of `begin` is rejected:
    ///
    /// ```compile_fail
    /// # use arlesh_lib::database::session::SessionFactory;
    /// # async fn atomically(factory: &SessionFactory) -> Result<(), sqlx::Error> {
    /// let session = factory.connect().await?;
    /// session.commit().await?;
    /// # Ok(())
    /// # }
    /// ```
    #[tracing::instrument(skip(self))]
    pub async fn commit(self) -> Result<(), sqlx::Error> {
        self.handle.commit().await
    }
}

/// Sole owner of the connection pool, and the only source of [`Db`] sessions.
///
/// Cloning is cheap: the pool is reference-counted, and every clone hands out sessions over the
/// same set of connections.
#[derive(Debug, Clone)]
pub struct SessionFactory {
    /// The pool sessions are drawn from. Nothing outside this module may reach it.
    pool: DatabasePool,
}

impl SessionFactory {
    /// Takes ownership of `pool`. Called once, at bootstrap.
    pub fn new(pool: DatabasePool) -> Self {
        Self { pool }
    }

    /// Checks one connection out of the pool, waiting if none is free.
    ///
    /// The resulting session has no transaction open: each statement commits on its own. Use it
    /// for reads and for operations that write at most once.
    #[tracing::instrument(skip(self))]
    pub async fn connect(&self) -> Result<Db<Pooled>, sqlx::Error> {
        let handle = self.pool.acquire().await?;
        Ok(Db { handle })
    }

    /// Checks one connection out of the pool and opens a transaction on it.
    ///
    /// Everything written through the resulting session lands atomically, or not at all:
    /// [`Db::commit`] applies it, and dropping the session without committing discards it.
    #[tracing::instrument(skip(self))]
    pub async fn begin(&self) -> Result<Db<Transactional>, sqlx::Error> {
        let handle = self.pool.begin().await?;
        Ok(Db { handle })
    }
}

#[cfg(test)]
mod tests {
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
            for suffix in ["", "-wal", "-shm"] {
                let _ = std::fs::remove_file(format!("{}{suffix}", self.path.display()));
            }
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
}
