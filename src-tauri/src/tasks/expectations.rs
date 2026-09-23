//! Expectations: waits that Tasks depend on.
//!
//! An Expectation is something outside your own action that you are waiting on to be released —
//! a training run finishing, someone replying. It is a content node beside Task, Goal and
//! Commitment, but it is not an action item: it has no Time Scope and no Plan, it is never *done*,
//! and its only stored children are Info notes. What it does have is a status — Pending until the
//! wait is over, then Released — and Tasks can depend on it, so a Pending one blocks them the way
//! an unfinished dependency does. See `docs/spec/resources.md`, "Expectations".
//!
//! It carries one optional date, the **check-by**: when to look in on it. While an Expectation is
//! pending and has one, a *virtual* "check on it" Task is derived beneath it at read time. That
//! task is never stored — completing it is [`clear_check_by`], which writes the check-by back to
//! null and nothing else.
//!
//! The module follows its neighbours' shape (ADR-0004): single-resource SQL on
//! [`ExpectationOperator`], and the writes that also touch another table — the delete, which
//! drops the dependency edges aimed at the row — as free functions over a [`Db`] session.
//!
//! It lives inside `tasks` because the dependency graph does: a Task's edges, its virtual block
//! reasons and the subtree delete are all here, and each of them now has to know about this kind.

use crate::database::session::{Db, Transactional};

use super::error::TaskError;
use super::model::{
    CreateExpectationRequest, Expectation, ExpectationArchival, ExpectationId, ExpectationStatus,
    TimeScope, UpdateExpectationRequest,
};
use super::{insertion_position, time_scope_columns, time_scope_from_row};

/// The `parent_type` / `dependency_type` / `owner_type` spelling of this kind.
pub const EXPECTATION: &str = "expectation";

/// The lifecycle `node_type` an Expectation's **check-by** is sent under — what its virtual check
/// task reads. The `expectation` entry times the wait's own Time Scope.
pub const EXPECTATION_CHECK: &str = "expectation_check";

/// The stored shape of an expectation row.
#[derive(sqlx::FromRow)]
struct ExpectationRow {
    id: i64,
    title: String,
    parent_type: String,
    parent_id: i64,
    status: String,
    archival: String,
    check_by_start_id: Option<i64>,
    check_by_end_id: Option<i64>,
    check_by_duration_n: Option<i64>,
    check_by_duration_kind: Option<String>,
    position: i64,
    is_private: bool,
    time_scope_start_id: Option<i64>,
    time_scope_end_id: Option<i64>,
    time_scope_duration_n: Option<i64>,
    time_scope_duration_kind: Option<String>,
}

impl From<ExpectationRow> for Expectation {
    fn from(row: ExpectationRow) -> Self {
        Self {
            id: row.id,
            title: row.title,
            parent_type: row.parent_type,
            parent_id: row.parent_id,
            // An unrecognised spelling reads as Pending — the answer that keeps dependents
            // blocked rather than waving them through. The CHECK constraint keeps it from arising.
            status: ExpectationStatus::from_db(&row.status).unwrap_or_default(),
            archival: ExpectationArchival::from_db(&row.archival).unwrap_or_default(),
            check_by: time_scope_from_row(
                row.check_by_start_id,
                row.check_by_end_id,
                row.check_by_duration_n,
                row.check_by_duration_kind,
            ),
            time_scope: time_scope_from_row(
                row.time_scope_start_id,
                row.time_scope_end_id,
                row.time_scope_duration_n,
                row.time_scope_duration_kind,
            ),
            tag_ids: Vec::new(),
            position: row.position,
            is_private: row.is_private,
        }
    }
}

/// The column values an expectation update writes: the caller's request merged over the stored
/// row. Private, like [`ExpectationOperator::update`] which consumes it.
struct ExpectationWrite {
    /// The new parent, when the request asks for a move; `None` leaves the parent link alone.
    reparent: Option<(String, i64)>,
    /// Final title.
    title: String,
    /// Final status.
    status: ExpectationStatus,
    /// Final archival.
    archival: ExpectationArchival,
    /// Final check-by, or `None` for none.
    check_by: Option<TimeScope>,
    /// Final Time Scope, or `None` for none.
    time_scope: Option<TimeScope>,
    /// The parent the merged Time Scope is validated against — the new one when reparenting.
    parent_type: String,
    /// Id of that same parent.
    parent_id: i64,
    /// Final sort position.
    position: i64,
    /// Final privacy flag.
    is_private: bool,
}

