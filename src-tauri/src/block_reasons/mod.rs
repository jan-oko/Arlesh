//! Block reasons: an ordered list of explicit reasons a task or goal is blocked.
//!
//! The owner link (`owner_type`, `owner_id`) is polymorphic across tasks and goals, so — like the info
//! parent link — there is no foreign key, and nothing cascades: a deleted owner's reasons have to be
//! removed explicitly. [`BlockReasonOperator::delete_for`] is the method for that, but the only
//! cleanup in the crate today is a `DELETE` written inline in the task/goal subtree delete
//! (`tasks/mod.rs:111`) and nothing calls `delete_for` yet. Routing that site through this module is
//! Task 2.2 Step 3's job; until then the statement exists twice.

pub mod model;

use crate::database::DatabasePool;
use model::BlockReason;

#[derive(sqlx::FromRow)]
struct BlockReasonRow {
    owner_type: String,
    owner_id: i64,
    reason: String,
    position: i64,
}

impl From<BlockReasonRow> for BlockReason {
    fn from(row: BlockReasonRow) -> Self {
        Self {
            owner_type: row.owner_type,
            owner_id: row.owner_id,
            reason: row.reason,
            position: row.position,
        }
    }
}

/// Reads and writes the reasons a task or goal is blocked, on a session's connection.
///
/// Obtained as `db.block_reasons()` and used inline; see [`Db`](crate::database::session::Db) for
/// the borrow rules and for where an operation belongs.
pub struct BlockReasonOperator<'session> {
    /// The session's connection, borrowed for the duration of this operator's life.
    connection: &'session mut sqlx::SqliteConnection,
}

impl<'session> BlockReasonOperator<'session> {
    /// Wraps the connection a session is lending.
    pub(crate) fn new(connection: &'session mut sqlx::SqliteConnection) -> Self {
        Self { connection }
    }

    /// Returns every block reason across all owners (for the mindmap bulk load), ordered.
    #[tracing::instrument(skip(self))]
    pub async fn list_all(&mut self) -> Result<Vec<BlockReason>, sqlx::Error> {
        let rows: Vec<BlockReasonRow> = sqlx::query_as(
            "SELECT owner_type, owner_id, reason, position FROM block_reasons \
             ORDER BY owner_type, owner_id, position",
        )
        .fetch_all(&mut *self.connection)
        .await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// Returns the ordered reason texts for a single owner.
    #[tracing::instrument(skip(self))]
    pub async fn list_for(
        &mut self,
        owner_type: &str,
        owner_id: i64,
    ) -> Result<Vec<String>, sqlx::Error> {
        let reasons: Vec<String> = sqlx::query_scalar(
            "SELECT reason FROM block_reasons WHERE owner_type = ? AND owner_id = ? ORDER BY position",
        )
        .bind(owner_type)
        .bind(owner_id)
        .fetch_all(&mut *self.connection)
        .await?;
        Ok(reasons)
    }

    /// Replaces the whole ordered list for an owner. Empty/blank reasons are skipped.
    ///
    /// Multi-statement — a delete followed by one insert per surviving reason — and so **not
    /// atomic on its own**. It opens no transaction: per ADR-0004 only the outermost caller
    /// decides the boundary, and a method that began its own could never join one. Call it on a
    /// `Db<Transactional>` and commit, or a failure part-way leaves the owner's list truncated:
    ///
    /// ```no_run
    /// # use arlesh_lib::database::session::SessionFactory;
    /// # async fn replace(factory: &SessionFactory) -> Result<(), sqlx::Error> {
    /// let mut db = factory.begin().await?;
    /// db.block_reasons().set("task", 1, &["stuck".to_string()]).await?;
    /// db.commit().await?;
    /// # Ok(())
    /// # }
    /// ```
    #[tracing::instrument(skip(self, reasons))]
    pub async fn set(
        &mut self,
        owner_type: &str,
        owner_id: i64,
        reasons: &[String],
    ) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM block_reasons WHERE owner_type = ? AND owner_id = ?")
            .bind(owner_type)
            .bind(owner_id)
            .execute(&mut *self.connection)
            .await?;
        let mut position = 0_i64;
        for reason in reasons {
            if reason.trim().is_empty() {
                continue;
            }
            sqlx::query(
                "INSERT INTO block_reasons (owner_type, owner_id, reason, position) VALUES (?, ?, ?, ?)",
            )
            .bind(owner_type)
            .bind(owner_id)
            .bind(reason)
            .bind(position)
            .execute(&mut *self.connection)
            .await?;
            position += 1;
        }
        Ok(())
    }

    /// Removes every reason for an owner — the cleanup a deleted task or goal needs, since the
    /// owner link has no foreign key to cascade. Nothing calls it yet; see the module docs.
    #[tracing::instrument(skip(self))]
    pub async fn delete_for(&mut self, owner_type: &str, owner_id: i64) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM block_reasons WHERE owner_type = ? AND owner_id = ?")
            .bind(owner_type)
            .bind(owner_id)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }
}

/// Repository for the block-reason list of tasks and goals.
///
/// Transitional: the SQL now lives on [`BlockReasonOperator`], and every method here checks a
/// connection out of the pool and delegates to it, so repository and operator cannot drift while
/// callers move over. This struct goes away with its last caller — today
/// [`TaskRepository`](crate::tasks::TaskRepository), which Task 2.2 Step 3 migrates.
///
/// The methods below carry no `tracing::instrument`: each delegates to an operator method that is
/// already instrumented, and a second attribute would only nest an identical span inside it.
pub struct BlockReasonRepository<'a> {
    pool: &'a DatabasePool,
}

impl<'a> BlockReasonRepository<'a> {
    /// Creates a repository bound to the given connection pool.
    pub fn new(pool: &'a DatabasePool) -> Self {
        Self { pool }
    }

    /// Returns every block reason across all owners (for the mindmap bulk load), ordered.
    pub async fn list_all(&self) -> Result<Vec<BlockReason>, sqlx::Error> {
        let mut connection = self.pool.acquire().await?;
        BlockReasonOperator::new(&mut connection).list_all().await
    }

    /// Returns the ordered reason texts for a single owner.
    pub async fn list_for(&self, owner_type: &str, owner_id: i64) -> Result<Vec<String>, sqlx::Error> {
        let mut connection = self.pool.acquire().await?;
        BlockReasonOperator::new(&mut connection)
            .list_for(owner_type, owner_id)
            .await
    }

    /// Replaces the whole ordered list for an owner. Empty/blank reasons are skipped.
    ///
    /// Opens its own transaction, because a pool-bound caller has no session to join. Callers
    /// that already hold one must use [`BlockReasonOperator::set`] instead.
    pub async fn set(&self, owner_type: &str, owner_id: i64, reasons: &[String]) -> Result<(), sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        BlockReasonOperator::new(&mut transaction)
            .set(owner_type, owner_id, reasons)
            .await?;
        transaction.commit().await?;
        Ok(())
    }

    /// Removes every reason for an owner. See [`BlockReasonOperator::delete_for`].
    pub async fn delete_for(&self, owner_type: &str, owner_id: i64) -> Result<(), sqlx::Error> {
        let mut connection = self.pool.acquire().await?;
        BlockReasonOperator::new(&mut connection)
            .delete_for(owner_type, owner_id)
            .await
    }
}
