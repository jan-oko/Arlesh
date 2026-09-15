//! Info nodes: free-text descriptions attached to any node type.

pub mod model;

use model::{CreateInfoRequest, Info, InfoId, UpdateInfoRequest};

#[derive(sqlx::FromRow)]
struct InfoRow {
    id: i64,
    body: String,
    details: Option<String>,
    parent_type: String,
    parent_id: i64,
    position: i64,
    is_private: bool,
}

impl From<InfoRow> for Info {
    fn from(row: InfoRow) -> Self {
        Self {
            id: row.id,
            body: row.body,
            details: row.details,
            parent_type: row.parent_type,
            parent_id: row.parent_id,
            position: row.position,
            is_private: row.is_private,
        }
    }
}

/// Reads and writes notes attached to other resources, on a session's connection.
///
/// Obtained as `db.infos()` and used inline; see [`Db`](crate::database::session::Db) for
/// the borrow rules and for where an operation belongs.
pub struct InfoOperator<'session> {
    /// The session's connection, borrowed for the duration of this operator's life.
    connection: &'session mut sqlx::SqliteConnection,
}

impl<'session> InfoOperator<'session> {
    /// Wraps the connection a session is lending.
    pub(crate) fn new(connection: &'session mut sqlx::SqliteConnection) -> Self {
        Self { connection }
    }

    /// Creates a new info node.
    #[tracing::instrument(skip(self))]
    pub async fn create(&mut self, req: CreateInfoRequest) -> Result<Info, sqlx::Error> {
        let row: InfoRow = sqlx::query_as(
            "INSERT INTO infos (body, details, parent_type, parent_id, position) VALUES (?, ?, ?, ?, ?) \
             RETURNING id, body, details, parent_type, parent_id, position, is_private",
        )
        .bind(&req.body)
        .bind(&req.details)
        .bind(&req.parent_type)
        .bind(req.parent_id)
        .bind(req.position)
        .fetch_one(&mut *self.connection)
        .await?;
        Ok(row.into())
    }

    /// Returns all info nodes.
    #[tracing::instrument(skip(self))]
    pub async fn list(&mut self) -> Result<Vec<Info>, sqlx::Error> {
        let rows: Vec<InfoRow> = sqlx::query_as(
            "SELECT id, body, details, parent_type, parent_id, position, is_private FROM infos ORDER BY position",
        )
        .fetch_all(&mut *self.connection)
        .await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// Reads one info node by id.
    #[tracing::instrument(skip(self))]
    pub async fn get(&mut self, id: InfoId) -> Result<Info, sqlx::Error> {
        let row: InfoRow = sqlx::query_as(
            "SELECT id, body, details, parent_type, parent_id, position, is_private FROM infos WHERE id = ?",
        )
        .bind(id.0)
        .fetch_one(&mut *self.connection)
        .await?;
        Ok(row.into())
    }

    /// Returns the ids of the info nodes hanging directly off `(parent_type, parent_id)`.
    ///
    /// Infos nest polymorphically with no foreign key, so a caller deleting a subtree has to walk
    /// the levels itself; this is the one query that walk needs. The cascade itself lives in
    /// `tasks`, which owns the other half of the subtree.
    #[tracing::instrument(skip(self))]
    pub async fn child_ids(
        &mut self,
        parent_type: &str,
        parent_id: i64,
    ) -> Result<Vec<i64>, sqlx::Error> {
        sqlx::query_scalar("SELECT id FROM infos WHERE parent_type = ? AND parent_id = ?")
            .bind(parent_type)
            .bind(parent_id)
            .fetch_all(&mut *self.connection)
            .await
    }

    /// Updates an info node.
    ///
    /// Multi-statement — one `UPDATE` per field the request touches (up to five: body, details,
    /// position, privacy, parent) — and so **not atomic on its own**. It opens no transaction: per
    /// ADR-0004 only the outermost caller decides the boundary, and a method that began its own
    /// could never join one.
    ///
    /// ```no_run
    /// # use arlesh_lib::database::session::SessionFactory;
    /// # use arlesh_lib::infos::model::{InfoId, UpdateInfoRequest};
    /// # async fn update(factory: &SessionFactory) -> Result<(), sqlx::Error> {
    /// let mut db = factory.begin().await?;
    /// db.infos().update(InfoId(1), UpdateInfoRequest {
    ///     body: Some("Updated".to_string()),
    ///     ..Default::default()
    /// }).await?;
    /// db.commit().await?;
    /// # Ok(())
    /// # }
    /// ```
    #[tracing::instrument(skip(self))]
    pub async fn update(&mut self, id: InfoId, req: UpdateInfoRequest) -> Result<Info, sqlx::Error> {
        if let Some(body) = &req.body {
            sqlx::query("UPDATE infos SET body = ?, updated_at = datetime('now') WHERE id = ?")
                .bind(body)
                .bind(id.0)
                .execute(&mut *self.connection)
                .await?;
        }
        if let Some(details) = &req.details {
            sqlx::query("UPDATE infos SET details = ?, updated_at = datetime('now') WHERE id = ?")
                .bind(details)
                .bind(id.0)
                .execute(&mut *self.connection)
                .await?;
        }
        if let Some(pos) = req.position {
            sqlx::query("UPDATE infos SET position = ?, updated_at = datetime('now') WHERE id = ?")
                .bind(pos)
                .bind(id.0)
                .execute(&mut *self.connection)
                .await?;
        }
        if let Some(is_private) = req.is_private {
            sqlx::query("UPDATE infos SET is_private = ?, updated_at = datetime('now') WHERE id = ?")
                .bind(is_private)
                .bind(id.0)
                .execute(&mut *self.connection)
                .await?;
        }
        if let (Some(pt), Some(pi)) = (req.parent_type, req.parent_id) {
            sqlx::query(
                "UPDATE infos SET parent_type = ?, parent_id = ?, updated_at = datetime('now') WHERE id = ?",
            )
            .bind(&pt)
            .bind(pi)
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?;
        }
        let row: InfoRow = sqlx::query_as(
            "SELECT id, body, details, parent_type, parent_id, position, is_private FROM infos WHERE id = ?",
        )
        .bind(id.0)
        .fetch_one(&mut *self.connection)
        .await?;
        Ok(row.into())
    }

    /// Deletes an info node.
    #[tracing::instrument(skip(self))]
    pub async fn delete(&mut self, id: InfoId) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM infos WHERE id = ?")
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }
}
