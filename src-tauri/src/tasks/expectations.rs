//! Expectations: waits that Tasks depend on.
//!
//! An Expectation is something outside your own action that you are waiting on to be released —
//! a training run finishing, someone replying. It is a content node beside Task, Goal and
//! Commitment, but it is not an action item: it has a Time Scope and tags but no Plan, it is never
//! *done*, and its only stored children are Info notes. What it does have is a status — Pending until the
//! wait is over, then Released — and Tasks can depend on it, so a Pending one blocks them the way
//! an unfinished dependency does. See `docs/spec/resources.md`, "Expectations".
//!
//! It may carry a **Check every**: how often to look in on it. While an Expectation is pending and
//! has one, a *virtual* "check on it" Task is derived beneath it at read time, due at its Starting
//! and then one interval after each check made. The task is never stored — completing it is
//! [`complete_expectation_check`], which records when and nothing else.
//!
//! The module follows its neighbours' shape (ADR-0004): single-resource SQL on
//! [`ExpectationOperator`], and the writes that also touch another table — the delete, which
//! drops the dependency edges aimed at the row — as free functions over a [`Db`] session.
//!
//! It lives inside `tasks` because the dependency graph does: a Task's edges, its virtual block
//! reasons and the subtree delete are all here, and each of them now has to know about this kind.

use chrono::NaiveDateTime;

use crate::database::session::{Db, Transactional};
use crate::scopes::key::ScopeKey;

use super::error::TaskError;
use super::model::{
    CreateExpectationRequest, DurationSpec, Expectation, ExpectationArchival, ExpectationId,
    ExpectationStatus, TimeScope, UpdateExpectationRequest,
};
use super::waits::{instant_column, instant_from_column};
use super::{insertion_position, time_scope_columns, time_scope_from_row};

/// The `parent_type` / `dependency_type` / `owner_type` spelling of this kind.
pub const EXPECTATION: &str = "expectation";

/// The stored shape of an expectation row.
#[derive(sqlx::FromRow)]
struct ExpectationRow {
    id: i64,
    title: String,
    parent_type: String,
    parent_id: i64,
    status: String,
    archival: String,
    position: i64,
    is_private: bool,
    time_scope_start_id: Option<ScopeKey>,
    time_scope_end_id: Option<ScopeKey>,
    time_scope_duration_n: Option<i64>,
    time_scope_duration_kind: Option<String>,
    check_every_n: Option<i64>,
    check_every_kind: Option<String>,
    check_starting: Option<String>,
    agentic: bool,
    agentic_note: Option<String>,
    /// The latest completed check's time, from `wait_checks` — not the retired column of the
    /// same meaning (0045).
    checked_at: Option<String>,
}

/// An expectation row with its latest completed check alongside, for [`ExpectationRow`].
const EXPECTATION_SELECT: &str = "SELECT e.*,
        (SELECT MAX(c.resolved_at) FROM wait_checks c
          WHERE c.wait_kind = 'stored' AND c.wait_id = e.id) AS checked_at
     FROM expectations e";

