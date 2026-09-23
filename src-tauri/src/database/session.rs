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
//! # A transactional session is a writer
//!
//! `begin` is the mode for operations that write, and it takes SQLite's single writer lock at the
//! `BEGIN`, before its first statement. That is not an optimisation, it is what makes the mode
//! usable at all: a transaction that reads first and writes later cannot *become* a writer once
//! another connection is one. SQLite refuses that upgrade with `SQLITE_BUSY` immediately and
//! skips the busy handler, because a transaction already holding a read lock cannot be made to
//! wait without risking deadlock — so no timeout, retry or journal mode rescues it. The only
//! remedy is to be the writer from the start, which is what `BEGIN IMMEDIATE` says.
//!
//! The cost is that two transactional sessions serialise: the second waits at its `BEGIN` for the
//! first to commit, up to the busy timeout [`crate::database`] sets. That is the honest price of
//! a single-writer database, paid as a queue instead of as a failure. Reads pay nothing — a
//! `Db<Pooled>` opens no transaction, and under WAL it never waits on a writer.
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
use crate::tasks::{CommitmentOperator, ExpectationOperator, GoalOperator, TaskOperator};
use crate::undo::UndoOperator;

/// Makes [`SessionMode`] sealed: only this module can name it, so only this module can add a
/// session mode. There are two, and there is no third for anyone to invent.
mod sealed {
    /// Supertrait of [`SessionMode`](super::SessionMode), unnameable outside this crate.
    pub trait ModeIsSealed {}
}

/// How a [`Db`] session holds its one connection: see [`Pooled`] and [`Transactional`].
///
/// Sealed — the two implementors are markers only, carry no data, and exist solely to give the
/// two session modes distinct types. Both handles dereference to [`SqliteConnection`], so every
/// resource operator is written once and serves both modes.
pub trait SessionMode: sealed::ModeIsSealed {
    /// The owned connection handle a session in this mode keeps for its whole life.
    type Handle: DerefMut<Target = SqliteConnection> + Send;
}

/// A session holding one connection checked out of the pool, with no transaction open.
///
/// Each statement commits on its own. A `Db<Pooled>` has nothing to commit, and so has no
/// [`Db::commit`] method. Type-level only: never instantiated.
pub struct Pooled;

/// A session holding one connection with a transaction open on it.
///
/// Writes are invisible to other connections until [`Db::commit`] is called, and are rolled back
/// if the session is dropped without it. Type-level only: never instantiated.
pub struct Transactional;

impl sealed::ModeIsSealed for Pooled {}
impl sealed::ModeIsSealed for Transactional {}

impl SessionMode for Pooled {
    type Handle = PoolConnection<Sqlite>;
}

impl SessionMode for Transactional {
    type Handle = Transaction<'static, Sqlite>;
}