impl ExpectationWrite {
    /// Merges `request` over the `stored` row. Pure — it reads nothing and writes nothing.
    fn merge(stored: Expectation, request: UpdateExpectationRequest) -> Self {
        let reparent = match (request.parent_type, request.parent_id) {
            (Some(parent_type), Some(parent_id)) => Some((parent_type, parent_id)),
            _ => None,
        };
        let (parent_type, parent_id) = reparent
            .clone()
            .unwrap_or((stored.parent_type, stored.parent_id));
        Self {
            reparent,
            parent_type,
            parent_id,
            time_scope: match request.time_scope {
                Some(new_time_scope) => new_time_scope,
                None => stored.time_scope,
            },
            title: request.title.unwrap_or(stored.title),
            status: request.status.unwrap_or(stored.status),
            archival: request.archival.unwrap_or(stored.archival),
            check_by: match request.check_by {
                Some(new_check_by) => new_check_by,
                None => stored.check_by,
            },
            position: request.position.unwrap_or(stored.position),
            is_private: request.is_private.unwrap_or(stored.is_private),
        }
    }
}

/// Reads and writes expectations on a session's connection.
///
/// Obtained as `db.expectations()` and used inline; see [`Db`] for the borrow rules.
pub struct ExpectationOperator<'session> {
    /// The session's connection, borrowed for the duration of this operator's life.
    connection: &'session mut sqlx::SqliteConnection,
}

impl<'session> ExpectationOperator<'session> {
    /// Wraps the connection a session is lending.
    pub(crate) fn new(connection: &'session mut sqlx::SqliteConnection) -> Self {
        Self { connection }
    }

    /// Inserts an expectation row and returns it. Two statements, so not atomic on its own —
    /// [`create_expectation`] is its only caller and runs it inside a transaction.
    async fn insert(
        &mut self,
        request: CreateExpectationRequest,
    ) -> Result<Expectation, TaskError> {
        let (start, end, n, kind) = time_scope_columns(&request.check_by);
        let (ts_start, ts_end, ts_n, ts_kind) = time_scope_columns(&request.time_scope);
        let id = sqlx::query(
            "INSERT INTO expectations
                (title, parent_type, parent_id, check_by_start_id, check_by_end_id,
                 check_by_duration_n, check_by_duration_kind, position,
                 time_scope_start_id, time_scope_end_id, time_scope_duration_n,
                 time_scope_duration_kind)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&request.title)
        .bind(&request.parent_type)
        .bind(request.parent_id)
        .bind(start)
        .bind(end)
        .bind(n)
        .bind(&kind)
        .bind(insertion_position())
        .bind(ts_start)
        .bind(ts_end)
        .bind(ts_n)
        .bind(&ts_kind)
        .execute(&mut *self.connection)
        .await?
        .last_insert_rowid();
        self.get(ExpectationId(id)).await
    }

    /// Fetches an expectation by id.
    pub async fn get(&mut self, id: ExpectationId) -> Result<Expectation, TaskError> {
        let row = sqlx::query_as::<_, ExpectationRow>("SELECT * FROM expectations WHERE id = ?")
            .bind(id.0)
            .fetch_optional(&mut *self.connection)
            .await?
            .ok_or(TaskError::ExpectationNotFound(id.0))?;
        let tag_ids = self.tag_ids(id).await?;
        Ok(Expectation {
            tag_ids,
            ..row.into()
        })
    }

    /// The tag domain ids attached to one expectation, in id order.
    async fn tag_ids(&mut self, id: ExpectationId) -> Result<Vec<i64>, TaskError> {
        Ok(sqlx::query_scalar::<_, i64>(
            "SELECT tag_id FROM tags_on_expectations WHERE expectation_id = ? ORDER BY tag_id",
        )
        .bind(id.0)
        .fetch_all(&mut *self.connection)
        .await?)
    }

