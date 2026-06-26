//! Info nodes: free-text descriptions attached to any node type.

pub mod model;

use crate::database::DatabasePool;
use model::{CreateInfoRequest, Info, InfoId, UpdateInfoRequest};

#[derive(sqlx::FromRow)]
struct InfoRow {
    id: i64,
    body: String,
    parent_type: String,
    parent_id: i64,
    position: i64,
}

impl From<InfoRow> for Info {
    fn from(row: InfoRow) -> Self {
        Self {
            id: row.id,
            body: row.body,
            parent_type: row.parent_type,
            parent_id: row.parent_id,
            position: row.position,
        }
    }
}

/// Repository for info node CRUD operations.
pub struct InfoRepository<'a> {
    pool: &'a DatabasePool,
}

impl<'a> InfoRepository<'a> {
    /// Creates a repository bound to the given connection pool.
    pub fn new(pool: &'a DatabasePool) -> Self {
        Self { pool }
    }

    /// Creates a new info node.
    #[tracing::instrument(skip(self))]
    pub async fn create(&self, req: CreateInfoRequest) -> Result<Info, sqlx::Error> {
        let row: InfoRow = sqlx::query_as(
            "INSERT INTO infos (body, parent_type, parent_id, position) VALUES (?, ?, ?, ?) \
             RETURNING id, body, parent_type, parent_id, position",
        )
        .bind(&req.body)
        .bind(&req.parent_type)
        .bind(req.parent_id)
        .bind(req.position)
        .fetch_one(self.pool)
        .await?;
        Ok(row.into())
    }

    /// Returns all info nodes.
    #[tracing::instrument(skip(self))]
    pub async fn list(&self) -> Result<Vec<Info>, sqlx::Error> {
        let rows: Vec<InfoRow> = sqlx::query_as(
            "SELECT id, body, parent_type, parent_id, position FROM infos ORDER BY position",
        )
        .fetch_all(self.pool)
        .await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// Updates an info node.
    #[tracing::instrument(skip(self))]
    pub async fn update(&self, id: InfoId, req: UpdateInfoRequest) -> Result<Info, sqlx::Error> {
        if let Some(body) = &req.body {
            sqlx::query("UPDATE infos SET body = ?, updated_at = datetime('now') WHERE id = ?")
                .bind(body)
                .bind(id.0)
                .execute(self.pool)
                .await?;
        }
        if let Some(pos) = req.position {
            sqlx::query("UPDATE infos SET position = ?, updated_at = datetime('now') WHERE id = ?")
                .bind(pos)
                .bind(id.0)
                .execute(self.pool)
                .await?;
        }
        if let (Some(pt), Some(pi)) = (req.parent_type, req.parent_id) {
            sqlx::query(
                "UPDATE infos SET parent_type = ?, parent_id = ?, updated_at = datetime('now') WHERE id = ?",
            )
            .bind(&pt)
            .bind(pi)
            .bind(id.0)
            .execute(self.pool)
            .await?;
        }
        let row: InfoRow = sqlx::query_as(
            "SELECT id, body, parent_type, parent_id, position FROM infos WHERE id = ?",
        )
        .bind(id.0)
        .fetch_one(self.pool)
        .await?;
        Ok(row.into())
    }

    /// Deletes an info node.
    #[tracing::instrument(skip(self))]
    pub async fn delete(&self, id: InfoId) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM infos WHERE id = ?")
            .bind(id.0)
            .execute(self.pool)
            .await?;
        Ok(())
    }
}
