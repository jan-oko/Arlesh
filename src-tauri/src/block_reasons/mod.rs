//! Block reasons: an ordered list of explicit reasons a task or goal is blocked.
//!
//! The owner link (`owner_type`, `owner_id`) is polymorphic across tasks and goals, so — like the info
//! parent link — there is no foreign key and deletes are cleaned up here via [`BlockReasonRepository::delete_for`].

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

/// Repository for the block-reason list of tasks and goals.
pub struct BlockReasonRepository<'a> {
    pool: &'a DatabasePool,
}

impl<'a> BlockReasonRepository<'a> {
    /// Creates a repository bound to the given connection pool.
    pub fn new(pool: &'a DatabasePool) -> Self {
        Self { pool }
    }

    /// Returns every block reason across all owners (for the mindmap bulk load), ordered.
    #[tracing::instrument(skip(self))]
    pub async fn list_all(&self) -> Result<Vec<BlockReason>, sqlx::Error> {
        let rows: Vec<BlockReasonRow> = sqlx::query_as(
            "SELECT owner_type, owner_id, reason, position FROM block_reasons \
             ORDER BY owner_type, owner_id, position",
        )
        .fetch_all(self.pool)
        .await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// Returns the ordered reason texts for a single owner.
    #[tracing::instrument(skip(self))]
    pub async fn list_for(&self, owner_type: &str, owner_id: i64) -> Result<Vec<String>, sqlx::Error> {
        let reasons: Vec<String> = sqlx::query_scalar(
            "SELECT reason FROM block_reasons WHERE owner_type = ? AND owner_id = ? ORDER BY position",
        )
        .bind(owner_type)
        .bind(owner_id)
        .fetch_all(self.pool)
        .await?;
        Ok(reasons)
    }

    /// Replaces the whole ordered list for an owner. Empty/blank reasons are skipped.
    #[tracing::instrument(skip(self, reasons))]
    pub async fn set(&self, owner_type: &str, owner_id: i64, reasons: &[String]) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM block_reasons WHERE owner_type = ? AND owner_id = ?")
            .bind(owner_type)
            .bind(owner_id)
            .execute(&mut *tx)
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
            .execute(&mut *tx)
            .await?;
            position += 1;
        }
        tx.commit().await?;
        Ok(())
    }

    /// Removes every reason for an owner (called when the task/goal itself is deleted).
    #[tracing::instrument(skip(self))]
    pub async fn delete_for(&self, owner_type: &str, owner_id: i64) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM block_reasons WHERE owner_type = ? AND owner_id = ?")
            .bind(owner_type)
            .bind(owner_id)
            .execute(self.pool)
            .await?;
        Ok(())
    }
}