/// One database session, owning exactly one connection for its whole life.
///
/// # Borrowing
///
/// Work is done through the per-resource operators the session hands out — `db.goals()`,
/// `db.tasks()`, `db.scopes()` and so on. Each accessor borrows the session mutably for the
/// duration of a single call, so operators are used **inline** (`db.goals().create(…).await?`)
/// and never stored: binding two at once is a compile error, because both would be borrowing the
/// one connection the session owns. The diagnostic is "cannot borrow `*db` as mutable more than
/// once at a time", and the fix is always to stop holding the first operator, never to find a
/// way around the borrow.
///
/// # Where an operation lives
///
/// Three cases, and every database operation in this crate is exactly one of them:
///
/// 1. **One resource** — a method on that resource's operator, taking `&mut self`. Most of the
///    crate. `GoalOperator::list`, `ScopeOperator::register`.
/// 2. **Several resources** — a free function taking `&mut Db<M>`, reaching each resource by
///    calling `db.scopes()`, `db.goals()`, `db.tasks()` inline, one at a time. It takes the
///    session precisely because it needs more than one resource from it. `tasks`'
///    scope-containment rules are all of this kind.
/// 3. **Several resources, atomically** — the same, but taking `&mut Db<Transactional>`
///    specifically, so calling it non-atomically is a compile error rather than a silent
///    correctness bug. `start`, `fork_flow`, `convert_to_flow`, `set_iteration_done`, the subtree
///    deletes and `tasks::create_task`/`update_task` and their goal counterparts are all of this
///    kind. Such an operation **joins the caller's session and never opens its own**: only the
///    outermost caller decides the transaction boundary, and that is a standing rule the type
///    system does not enforce.
///
/// Which of 2 and 3 applies is decided by the operation's **consistency requirement**, not by
/// counting the statements it writes: any read a later write depends on — a containment check, a
/// cycle search — is a case-3 window, even when the write itself is a single statement.
///
/// Case 1 has a corollary worth stating, because case 3 is where the rules live: when an
/// operation splits into "the SQL" and "the SQL plus its rules", the operator half must be
/// **module-private**. `db.tasks().insert(request)` compiling from another module is a way to
/// write a row with the rules skipped, and the mechanically obvious translation of a legacy call
/// site is exactly that. `tasks` keeps `insert`, `update` and `delete_row` private for this
/// reason; only the case-3 free functions are reachable.
///
/// `flows` extends the same corollary to the second half of the consistency rule: every one of
/// its operations whose write depends on a read it took first — `update`, `delete`, the two item
/// updates, `convert_item`, `set_recurrence`, `set_iteration_done`, `fork_flow` — is private on
/// the operator, with a `Db<Transactional>` free function ([`crate::flows::update_flow`] and its
/// siblings) as the only way in. An operator wraps a bare connection and is deliberately
/// mode-agnostic, so it cannot demand a transaction in its signature; only a free function over
/// the session can. What stays on the operator is what reads nothing first: single writes, and
/// multi-statement writes like `set_cycles` whose doc says they are not atomic alone.
///
/// The rule has exactly one exemption, and it is about **consequence, not shape**: a
/// check-then-write may stay an operator method when a **schema constraint independently enforces
/// the invariant the check is testing**, because then a lost race is a constraint error rather
/// than corruption. (`ScopeOperator` used to be the example, probing for a scope row before
/// inserting one; scopes are derived now, and its one remaining write is a single idempotent
/// statement.)
/// `tasks::add_task_dependency` is the counter-example that fixes the boundary: nothing in the
/// schema expresses acyclicity, so two callers can each see no cycle and jointly create one, and
/// it is a free function over `Db<Transactional>`.
///
/// What is **not** sanctioned is reaching a second resource from inside an operator by minting a
/// sibling out of that operator's own connection borrow. It compiles, and it is how the
/// exclusivity this design buys gets quietly given back: the operator's `new` is crate-visible
/// only because this module lives in a different one, not as an escape hatch. An operator method
/// that finds it wants a second resource is case 2 wearing the wrong hat — move it out to a free
/// function over the session.
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

    /// Commitments — rules held over a window, kept or broken.
    pub fn commitments(&mut self) -> CommitmentOperator<'_> {
        CommitmentOperator::new(self.connection())
    }

    /// Expectations — waits that tasks depend on.
    pub fn expectations(&mut self) -> ExpectationOperator<'_> {
        ExpectationOperator::new(self.connection())
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

    /// Exact-scope registration; every other scope is derived without the database.
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

    /// The Undo Journal's ambient context and lifecycle.
    ///
    /// Unlike its siblings this operator owns no board resource: the journal's *rows* are written
    /// by triggers, and what is reachable here is the context those triggers read. See
    /// [`crate::undo`].
    pub fn undo(&mut self) -> UndoOperator<'_> {
        UndoOperator::new(self.connection())
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
    /// ```compile_fail,E0599
    /// # use arlesh_lib::database::session::SessionFactory;
    /// # async fn atomically(factory: &SessionFactory) -> Result<(), sqlx::Error> {
    /// let session = factory.connect().await?;
    /// session.commit().await?;
    /// # Ok(())
    /// # }
    /// ```
    // On the two doctests above: the `E0599` on the second is advisory only — rustdoc enforces
    // doctest error codes on nightly and ignores them on stable, verified here by pinning the
    // wrong code and watching the test still pass. What makes the guard non-vacuous is the pair.
    // The blocks differ by exactly one identifier, `begin` versus `connect`, so the second cannot
    // be failing for an unrelated reason while the first still compiles. Keep them one word apart
    // if you edit either.
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

    /// Checks one connection out of the pool and opens a write transaction on it.
    ///
    /// Everything written through the resulting session lands atomically, or not at all:
    /// [`Db::commit`] applies it, and dropping the session without committing discards it.
    ///
    /// The transaction is **immediate**: the writer lock is taken here, at the `BEGIN`, rather
    /// than at the session's first write. A deferred `BEGIN` — sqlx's default, and what this was
    /// until `Arlesh-odd` — defers the lock to the first write, by which time the session is
    /// holding a read lock and SQLite will refuse the upgrade outright if anyone else is writing.
    /// That refusal is not retryable, so the read-then-write shape every composite operation has
    /// (`load_mindmap` reads thirteen lists before it mints a single scope row) was one
    /// concurrent writer away from failing. See this module's header.
    ///
    /// So `begin` can now **wait**, for as long as another writer holds the lock and no longer
    /// than the busy timeout [`crate::database`] sets. There is no second, read-only entry point
    /// beside it: a session that only reads wants [`Self::connect`], which is what its own doc
    /// already says.
    #[tracing::instrument(skip(self))]
    pub async fn begin(&self) -> Result<Db<Transactional>, sqlx::Error> {
        let handle = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        Ok(Db { handle })
    }
}

#[cfg(test)]
mod tests;