    /// Attaches a tag to an expectation.
    pub async fn add_tag(&mut self, id: ExpectationId, tag_id: i64) -> Result<(), TaskError> {
        sqlx::query(
            "INSERT OR IGNORE INTO tags_on_expectations (expectation_id, tag_id) VALUES (?, ?)",
        )
        .bind(id.0)
        .bind(tag_id)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Removes a tag from an expectation.
    pub async fn remove_tag(&mut self, id: ExpectationId, tag_id: i64) -> Result<(), TaskError> {
        sqlx::query("DELETE FROM tags_on_expectations WHERE expectation_id = ? AND tag_id = ?")
            .bind(id.0)
            .bind(tag_id)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Lists all expectations, in sort-position order.
    pub async fn list(&mut self) -> Result<Vec<Expectation>, TaskError> {
        let rows =
            sqlx::query_as::<_, ExpectationRow>("SELECT * FROM expectations ORDER BY position ASC")
                .fetch_all(&mut *self.connection)
                .await?;
        let mut expectations = Vec::with_capacity(rows.len());
        for row in rows {
            let tag_ids = self.tag_ids(ExpectationId(row.id)).await?;
            expectations.push(Expectation {
                tag_ids,
                ..row.into()
            });
        }
        Ok(expectations)
    }

    /// Returns the ids of the expectations parented directly by `(parent_type, parent_id)`.
    ///
    /// The parent link is polymorphic and has no foreign key, so subtree walks collect their
    /// children a level at a time through this.
    pub async fn child_ids(
        &mut self,
        parent_type: &str,
        parent_id: i64,
    ) -> Result<Vec<i64>, TaskError> {
        Ok(sqlx::query_scalar(
            "SELECT id FROM expectations WHERE parent_type = ? AND parent_id = ?",
        )
        .bind(parent_type)
        .bind(parent_id)
        .fetch_all(&mut *self.connection)
        .await?)
    }

    /// Writes already-merged column values onto an expectation. Module-private: see
    /// [`update_expectation`].
    async fn update(
        &mut self,
        id: ExpectationId,
        write: ExpectationWrite,
    ) -> Result<Expectation, TaskError> {
        let (start, end, n, kind) = time_scope_columns(&write.check_by);
        let (ts_start, ts_end, ts_n, ts_kind) = time_scope_columns(&write.time_scope);
        if let Some((parent_type, parent_id)) = &write.reparent {
            sqlx::query("UPDATE expectations SET parent_type = ?, parent_id = ? WHERE id = ?")
                .bind(parent_type)
                .bind(parent_id)
                .bind(id.0)
                .execute(&mut *self.connection)
                .await?;
        }
        sqlx::query(
            "UPDATE expectations SET title=?, status=?, archival=?,
                check_by_start_id=?, check_by_end_id=?, check_by_duration_n=?,
                check_by_duration_kind=?, position=?, is_private=?,
                time_scope_start_id=?, time_scope_end_id=?, time_scope_duration_n=?,
                time_scope_duration_kind=? WHERE id=?",
        )
        .bind(&write.title)
        .bind(write.status.as_str())
        .bind(write.archival.as_str())
        .bind(start)
        .bind(end)
        .bind(n)
        .bind(&kind)
        .bind(write.position)
        .bind(write.is_private)
        .bind(ts_start)
        .bind(ts_end)
        .bind(ts_n)
        .bind(&ts_kind)
        .bind(id.0)
        .execute(&mut *self.connection)
        .await?;
        self.get(id).await
    }

    /// Deletes one expectation row and nothing else. The Infos beneath it and the dependency
    /// edges aimed at it are the subtree cascade's job — see [`delete_expectation`].
    pub(super) async fn delete_row(&mut self, id: ExpectationId) -> Result<(), TaskError> {
        sqlx::query("DELETE FROM expectations WHERE id = ?")
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }
}

/// Creates an expectation. Pending, live, and with whatever check-by and Time Scope the request
/// names — none, unless it names them. A Time Scope escaping the nearest scoped ancestor's window is
/// refused, as it is for a Task.
#[tracing::instrument(skip(db))]
pub async fn create_expectation(
    db: &mut Db<Transactional>,
    request: CreateExpectationRequest,
) -> Result<Expectation, TaskError> {
    super::scope_rules::validate_expectation_scope(
        db,
        &request.parent_type,
        request.parent_id,
        &request.time_scope,
    )
    .await?;
    db.expectations().insert(request).await
}

/// Updates an expectation — title, status, archival, check-by, parent, position or privacy.
///
/// Releasing is an ordinary write of [`ExpectationStatus::Released`], and taking it back is one of
/// `Pending`, so a misclick is undone by the same call that made it.
#[tracing::instrument(skip(db))]
pub async fn update_expectation(
    db: &mut Db<Transactional>,
    id: ExpectationId,
    request: UpdateExpectationRequest,
) -> Result<Expectation, TaskError> {
    let stored = db.expectations().get(id).await?;
    let write = ExpectationWrite::merge(stored, request);
    super::scope_rules::validate_expectation_scope(
        db,
        &write.parent_type,
        write.parent_id,
        &write.time_scope,
    )
    .await?;
    db.expectations().update(id, write).await
}

/// Completes the virtual "check on it" task: clears the check-by and leaves everything else —
/// the Expectation stays Pending. Nothing is stored for the check itself.
///
/// Refused when there is no check-by to clear, since there was then no check task to complete
/// either, and reporting success for a gesture that aimed at nothing would hide a stale view.
#[tracing::instrument(skip(db))]
pub async fn clear_check_by(
    db: &mut Db<Transactional>,
    id: ExpectationId,
) -> Result<Expectation, TaskError> {
    let stored = db.expectations().get(id).await?;
    if stored.check_by.is_none() {
        return Err(TaskError::ExpectationHasNoCheckBy(id.0));
    }
    let request = UpdateExpectationRequest {
        check_by: Some(None),
        ..Default::default()
    };
    db.expectations()
        .update(id, ExpectationWrite::merge(stored, request))
        .await
}

/// Deletes an expectation, the Infos beneath it, and every dependency edge aimed at it.
///
/// The edges matter: `task_dependencies.dependency_id` carries no foreign key, and SQLite reuses
/// a freed rowid, so an edge left behind would silently re-attach to the next expectation created.
#[tracing::instrument(skip(db))]
pub async fn delete_expectation(
    db: &mut Db<Transactional>,
    id: ExpectationId,
) -> Result<(), TaskError> {
    db.expectations().get(id).await?;
    super::delete_node_subtree(db, EXPECTATION, id.0).await
}

#[cfg(test)]
mod tests;