impl From<ExpectationRow> for Expectation {
    fn from(row: ExpectationRow) -> Self {
        Self {
            id: row.id.into(),
            title: row.title,
            parent_type: row.parent_type,
            parent_id: row.parent_id.into(),
            // An unrecognised spelling reads as Pending — the answer that keeps dependents
            // blocked rather than waving them through. The CHECK constraint keeps it from arising.
            status: ExpectationStatus::from_db(&row.status).unwrap_or_default(),
            archival: ExpectationArchival::from_db(&row.archival).unwrap_or_default(),
            check_every: match (row.check_every_n, row.check_every_kind) {
                (Some(n), Some(kind)) => Some(DurationSpec { n, kind }),
                _ => None,
            },
            check_starting: instant_from_column(row.check_starting),
            last_check_at: instant_from_column(row.checked_at),
            time_scope: time_scope_from_row(
                row.time_scope_start_id,
                row.time_scope_end_id,
                row.time_scope_duration_n,
                row.time_scope_duration_kind,
            ),
            tag_ids: Vec::new(),
            position: row.position,
            is_private: row.is_private,
            agentic: row.agentic,
            agentic_note: row.agentic_note,
            origin: crate::nodes::origin::Origin::Manual,
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
    /// Final Check every, or `None` for none.
    check_every: Option<DurationSpec>,
    /// Final Starting.
    check_starting: Option<NaiveDateTime>,
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
    /// Final agentic flag.
    agentic: bool,
    /// Final agentic note.
    agentic_note: Option<String>,
    /// Whether this write makes the wait agentic or moves an agentic one, and so has to be under an
    /// agentic Task. Not every write to an agentic wait: releasing one whose Task has since stopped
    /// reading as Agentic must still go through.
    places_agentic_wait: bool,
}

impl ExpectationWrite {
    /// Merges `request` over the `stored` row. Pure — it reads nothing and writes nothing.
    fn merge(
        stored: Expectation,
        request: UpdateExpectationRequest,
        now: NaiveDateTime,
    ) -> Result<Self, crate::nodes::id::NotStored> {
        let reparent = match (request.parent_type, request.parent_id) {
            (Some(parent_type), Some(parent_id)) => {
                Some((parent_type, parent_id.require_stored()?))
            }
            _ => None,
        };
        let (parent_type, parent_id) = reparent
            .clone()
            .unwrap_or((stored.parent_type, stored.parent_id.require_stored()?));
        let agentic = request.agentic.unwrap_or(stored.agentic);
        let places_agentic_wait = agentic && (!stored.agentic || reparent.is_some());
        Ok(Self {
            places_agentic_wait,
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
            check_every: match &request.check_every {
                Some(new_every) => new_every.clone(),
                None => stored.check_every.clone(),
            },
            // A Check every newly given with no Starting of its own starts now.
            check_starting: request.check_starting.or(
                match (&request.check_every, stored.check_starting) {
                    (Some(Some(_)), None) => Some(now),
                    (_, stored_starting) => stored_starting,
                },
            ),
            position: request.position.unwrap_or(stored.position),
            is_private: request.is_private.unwrap_or(stored.is_private),
            agentic,
            agentic_note: match request.agentic_note {
                Some(new_note) => new_note,
                None => stored.agentic_note,
            },
        })
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
        now: NaiveDateTime,
    ) -> Result<Expectation, TaskError> {
        let (ts_start, ts_end, ts_n, ts_kind) = time_scope_columns(&request.time_scope);
        let (every_n, every_kind) = every_columns(&request.check_every);
        let starting = request
            .check_every
            .as_ref()
            .map(|_| instant_column(request.check_starting.unwrap_or(now)));
        let id = sqlx::query(
            "INSERT INTO expectations
                (title, parent_type, parent_id, check_every_n, check_every_kind, check_starting,
                 position, time_scope_start_id, time_scope_end_id, time_scope_duration_n,
                 time_scope_duration_kind, agentic, agentic_note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&request.title)
        .bind(&request.parent_type)
        .bind(request.parent_id.require_stored()?)
        .bind(every_n)
        .bind(&every_kind)
        .bind(starting)
        .bind(insertion_position())
        .bind(ts_start)
        .bind(ts_end)
        .bind(ts_n)
        .bind(&ts_kind)
        .bind(request.agentic)
        .bind(&request.agentic_note)
        .execute(&mut *self.connection)
        .await?
        .last_insert_rowid();
        self.get(ExpectationId(id)).await
    }

    /// Fetches an expectation by id.
    pub async fn get(&mut self, id: ExpectationId) -> Result<Expectation, TaskError> {
        let row =
            sqlx::query_as::<_, ExpectationRow>(&format!("{EXPECTATION_SELECT} WHERE e.id = ?"))
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
        let rows = sqlx::query_as::<_, ExpectationRow>(&format!(
            "{EXPECTATION_SELECT} ORDER BY e.position ASC"
        ))
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
        let (every_n, every_kind) = every_columns(&write.check_every);
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
                check_every_n=?, check_every_kind=?, check_starting=?, position=?, is_private=?,
                time_scope_start_id=?, time_scope_end_id=?, time_scope_duration_n=?,
                time_scope_duration_kind=?, agentic=?, agentic_note=? WHERE id=?",
        )
        .bind(&write.title)
        .bind(write.status.as_str())
        .bind(write.archival.as_str())
        .bind(every_n)
        .bind(&every_kind)
        .bind(write.check_starting.map(instant_column))
        .bind(write.position)
        .bind(write.is_private)
        .bind(ts_start)
        .bind(ts_end)
        .bind(ts_n)
        .bind(&ts_kind)
        .bind(write.agentic)
        .bind(&write.agentic_note)
        .bind(id.0)
        .execute(&mut *self.connection)
        .await?;
        self.get(id).await
    }

    /// The canonical key of the Habit occurrence this expectation hangs on, when it hangs on one.
    pub async fn occurrence_parent_key(
        &mut self,
        id: ExpectationId,
    ) -> Result<Option<String>, TaskError> {
        Ok(sqlx::query_scalar(
            "SELECT parent_key FROM derived_children
             WHERE child_type = 'expectation' AND child_id = ?",
        )
        .bind(id.0)
        .fetch_optional(&mut *self.connection)
        .await?)
    }

    /// Deletes one expectation row and nothing else. The Infos beneath it and the dependency
    /// edges aimed at it are the subtree cascade's job — see [`delete_expectation`].
    pub(super) async fn delete_row(&mut self, id: ExpectationId) -> Result<(), TaskError> {
        sqlx::query("DELETE FROM expectations WHERE id = ?")
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?;
        // Its completed checks go with it: `wait_checks` has no foreign key to cascade, and a
        // freed id would otherwise hand them to the next wait created.
        sqlx::query("DELETE FROM wait_checks WHERE wait_kind = 'stored' AND wait_id = ?")
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }
}

/// Creates an expectation. Pending, live, and with whatever Check every and Time Scope the request
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
        request.parent_id.require_stored()?,
        &request.time_scope,
    )
    .await?;
    if request.agentic {
        super::agentic::require_agentic_parent(
            db,
            &request.parent_type,
            request.parent_id.require_stored()?,
        )
        .await?;
    }
    db.expectations().insert(request, now()).await
}

/// Creates an expectation under a Habit occurrence's host, the caller having checked whatever an
/// agentic one needs of the occurrence it will hang on — the host is not its parent, so the
/// ordinary check would ask the wrong node. See `nodes::write::create_expectation`.
pub(crate) async fn create_expectation_on_host(
    db: &mut Db<Transactional>,
    request: CreateExpectationRequest,
) -> Result<Expectation, TaskError> {
    super::scope_rules::validate_expectation_scope(
        db,
        &request.parent_type,
        request.parent_id.require_stored()?,
        &request.time_scope,
    )
    .await?;
    db.expectations().insert(request, now()).await
}

/// Updates an expectation — title, status, archival, Check every, parent, position or privacy.
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
    let write = ExpectationWrite::merge(stored, request, now())?;
    super::scope_rules::validate_expectation_scope(
        db,
        &write.parent_type,
        write.parent_id,
        &write.time_scope,
    )
    .await?;
    // A wait hung on a Habit occurrence has the occurrence for its parent, not the host its
    // columns name; the write facade checks that case against the occurrence.
    if write.places_agentic_wait && db.expectations().occurrence_parent_key(id).await?.is_none() {
        super::agentic::require_agentic_parent(db, &write.parent_type, write.parent_id).await?;
    }
    db.expectations().update(id, write).await
}

/// Completes the current check on a wait: records `at` as its last check, so the next falls due
/// one interval later. The Expectation stays Pending, and nothing else is stored for the check.
///
/// Refused when no check is due — no Check every, the wait no longer pending and live, or its next
/// check not come round yet — since there was then no check task to complete, and reporting success
/// for a gesture that aimed at nothing would hide a stale view.
#[tracing::instrument(skip(db))]
pub async fn complete_expectation_check(
    db: &mut Db<Transactional>,
    id: ExpectationId,
    at: NaiveDateTime,
) -> Result<Expectation, TaskError> {
    let stored = db.expectations().get(id).await?;
    // Refused unless a check is due now: completing one that has not come round yet would push the
    // schedule on without anyone having looked.
    let Some(due) =
        super::waits::stored_check_due(&stored).filter(|due| super::waits::is_due(*due, at))
    else {
        return Err(TaskError::NoCheckDue);
    };
    db.tasks()
        .record_check(&super::waits::WaitRef::Stored(id.0), due, at)
        .await?;
    db.expectations().get(id).await
}

/// Takes a completed check on a stored wait back: the check named by `due_at` is open again and,
/// being due, is the one drawn, while the check after it — no longer due — goes. Only the wait's
/// latest completed check, and only on a pending, live wait; anything else is refused.
#[tracing::instrument(skip(db))]
pub async fn reopen_expectation_check(
    db: &mut Db<Transactional>,
    id: ExpectationId,
    due_at: NaiveDateTime,
) -> Result<Expectation, TaskError> {
    let stored = db.expectations().get(id).await?;
    if stored.status != ExpectationStatus::Pending || stored.archival != ExpectationArchival::Live {
        return Err(TaskError::CheckNotReopenable);
    }
    super::waits::reopen_latest(db, &super::waits::WaitRef::Stored(id.0), due_at).await?;
    db.expectations().get(id).await
}

/// The wall-clock instant a write is stamped with.
pub(crate) fn now() -> NaiveDateTime {
    chrono::Local::now().naive_local()
}

/// A Check every's two column values.
fn every_columns(every: &Option<DurationSpec>) -> (Option<i64>, Option<String>) {
    match every {
        Some(every) => (Some(every.n), Some(every.kind.clone())),
        None => (None, None),
    }
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
