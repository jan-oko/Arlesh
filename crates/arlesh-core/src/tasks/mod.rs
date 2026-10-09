//! Tasks, Goals and Commitments: action items, desired states, and rules held over a window.
//!
//! The three share a scoped parent chain — a Task inherits its window from whichever of them sits
//! nearest above it — which is why they share a module, an ancestry climb and one set of
//! containment rules.
//!
//! Single-resource SQL lives on [`TaskOperator`], [`GoalOperator`] and [`CommitmentOperator`].
//! Anything that also has to read scopes (containment validation), infos and block reasons (the
//! subtree delete) or several tables at once is a **free function over a [`Db`] session**
//! instead — [`create_task`], [`update_task`], [`delete_task`], [`get_task_with_blockers`] and
//! their goal and commitment counterparts. See [`Db`]'s `# Where an operation lives`.

pub(crate) mod agentic;
mod ancestry;
pub mod commitments;
pub mod compound;
pub mod done_date;
pub mod error;
pub mod expectations;
pub mod gestures;
pub use rules::lifecycle;
pub mod model;
pub use rules::review;
pub mod rules;
mod scope_rules;
pub mod waits;

use std::collections::{HashMap, HashSet, VecDeque};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::database::session::{Db, SessionMode, Transactional};
use crate::infos::model::InfoId;
use crate::nodes::id::NodeId;
use crate::nodes::origin::Origin;
use crate::nodes::rules::parenting::stored_reference;
use crate::scopes::db::DbScopeKey;
use ancestry::{AncestryLink, NodeKind, NodeRef};
use chrono::NaiveDateTime;
pub use commitments::{
    create_commitment, delete_commitment, update_commitment, CommitmentOperator,
};
use error::TaskError;
pub use expectations::{
    complete_expectation_check, create_expectation, delete_expectation, reopen_expectation_check,
    update_expectation, ExpectationOperator,
};
use model::{AgenticBrief, AsyncTemplate, CommitmentId, ExpectationId, ExpectationStatus};
use model::{
    CreateGoalRequest, CreateTaskRequest, Delegate, Dependency, DurationSpec, Goal, GoalId,
    GoalStatus, OnScopeExit, Status, Task, TaskArchival, TaskDependencyEdge, TaskId, TaskStatus,
    TaskWithBlockers, TimeScope, UpdateGoalRequest, UpdateTaskRequest,
};
pub use rules::dependencies::dependency_name;
use rules::write::{reject_backlog_with_plan, releases_compound};
pub use scope_rules::{
    conflicts_for_new_time_scope, derive_all_scope_lifecycles, derive_scope_lifecycles,
    mark_waits_under_pending, nearest_scoped_ancestor_window, reparent_conflicts, wait_lifecycle,
    OccurrenceExit, ReparentConflicts, ViolatingDescendant,
};

// Internal row types that map directly to database columns via sqlx::FromRow.
// Public API types (Task, Goal) include derived fields like tag_ids.

/// Decomposes a Time Scope into its four flat column values for persistence.
fn time_scope_columns(
    time_scope: &Option<TimeScope>,
) -> (
    Option<DbScopeKey>,
    Option<DbScopeKey>,
    Option<i64>,
    Option<String>,
) {
    match time_scope {
        Some(ts) => {
            let (n, kind) = match &ts.duration {
                Some(d) => (Some(d.n), Some(d.kind.clone())),
                None => (None, None),
            };
            (
                Some(DbScopeKey(ts.start_id)),
                Some(DbScopeKey(ts.end_id)),
                n,
                kind,
            )
        }
        None => (None, None, None, None),
    }
}

/// The `on_scope_exit` column value for a write: absent (NULL) when the item is unscoped, otherwise
/// the requested behavior defaulted to `keep` — Keep Overdue (the UI always supplies an explicit choice; this keeps
/// the DB invariant "scoped ⟺ on-exit set" satisfied even when a caller omits it).
fn on_scope_exit_column(
    time_scope: &Option<TimeScope>,
    requested: Option<OnScopeExit>,
) -> Option<&'static str> {
    if time_scope.is_none() {
        return None;
    }
    Some(requested.unwrap_or(OnScopeExit::Keep).as_str())
}

/// The millisecond timestamp a freshly inserted row takes as its sort position.
pub(crate) fn insertion_position() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// Deletes every info that hangs (directly or transitively) under `(parent_type, parent_id)`.
/// Infos nest polymorphically with no foreign key, so the subtree is walked explicitly.
async fn delete_infos_under(
    db: &mut Db<Transactional>,
    parent_type: &str,
    parent_id: i64,
) -> Result<(), TaskError> {
    let mut stack = db.infos().child_ids(parent_type, parent_id).await?;
    let mut all = Vec::new();
    while let Some(id) = stack.pop() {
        all.push(id);
        let children = db.infos().child_ids("info", id).await?;
        stack.extend(children);
    }
    for id in all {
        // A note attached to a Habit occurrence is only ever deleted with the node it hangs under
        // or on its own command, and both funnel through here. SQLite recycles rowids, so an
        // attachment outliving its row would later be inherited by an unrelated one.
        db.flows().detach_instance_child("info", id).await?;
        db.infos().delete(InfoId(id)).await?;
    }
    Ok(())
}

/// Cascade-deletes a content-node subtree: the node, every descendant task, goal, commitment and
/// expectation (with the dependency edges aimed at each expectation),
/// and all infos under them. Dependencies and tags fall away via their `ON DELETE CASCADE`
/// foreign keys; the polymorphic parent links do not, so descendants are collected explicitly to
/// avoid orphaning them.
///
/// Takes a transactional session: a half-applied cascade leaves orphans behind, so ADR-0004 makes
/// this one of the operations whose signature demands atomicity.
async fn delete_node_subtree(
    db: &mut Db<Transactional>,
    root_type: &str,
    root_id: i64,
) -> Result<(), TaskError> {
    let mut stack = vec![(root_type.to_string(), root_id)];
    let mut nodes = Vec::new();
    while let Some((node_type, node_id)) = stack.pop() {
        nodes.push((node_type.clone(), node_id));
        let task_children = db.tasks().child_ids(&node_type, node_id).await?;
        stack.extend(task_children.into_iter().map(|id| ("task".to_string(), id)));
        let goal_children = db.goals().child_ids(&node_type, node_id).await?;
        stack.extend(goal_children.into_iter().map(|id| ("goal".to_string(), id)));
        let commitment_children = db.commitments().child_ids(&node_type, node_id).await?;
        stack.extend(
            commitment_children
                .into_iter()
                .map(|id| ("commitment".to_string(), id)),
        );
        let expectation_children = db.expectations().child_ids(&node_type, node_id).await?;
        stack.extend(
            expectation_children
                .into_iter()
                .map(|id| (expectations::EXPECTATION.to_string(), id)),
        );
    }
    for (node_type, node_id) in &nodes {
        // The node may be an added child of a Habit occurrence. Its attachment names the row, so
        // it goes when the row goes — see `delete_infos_under` for why an orphan is not merely
        // untidy.
        db.flows()
            .detach_instance_child(node_type, *node_id)
            .await?;
        delete_infos_under(db, node_type, *node_id).await?;
        // Block reasons hang off a polymorphic owner link with no foreign key, like infos. A
        // Commitment never has any, and asking for none costs one statement against the risk of
        // leaving a stale row behind if that ever changes.
        db.block_reasons().delete_for(node_type, *node_id).await?;
        // An edge between this row and a Habit occurrence names the row by id, with no foreign
        // key on the target side; it goes with the row, as a stored edge does.
        db.relations().forget_stored(node_type, *node_id).await?;
        match node_type.as_str() {
            "goal" => db.goals().delete_row(GoalId(*node_id)).await?,
            "commitment" => db.commitments().delete_row(CommitmentId(*node_id)).await?,
            expectations::EXPECTATION => {
                // The edges aimed at a wait carry no foreign key, and a freed rowid is reused:
                // left behind, they would re-attach to the next expectation created.
                db.tasks()
                    .drop_dependents(expectations::EXPECTATION, *node_id)
                    .await?;
                db.expectations()
                    .delete_row(ExpectationId(*node_id))
                    .await?
            }
            _ => {
                // The waits a Task draws are rows of nothing; what was written to them goes with it.
                db.overlays().forget_task_waits(*node_id).await?;
                db.tasks().delete_row(TaskId(*node_id)).await?
            }
        }
    }
    Ok(())
}

/// Reassembles a Time Scope value object from its flat row columns. A scope exists only when
/// both boundary ids are present; the duration parameters are optional metadata on top.
fn time_scope_from_row(
    start_id: Option<DbScopeKey>,
    end_id: Option<DbScopeKey>,
    duration_n: Option<i64>,
    duration_kind: Option<String>,
) -> Option<TimeScope> {
    let (start_id, end_id) = (start_id?, end_id?);
    let duration = match (duration_n, duration_kind) {
        (Some(n), Some(kind)) => Some(DurationSpec { n, kind }),
        _ => None,
    };
    Some(TimeScope {
        start_id: start_id.0,
        end_id: end_id.0,
        duration,
    })
}

#[derive(sqlx::FromRow)]
struct TaskRow {
    id: i64,
    title: String,
    parent_type: String,
    parent_id: i64,
    status: String,
    delegate_kind: Option<String>,
    delegate_id: Option<i64>,
    agentic: Option<bool>,
    asynchronous: bool,
    compound: bool,
    time_scope_start_id: Option<DbScopeKey>,
    time_scope_end_id: Option<DbScopeKey>,
    time_scope_duration_n: Option<i64>,
    time_scope_duration_kind: Option<String>,
    on_scope_exit: Option<String>,
    plan_start_id: Option<DbScopeKey>,
    plan_end_id: Option<DbScopeKey>,
    due_scope_start_id: Option<DbScopeKey>,
    due_scope_end_id: Option<DbScopeKey>,
    archival: String,
    position: i64,
    is_private: bool,
}

impl From<TaskRow> for Task {
    fn from(row: TaskRow) -> Self {
        Self {
            id: row.id.into(),
            title: row.title,
            parent_type: row.parent_type,
            parent_id: row.parent_id.into(),
            status: decode_status(row.id, &row.status),
            delegate_to: Delegate::from_columns(row.delegate_kind.as_deref(), row.delegate_id),
            agentic: row.agentic,
            asynchronous: row.asynchronous,
            compound: row.compound,
            // Read after the row, from its own table.
            async_template: None,
            agentic_brief: None,
            time_scope: time_scope_from_row(
                row.time_scope_start_id,
                row.time_scope_end_id,
                row.time_scope_duration_n,
                row.time_scope_duration_kind,
            ),
            on_scope_exit: row.on_scope_exit.as_deref().and_then(OnScopeExit::from_db),
            plan: time_scope_from_row(row.plan_start_id, row.plan_end_id, None, None),
            due_scope: time_scope_from_row(
                row.due_scope_start_id,
                row.due_scope_end_id,
                None,
                None,
            ),
            // An unrecognised spelling reads as Live — the least surprising fallback, and the one
            // that never hides work. The CHECK constraint is what keeps it from arising.
            archival: TaskArchival::from_db(&row.archival).unwrap_or_default(),
            tag_ids: vec![],
            position: row.position,
            is_private: row.is_private,
            origin: Origin::Manual,
        }
    }
}

/// A stored status in whichever model it is spelled in. The CHECK constraint admits only the two
/// models' spellings, so an unrecognised one is corrupt data: it reads as an ordinary To Do — the
/// fallback that never claims work is under way — and is logged.
fn decode_status(id: i64, stored: &str) -> Status {
    Status::from_db(stored).unwrap_or_else(|| {
        tracing::warn!(
            task = id,
            status = stored,
            "a task row holds an unknown status"
        );
        Status::Ordinary(TaskStatus::Todo)
    })
}

/// The spelling `status` is stored as, refusing the one value that is never stored: Review.
fn status_column(status: Status) -> Result<&'static str, TaskError> {
    status.as_db().ok_or(TaskError::ReviewIsDerived)
}

#[derive(sqlx::FromRow)]
struct GoalRow {
    id: i64,
    title: String,
    parent_type: String,
    parent_id: i64,
    status: String,
    time_scope_start_id: Option<DbScopeKey>,
    time_scope_end_id: Option<DbScopeKey>,
    time_scope_duration_n: Option<i64>,
    time_scope_duration_kind: Option<String>,
    on_scope_exit: Option<String>,
    position: i64,
    is_private: bool,
}

impl From<GoalRow> for Goal {
    fn from(row: GoalRow) -> Self {
        Self {
            id: row.id.into(),
            title: row.title,
            parent_type: row.parent_type,
            parent_id: row.parent_id.into(),
            status: row.status,
            time_scope: time_scope_from_row(
                row.time_scope_start_id,
                row.time_scope_end_id,
                row.time_scope_duration_n,
                row.time_scope_duration_kind,
            ),
            on_scope_exit: row.on_scope_exit.as_deref().and_then(OnScopeExit::from_db),
            tag_ids: vec![],
            position: row.position,
            is_private: row.is_private,
            origin: Origin::Manual,
        }
    }
}

/// The narrow task row one step of an ancestry climb reads.
///
/// Nine columns and no tag query, against the sixteen columns plus a join [`TaskRow`] costs.
/// A climb reads one of these per level of the tree, so the difference is per-step.
#[derive(sqlx::FromRow)]
struct TaskAncestryRow {
    parent_type: String,
    parent_id: i64,
    time_scope_start_id: Option<DbScopeKey>,
    time_scope_end_id: Option<DbScopeKey>,
    time_scope_duration_n: Option<i64>,
    time_scope_duration_kind: Option<String>,
    on_scope_exit: Option<String>,
    plan_start_id: Option<DbScopeKey>,
    plan_end_id: Option<DbScopeKey>,
}

/// The narrow goal row one step of an ancestry climb reads. Goals have no Plan column, so the
/// link's `plan` is always absent.
#[derive(sqlx::FromRow)]
struct GoalAncestryRow {
    parent_type: String,
    parent_id: i64,
    time_scope_start_id: Option<DbScopeKey>,
    time_scope_end_id: Option<DbScopeKey>,
    time_scope_duration_n: Option<i64>,
    time_scope_duration_kind: Option<String>,
    on_scope_exit: Option<String>,
}

async fn fetch_task_tag_ids(
    connection: &mut sqlx::SqliteConnection,
    task_id: i64,
) -> Result<Vec<i64>, sqlx::Error> {
    sqlx::query_scalar::<_, i64>(
        "SELECT tag_id FROM tags_on_tasks WHERE task_id = ? ORDER BY tag_id",
    )
    .bind(task_id)
    .fetch_all(connection)
    .await
}

async fn fetch_goal_tag_ids(
    connection: &mut sqlx::SqliteConnection,
    goal_id: i64,
) -> Result<Vec<i64>, sqlx::Error> {
    sqlx::query_scalar::<_, i64>(
        "SELECT tag_id FROM tags_on_goals WHERE goal_id = ? ORDER BY tag_id",
    )
    .bind(goal_id)
    .fetch_all(connection)
    .await
}

/// The column values a goal update writes: the caller's request merged over the stored row.
///
/// Private, like `GoalOperator::update` which consumes it and `GoalWrite::merge` which is the only
/// thing that builds one. Together those close the write path: [`update_goal`] — where the
/// containment rules are checked — is the only way to change a goal. An unvalidated goal write is
/// not expressible.
struct GoalWrite {
    /// The new parent, when the request asks for a move; `None` leaves the parent link alone.
    reparent: Option<(String, i64)>,
    /// The parent the merged Time Scope is validated against — the new one when reparenting.
    parent_type: String,
    /// Id of that same parent.
    parent_id: i64,
    /// Final title.
    title: String,
    /// Final status, as its database string.
    status: String,
    /// Final Time Scope, or `None` for unscoped.
    time_scope: Option<TimeScope>,
    /// Requested on-exit behavior; dropped by [`on_scope_exit_column`] when unscoped.
    on_scope_exit: Option<OnScopeExit>,
    /// Final sort position.
    position: i64,
    /// Final privacy flag.
    is_private: bool,
}

impl GoalWrite {
    /// Merges `request` over the `stored` row. Pure — it reads nothing and writes nothing.
    fn merge(
        stored: Goal,
        request: UpdateGoalRequest,
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
        let status = request
            .status
            .as_ref()
            .map(|s| s.as_str())
            .unwrap_or(&stored.status)
            .to_string();
        let time_scope = match request.time_scope {
            Some(new_time_scope) => new_time_scope,
            None => stored.time_scope,
        };
        Ok(Self {
            reparent,
            parent_type,
            parent_id,
            title: request.title.unwrap_or(stored.title),
            status,
            time_scope,
            on_scope_exit: request.on_scope_exit.unwrap_or(stored.on_scope_exit),
            position: request.position.unwrap_or(stored.position),
            is_private: request.is_private.unwrap_or(stored.is_private),
        })
    }
}

/// The column values a task update writes: the caller's request merged over the stored row.
///
/// Private, for the same reason as [`GoalWrite`]: with the struct, its `merge` and the operator
/// method that consumes it all module-private, [`update_task`] is the only way to change a task.
struct TaskWrite {
    /// The new parent, when the request asks for a move; `None` leaves the parent link alone.
    reparent: Option<(String, i64)>,
    /// The parent the merged Time Scope and Plan are validated against.
    parent_type: String,
    /// Id of that same parent.
    parent_id: i64,
    /// Final title.
    title: String,
    /// Final status, in the model the Task holds after the write — settled by
    /// [`agentic::settle_status`] before the write is made.
    status: Status,
    /// Final delegate, or `None`.
    delegate_to: Option<Delegate>,
    /// Final Agentic column: `None` is the NULL that inherits from the nearest flagged ancestor.
    agentic: Option<bool>,
    /// Final Asynchronous flag.
    asynchronous: bool,
    /// Final Compound flag.
    compound: bool,
    /// Final Expectation template; always `None` when `asynchronous` is false.
    async_template: Option<AsyncTemplate>,
    /// Final agentic brief — kept whatever the flag says, since the flag can be inherited.
    agentic_brief: Option<AgenticBrief>,
    /// Final Time Scope, or `None` for unscoped.
    time_scope: Option<TimeScope>,
    /// Requested on-exit behavior; dropped by [`on_scope_exit_column`] when unscoped.
    on_scope_exit: Option<OnScopeExit>,
    /// Final Plan window, or `None`.
    plan: Option<TimeScope>,
    /// Final explicit due window, or `None` for the derived default.
    due_scope: Option<TimeScope>,
    /// Final archival state. Never `Backlog` alongside a `Some` `plan` — [`update_task`] refuses
    /// that pair rather than writing it.
    archival: TaskArchival,
    /// Final sort position.
    position: i64,
    /// Final privacy flag.
    is_private: bool,
}

impl TaskWrite {
    /// Merges `request` over the `stored` row. Pure — it reads nothing and writes nothing.
    fn merge(
        stored: Task,
        request: UpdateTaskRequest,
    ) -> Result<Self, crate::nodes::id::NotStored> {
        let releases = releases_compound(&stored, &request);
        let reparent = match (request.parent_type, request.parent_id) {
            (Some(parent_type), Some(parent_id)) => {
                Some((parent_type, parent_id.require_stored()?))
            }
            _ => None,
        };
        // Validate against the effective parent — the new one when reparenting.
        let (parent_type, parent_id) = reparent
            .clone()
            .unwrap_or((stored.parent_type, stored.parent_id.require_stored()?));
        let status = request.status.unwrap_or(stored.status);
        let compound = request.compound.unwrap_or(stored.compound);
        let delegate_to = match request.delegate_to {
            Some(new_delegate) => new_delegate,
            None => stored.delegate_to,
        };
        // Three named states collapse to a column value here: an absent field leaves the column
        // alone, and `Inherit` is a real request that writes the NULL back.
        let agentic = match request.agentic {
            Some(new_agentic) => new_agentic.as_column(),
            None => stored.agentic,
        };
        // The template only exists while the flag is on: turning Asynchronous off takes it too.
        let asynchronous = request.asynchronous.unwrap_or(stored.asynchronous);
        let async_template = if asynchronous {
            request.async_template.unwrap_or(stored.async_template)
        } else {
            None
        };
        let agentic_brief = match request.agentic_brief {
            Some(new_brief) => new_brief,
            None => stored.agentic_brief,
        };
        let time_scope = match request.time_scope {
            Some(new_time_scope) => new_time_scope,
            None => stored.time_scope,
        };
        let plan = match request.plan {
            Some(new_plan) => new_plan,
            None => stored.plan,
        };
        let due_scope = match request.due_scope {
            Some(new_due) => new_due,
            None => stored.due_scope,
        };
        // Scheduling a backlogged task takes it out of the backlog. The gesture is unambiguous —
        // nobody plans a week for work they mean to leave aside — so it is done rather than asked
        // about; the caller raises a toast, which is what keeps it from being silent. The reverse
        // direction is the one that needs consent, and `update_task` refuses it.
        let plans_a_backlogged_task =
            request.archival.is_none() && !stored.archival.allows_plan() && plan.is_some();
        // Starting one does too, for the same reason read the other way round: you cannot be
        // actively doing something you have deliberately put down. Unlike the Plan pair this is not
        // an invariant — backlogging a task that is in progress stays allowed, and is how a
        // set-aside task remembers where the work stood — so it fires on the *request* moving the
        // task into progress, not on the merged status, and never on some other edit to a task that
        // was already in progress. The caller raises the toast here as well.
        // Started counts as a start here too: a paused task is still begun work.
        // Switching compound off keeps the status the Task already showed: nothing is begun,
        // so nothing is taken out of the backlog either.
        let starts_a_backlogged_task = request.archival.is_none()
            && !releases
            && stored.archival == TaskArchival::Backlog
            && request.status.as_ref().is_some_and(Status::is_begun);
        let archival = if plans_a_backlogged_task || starts_a_backlogged_task {
            TaskArchival::Live
        } else {
            request.archival.unwrap_or(stored.archival)
        };
        Ok(Self {
            reparent,
            parent_type,
            parent_id,
            title: request.title.unwrap_or(stored.title),
            status,
            delegate_to,
            agentic,
            asynchronous,
            compound,
            async_template,
            agentic_brief,
            time_scope,
            on_scope_exit: request.on_scope_exit.unwrap_or(stored.on_scope_exit),
            plan,
            due_scope,
            archival,
            position: request.position.unwrap_or(stored.position),
            is_private: request.is_private.unwrap_or(stored.is_private),
        })
    }
}

/// Reads and writes goals on a session's connection.
///
/// Obtained as `db.goals()` and used inline; see [`Db`] for
/// the borrow rules and for where an operation belongs. Scope containment is **not** checked
/// here — it reads scopes as well as goals, so it lives in [`create_goal`] and [`update_goal`].
pub struct GoalOperator<'session> {
    /// The session's connection, borrowed for the duration of this operator's life.
    connection: &'session mut sqlx::SqliteConnection,
}

impl<'session> GoalOperator<'session> {
    /// Wraps the connection a session is lending.
    pub(crate) fn new(connection: &'session mut sqlx::SqliteConnection) -> Self {
        Self { connection }
    }

    /// Inserts a goal row and returns it, **without validating scope containment** — use
    /// [`create_goal`], this method's only caller.
    ///
    /// **Module-private on purpose.** `db.goals().insert(request)` is the mechanically obvious way
    /// to write a goal, it takes a request type whose every field is public, and it skips the
    /// containment rules — so it must not be reachable from another module. Privacy is what makes
    /// the unvalidated write unwritable; [`create_goal`] is the only entry point.
    ///
    /// Multi-statement (the `INSERT`, then the sort-position `UPDATE`) and so **not atomic on its
    /// own**. It opens no transaction: per ADR-0004 only the outermost caller decides the
    /// boundary, and a method that began its own could never join one. See [`create_goal`] for the
    /// transactional shape.
    async fn insert(&mut self, request: CreateGoalRequest) -> Result<Goal, TaskError> {
        let status = request
            .status
            .as_ref()
            .map(|s| s.as_str())
            .unwrap_or("active");
        let (ts_start, ts_end, ts_n, ts_kind) = time_scope_columns(&request.time_scope);
        let on_exit = on_scope_exit_column(&request.time_scope, request.on_scope_exit);
        let id = sqlx::query(
            "INSERT INTO goals
                (title, parent_type, parent_id, status,
                 time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind,
                 on_scope_exit, achieved_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&request.title)
        .bind(stored_reference(&request.parent_type))
        .bind(request.parent_id.require_stored()?)
        .bind(status)
        .bind(ts_start)
        .bind(ts_end)
        .bind(ts_n)
        .bind(&ts_kind)
        .bind(on_exit)
        // A goal created achieved was achieved now, as far as anything can tell.
        .bind(
            (status == GoalStatus::Achieved.as_str())
                .then(|| waits::instant_column(expectations::now())),
        )
        .execute(&mut *self.connection)
        .await?
        .last_insert_rowid();
        sqlx::query("UPDATE goals SET position = ? WHERE id = ?")
            .bind(insertion_position())
            .bind(id)
            .execute(&mut *self.connection)
            .await?;
        self.get(GoalId(id)).await
    }

    /// Fetches a goal by id.
    pub async fn get(&mut self, id: GoalId) -> Result<Goal, TaskError> {
        let row = sqlx::query_as::<_, GoalRow>("SELECT * FROM goals WHERE id = ?")
            .bind(id.0)
            .fetch_optional(&mut *self.connection)
            .await?
            .ok_or(TaskError::GoalNotFound(id.0))?;
        let tag_ids = fetch_goal_tag_ids(&mut *self.connection, id.0).await?;
        Ok(Goal {
            tag_ids,
            ..row.into()
        })
    }

    /// The six ancestry fields of a goal, as one step of an [`ancestry::climb`].
    ///
    /// Module-private: the climb is the only caller, and it is the only thing that should be
    /// reading a half-row. Anything wanting a goal wants [`Self::get`].
    async fn ancestry_link(&mut self, id: GoalId) -> Result<AncestryLink, TaskError> {
        let row = sqlx::query_as::<_, GoalAncestryRow>(
            "SELECT parent_type, parent_id, time_scope_start_id, time_scope_end_id,
                    time_scope_duration_n, time_scope_duration_kind, on_scope_exit
             FROM goals WHERE id = ?",
        )
        .bind(id.0)
        .fetch_optional(&mut *self.connection)
        .await?
        .ok_or(TaskError::GoalNotFound(id.0))?;
        Ok(AncestryLink {
            kind: NodeKind::Goal,
            id: id.0,
            parent: NodeRef::new(row.parent_type, row.parent_id),
            time_scope: time_scope_from_row(
                row.time_scope_start_id,
                row.time_scope_end_id,
                row.time_scope_duration_n,
                row.time_scope_duration_kind,
            ),
            plan: None,
            on_scope_exit: row.on_scope_exit.as_deref().and_then(OnScopeExit::from_db),
            // Goals have no Verdict Window; only a Commitment does.
            verdict_window: None,
        })
    }

    /// The status and title of a goal, without its tags — the two columns a "blocked by goal"
    /// summary needs.
    pub async fn status_and_title(&mut self, id: GoalId) -> Result<(String, String), TaskError> {
        sqlx::query_as("SELECT status, title FROM goals WHERE id = ?")
            .bind(id.0)
            .fetch_optional(&mut *self.connection)
            .await?
            .ok_or(TaskError::GoalNotFound(id.0))
    }

    /// Lists all goals.
    pub async fn list(&mut self) -> Result<Vec<Goal>, TaskError> {
        let rows = sqlx::query_as::<_, GoalRow>("SELECT * FROM goals ORDER BY position ASC")
            .fetch_all(&mut *self.connection)
            .await?;
        let mut goals = Vec::with_capacity(rows.len());
        for row in rows {
            let tag_ids = fetch_goal_tag_ids(&mut *self.connection, row.id).await?;
            goals.push(Goal {
                tag_ids,
                ..row.into()
            });
        }
        Ok(goals)
    }

    /// Returns the ids of the goals parented directly by `(parent_type, parent_id)`.
    ///
    /// The parent link is polymorphic and has no foreign key, so subtree walks collect their
    /// children a level at a time through this.
    pub async fn child_ids(
        &mut self,
        parent_type: &str,
        parent_id: i64,
    ) -> Result<Vec<i64>, TaskError> {
        Ok(
            sqlx::query_scalar("SELECT id FROM goals WHERE parent_type = ? AND parent_id = ?")
                .bind(stored_reference(parent_type))
                .bind(parent_id)
                .fetch_all(&mut *self.connection)
                .await?,
        )
    }

    /// Writes already-merged column values onto a goal and returns the stored row. **Validates
    /// nothing** — see [`update_goal`], this method's only caller.
    ///
    /// Module-private for the same reason as [`Self::insert`]: it writes without checking the
    /// containment rules. Doubly closed, in fact — [`GoalWrite`] is private too, so even inside
    /// this module the argument can only come from `GoalWrite::merge`.
    ///
    /// Multi-statement when the write reparents (the parent link moves in its own `UPDATE`) and so
    /// **not atomic on its own**; it opens no transaction, per ADR-0004. See [`update_goal`] for
    /// the transactional shape.
    async fn update(&mut self, id: GoalId, write: GoalWrite) -> Result<Goal, TaskError> {
        let (ts_start, ts_end, ts_n, ts_kind) = time_scope_columns(&write.time_scope);
        let on_exit = on_scope_exit_column(&write.time_scope, write.on_scope_exit);

        if let Some((new_parent_type, new_parent_id)) = &write.reparent {
            sqlx::query("UPDATE goals SET parent_type = ?, parent_id = ? WHERE id = ?")
                .bind(stored_reference(new_parent_type))
                .bind(new_parent_id)
                .bind(id.0)
                .execute(&mut *self.connection)
                .await?;
        }

        sqlx::query(
            "UPDATE goals SET title=?, status=?,
                time_scope_start_id=?, time_scope_end_id=?,
                time_scope_duration_n=?, time_scope_duration_kind=?, on_scope_exit=?, position=?, is_private=?,
                achieved_at = CASE WHEN ? = 'achieved'
                                   THEN CASE WHEN status = 'achieved' THEN achieved_at ELSE ? END
                                   ELSE NULL END
             WHERE id=?",
        )
        .bind(&write.title)
        .bind(&write.status)
        .bind(ts_start)
        .bind(ts_end)
        .bind(ts_n)
        .bind(&ts_kind)
        .bind(on_exit)
        .bind(write.position)
        .bind(write.is_private)
        // Achieved keeps the instant it was first achieved; anything else clears it.
        .bind(&write.status)
        .bind(waits::instant_column(expectations::now()))
        .bind(id.0)
        .execute(&mut *self.connection)
        .await?;
        self.get(id).await
    }

    /// Deletes one goal row and nothing else. Descendants and the infos and block reasons hanging
    /// off them are the subtree cascade's job — see [`delete_goal`].
    ///
    /// Module-private: called directly it orphans the whole subtree under the goal, since the
    /// polymorphic parent links have no foreign key to cascade along.
    async fn delete_row(&mut self, id: GoalId) -> Result<(), TaskError> {
        sqlx::query("DELETE FROM goals WHERE id = ?")
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Returns true if the goal with `id` has status `achieved`.
    pub async fn is_achieved(&mut self, id: GoalId) -> Result<bool, TaskError> {
        let goal = self.get(id).await?;
        Ok(goal.status == GoalStatus::Achieved.as_str())
    }

    /// Sets a goal's privacy flag.
    ///
    /// One statement over one column, so it needs no containment check and no transaction of its
    /// own. `flows::start` uses it to propagate a flow's privacy onto the goal it materialises.
    pub async fn set_private(&mut self, id: GoalId, is_private: bool) -> Result<(), TaskError> {
        sqlx::query("UPDATE goals SET is_private = ? WHERE id = ?")
            .bind(is_private)
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Attaches a tag to a goal.
    pub async fn add_tag(&mut self, goal_id: GoalId, tag_id: i64) -> Result<(), TaskError> {
        sqlx::query("INSERT OR IGNORE INTO tags_on_goals (goal_id, tag_id) VALUES (?, ?)")
            .bind(goal_id.0)
            .bind(tag_id)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Removes a tag from a goal.
    pub async fn remove_tag(&mut self, goal_id: GoalId, tag_id: i64) -> Result<(), TaskError> {
        sqlx::query("DELETE FROM tags_on_goals WHERE goal_id = ? AND tag_id = ?")
            .bind(goal_id.0)
            .bind(tag_id)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }
}

/// Reads and writes tasks on a session's connection.
///
/// Obtained as `db.tasks()` and used inline; see [`Db`] for
/// the borrow rules and for where an operation belongs. Scope containment is **not** checked
/// here — it reads scopes and goals as well as tasks, so it lives in [`create_task`] and
/// [`update_task`].
pub struct TaskOperator<'session> {
    /// The session's connection, borrowed for the duration of this operator's life.
    connection: &'session mut sqlx::SqliteConnection,
}

impl<'session> TaskOperator<'session> {
    /// Wraps the connection a session is lending.
    pub(crate) fn new(connection: &'session mut sqlx::SqliteConnection) -> Self {
        Self { connection }
    }

    /// Inserts a task row and returns it, **without validating scope containment** — use
    /// [`create_task`], this method's only caller.
    ///
    /// **Module-private on purpose.** `db.tasks().insert(request)` is the mechanically obvious way
    /// to write a task, it takes a request type whose every field is public, and it skips the
    /// containment rules — so it must not be reachable from another module. Privacy is what makes
    /// the unvalidated write unwritable; [`create_task`] is the only entry point.
    ///
    /// Multi-statement (the `INSERT`, then the sort-position `UPDATE`) and so **not atomic on its
    /// own**. It opens no transaction: per ADR-0004 only the outermost caller decides the
    /// boundary, and a method that began its own could never join one. See [`create_task`] for the
    /// transactional shape.
    async fn insert(&mut self, request: CreateTaskRequest) -> Result<Task, TaskError> {
        let status = request.status.unwrap_or(Status::Ordinary(TaskStatus::Todo));
        let status_spelling = status_column(status)?;
        let (ts_start, ts_end, ts_n, ts_kind) = time_scope_columns(&request.time_scope);
        let on_exit = on_scope_exit_column(&request.time_scope, request.on_scope_exit);
        let (plan_start, plan_end, _, _) = time_scope_columns(&request.plan);
        let (due_start, due_end, _, _) = time_scope_columns(&request.due_scope);
        let archival = request.archival.unwrap_or_default();
        let agentic = request.agentic.unwrap_or_default().as_column();
        let asynchronous = request.asynchronous.unwrap_or(false);
        let compound = request.compound.unwrap_or(false);
        let async_template = if asynchronous {
            request.async_template.clone()
        } else {
            None
        };
        // A task created done was completed now, as far as anything can tell.
        let done_at = status
            .is_done()
            .then(|| waits::instant_column(expectations::now()));
        let id = sqlx::query(
            "INSERT INTO tasks
                (title, parent_type, parent_id, status,
                 time_scope_start_id, time_scope_end_id, time_scope_duration_n,
                 time_scope_duration_kind, on_scope_exit, plan_start_id, plan_end_id,
                 due_scope_start_id, due_scope_end_id, archival, agentic, asynchronous, done_at,
                 compound)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&request.title)
        .bind(stored_reference(&request.parent_type))
        .bind(request.parent_id.require_stored()?)
        .bind(status_spelling)
        .bind(ts_start)
        .bind(ts_end)
        .bind(ts_n)
        .bind(&ts_kind)
        .bind(on_exit)
        .bind(plan_start)
        .bind(plan_end)
        .bind(due_start)
        .bind(due_end)
        .bind(archival.as_str())
        .bind(agentic)
        .bind(asynchronous)
        .bind(done_at)
        .bind(compound)
        .execute(&mut *self.connection)
        .await?
        .last_insert_rowid();
        sqlx::query("UPDATE tasks SET position = ? WHERE id = ?")
            .bind(insertion_position())
            .bind(id)
            .execute(&mut *self.connection)
            .await?;
        self.write_async_template(TaskId(id), &async_template)
            .await?;
        self.write_agentic_brief(TaskId(id), &request.agentic_brief)
            .await?;
        self.get(TaskId(id)).await
    }

    /// Fetches a task by id.
    pub async fn get(&mut self, id: TaskId) -> Result<Task, TaskError> {
        let row = sqlx::query_as::<_, TaskRow>("SELECT * FROM tasks WHERE id = ?")
            .bind(id.0)
            .fetch_optional(&mut *self.connection)
            .await?
            .ok_or(TaskError::TaskNotFound(id.0))?;
        let tag_ids = fetch_task_tag_ids(&mut *self.connection, id.0).await?;
        let async_template = if row.asynchronous {
            self.async_template(id).await?
        } else {
            None
        };
        let agentic_brief = self.agentic_brief(id).await?;
        Ok(Task {
            tag_ids,
            async_template,
            agentic_brief,
            ..row.into()
        })
    }

    /// The six ancestry fields of a task, as one step of an [`ancestry::climb`].
    ///
    /// Module-private for the same reason as [`GoalOperator::ancestry_link`]: the climb is its
    /// only caller, and anything else wanting a task wants [`Self::get`].
    async fn ancestry_link(&mut self, id: TaskId) -> Result<AncestryLink, TaskError> {
        let row = sqlx::query_as::<_, TaskAncestryRow>(
            "SELECT parent_type, parent_id, time_scope_start_id, time_scope_end_id,
                    time_scope_duration_n, time_scope_duration_kind, on_scope_exit,
                    plan_start_id, plan_end_id
             FROM tasks WHERE id = ?",
        )
        .bind(id.0)
        .fetch_optional(&mut *self.connection)
        .await?
        .ok_or(TaskError::TaskNotFound(id.0))?;
        Ok(AncestryLink {
            kind: NodeKind::Task,
            id: id.0,
            parent: NodeRef::new(row.parent_type, row.parent_id),
            time_scope: time_scope_from_row(
                row.time_scope_start_id,
                row.time_scope_end_id,
                row.time_scope_duration_n,
                row.time_scope_duration_kind,
            ),
            plan: time_scope_from_row(row.plan_start_id, row.plan_end_id, None, None),
            on_scope_exit: row.on_scope_exit.as_deref().and_then(OnScopeExit::from_db),
            // Tasks have no Verdict Window; only a Commitment does.
            verdict_window: None,
        })
    }

    /// Lists all tasks.
    pub async fn list(&mut self) -> Result<Vec<Task>, TaskError> {
        let rows = sqlx::query_as::<_, TaskRow>("SELECT * FROM tasks ORDER BY position ASC")
            .fetch_all(&mut *self.connection)
            .await?;
        let mut briefs = self.agentic_briefs().await?;
        let mut tasks = Vec::with_capacity(rows.len());
        for row in rows {
            let tag_ids = fetch_task_tag_ids(&mut *self.connection, row.id).await?;
            let async_template = if row.asynchronous {
                self.async_template(TaskId(row.id)).await?
            } else {
                None
            };
            let agentic_brief = briefs.remove(&row.id);
            tasks.push(Task {
                tag_ids,
                async_template,
                agentic_brief,
                ..row.into()
            });
        }
        Ok(tasks)
    }

    /// Returns the ids of the tasks parented directly by `(parent_type, parent_id)`.
    ///
    /// The parent link is polymorphic and has no foreign key, so subtree walks collect their
    /// children a level at a time through this.
    pub async fn child_ids(
        &mut self,
        parent_type: &str,
        parent_id: i64,
    ) -> Result<Vec<i64>, TaskError> {
        Ok(
            sqlx::query_scalar("SELECT id FROM tasks WHERE parent_type = ? AND parent_id = ?")
                .bind(stored_reference(parent_type))
                .bind(parent_id)
                .fetch_all(&mut *self.connection)
                .await?,
        )
    }

    /// Writes already-merged column values onto a task and returns the stored row. **Validates
    /// nothing** — see [`update_task`], this method's only caller.
    ///
    /// Module-private for the same reason as [`Self::insert`]: it writes without checking the
    /// containment rules. Doubly closed, in fact — [`TaskWrite`] is private too, so even inside
    /// this module the argument can only come from `TaskWrite::merge`.
    ///
    /// Multi-statement when the write reparents (the parent link moves in its own `UPDATE`) and so
    /// **not atomic on its own**; it opens no transaction, per ADR-0004. See [`update_task`] for
    /// the transactional shape.
    async fn update(&mut self, id: TaskId, write: TaskWrite) -> Result<Task, TaskError> {
        let (ts_start, ts_end, ts_n, ts_kind) = time_scope_columns(&write.time_scope);
        let on_exit = on_scope_exit_column(&write.time_scope, write.on_scope_exit);
        let (plan_start, plan_end, _, _) = time_scope_columns(&write.plan);
        let (due_start, due_end, _, _) = time_scope_columns(&write.due_scope);
        let (delegate_kind, delegate_id) = Delegate::columns(write.delegate_to);
        let status_spelling = status_column(write.status)?;

        if let Some((new_parent_type, new_parent_id)) = &write.reparent {
            sqlx::query("UPDATE tasks SET parent_type = ?, parent_id = ? WHERE id = ?")
                .bind(stored_reference(new_parent_type))
                .bind(new_parent_id)
                .bind(id.0)
                .execute(&mut *self.connection)
                .await?;
        }

        sqlx::query(
            "UPDATE tasks SET title=?, status=?, delegate_kind=?, delegate_id=?,
                time_scope_start_id=?, time_scope_end_id=?, time_scope_duration_n=?,
                time_scope_duration_kind=?, on_scope_exit=?, plan_start_id=?, plan_end_id=?,
                due_scope_start_id=?, due_scope_end_id=?,
                archival=?, agentic=?, asynchronous=?, compound=?, position=?, is_private=?,
                done_at = CASE WHEN ?
                               THEN CASE WHEN status IN ('done', 'agentic_done') THEN done_at
                                         ELSE ? END
                               ELSE NULL END
             WHERE id=?",
        )
        .bind(&write.title)
        .bind(status_spelling)
        .bind(delegate_kind)
        .bind(delegate_id)
        .bind(ts_start)
        .bind(ts_end)
        .bind(ts_n)
        .bind(&ts_kind)
        .bind(on_exit)
        .bind(plan_start)
        .bind(plan_end)
        .bind(due_start)
        .bind(due_end)
        .bind(write.archival.as_str())
        .bind(write.agentic)
        .bind(write.asynchronous)
        .bind(write.compound)
        .bind(write.position)
        .bind(write.is_private)
        // Completing a task records when; it is when the wait its template spawns begins. Staying
        // done keeps the time, and reopening clears it.
        .bind(write.status.is_done())
        .bind(waits::instant_column(expectations::now()))
        .bind(id.0)
        .execute(&mut *self.connection)
        .await?;
        self.write_async_template(id, &write.async_template).await?;
        self.write_agentic_brief(id, &write.agentic_brief).await?;
        self.get(id).await
    }

    /// Deletes one task row, and the checks recorded on the wait it spawned. Descendants and the
    /// infos and block reasons hanging off them are the subtree cascade's job — see [`delete_task`].
    ///
    /// Module-private: called directly it orphans the whole subtree under the task, since the
    /// polymorphic parent links have no foreign key to cascade along.
    async fn delete_row(&mut self, id: TaskId) -> Result<(), TaskError> {
        sqlx::query("DELETE FROM tasks WHERE id = ?")
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?;
        // The checks made on the wait it spawned go with it; `wait_checks` has no foreign key.
        sqlx::query("DELETE FROM wait_checks WHERE wait_kind = 'spawned' AND wait_id = ?")
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Adds a dependency to a task, rejecting circular chains.
    ///
    /// **Module-private.** One write, but a **check-then-write**: the cycle search reads the edges
    /// the `INSERT` is validated against, and *nothing in the schema expresses acyclicity*, so a
    /// lost race silently creates a cycle rather than raising a constraint error. That makes the
    /// transaction part of the operation's contract, and an operator — wrapping a bare connection,
    /// deliberately mode-agnostic — cannot demand one in its signature. [`add_task_dependency`] is
    /// the entry point and this method's only caller outside the module.
    async fn add_dependency(
        &mut self,
        task_id: TaskId,
        dependency: Dependency,
    ) -> Result<(), TaskError> {
        if let Dependency::Task { id: dependency_id } = &dependency {
            if self
                .would_create_cycle(task_id, TaskId(dependency_id.require_stored()?))
                .await?
            {
                return Err(TaskError::CircularDependency);
            }
        }
        let (dependency_type, dependency_id) = dependency_parts(&dependency)?;
        sqlx::query(
            "INSERT OR IGNORE INTO task_dependencies (task_id, dependency_type, dependency_id) VALUES (?, ?, ?)",
        )
        .bind(task_id.0)
        .bind(dependency_type)
        .bind(dependency_id)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Removes a dependency from a task.
    pub async fn remove_dependency(
        &mut self,
        task_id: TaskId,
        dependency: Dependency,
    ) -> Result<(), TaskError> {
        let (dependency_type, dependency_id) = dependency_parts(&dependency)?;
        sqlx::query(
            "DELETE FROM task_dependencies WHERE task_id=? AND dependency_type=? AND dependency_id=?",
        )
        .bind(task_id.0)
        .bind(dependency_type)
        .bind(dependency_id)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Lists all dependencies for a task.
    pub async fn list_dependencies(
        &mut self,
        task_id: TaskId,
    ) -> Result<Vec<Dependency>, TaskError> {
        #[derive(sqlx::FromRow)]
        struct DependencyRow {
            dependency_type: String,
            dependency_id: i64,
        }
        let rows = sqlx::query_as::<_, DependencyRow>(
            "SELECT dependency_type, dependency_id FROM task_dependencies WHERE task_id = ?",
        )
        .bind(task_id.0)
        .fetch_all(&mut *self.connection)
        .await?;

        let dependencies = rows
            .into_iter()
            .map(|row| match row.dependency_type.as_str() {
                "task" => Dependency::Task {
                    id: row.dependency_id.into(),
                },
                expectations::EXPECTATION => Dependency::Expectation {
                    id: row.dependency_id,
                },
                _ => Dependency::Goal {
                    id: row.dependency_id.into(),
                },
            })
            .collect();
        Ok(dependencies)
    }

    /// Lists every task-dependency edge across all tasks (for the mindmap bulk load).
    pub async fn list_all_dependencies(&mut self) -> Result<Vec<TaskDependencyEdge>, TaskError> {
        let rows: Vec<(i64, String, i64)> =
            sqlx::query_as("SELECT task_id, dependency_type, dependency_id FROM task_dependencies")
                .fetch_all(&mut *self.connection)
                .await?;
        Ok(rows
            .into_iter()
            .map(
                |(task_id, dependency_type, dependency_id)| TaskDependencyEdge {
                    task_id: task_id.into(),
                    dependency_type,
                    dependency_id: dependency_id.into(),
                },
            )
            .collect())
    }

    /// Deletes every inbound dependency edge aimed at a node.
    ///
    /// Module-private: the subtree delete calls it for a wait, whose inbound edges carry no foreign
    /// key (`task_dependencies.dependency_id` is polymorphic), so nothing else would remove them.
    async fn drop_dependents(&mut self, node_type: &str, node_id: i64) -> Result<(), TaskError> {
        sqlx::query(
            "DELETE FROM task_dependencies WHERE dependency_type = ? AND dependency_id = ?",
        )
        .bind(node_type)
        .bind(node_id)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Sets a task's privacy flag.
    ///
    /// One statement over one column, so it needs no containment check and no transaction of its
    /// own. `flows::start` uses it to propagate a flow's privacy onto the task it materialises.
    pub async fn set_private(&mut self, id: TaskId, is_private: bool) -> Result<(), TaskError> {
        sqlx::query("UPDATE tasks SET is_private = ? WHERE id = ?")
            .bind(is_private)
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Attaches a tag to a task.
    pub async fn add_tag(&mut self, task_id: TaskId, tag_id: i64) -> Result<(), TaskError> {
        sqlx::query("INSERT OR IGNORE INTO tags_on_tasks (task_id, tag_id) VALUES (?, ?)")
            .bind(task_id.0)
            .bind(tag_id)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Removes a tag from a task.
    pub async fn remove_tag(&mut self, task_id: TaskId, tag_id: i64) -> Result<(), TaskError> {
        sqlx::query("DELETE FROM tags_on_tasks WHERE task_id = ? AND tag_id = ?")
            .bind(task_id.0)
            .bind(tag_id)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Returns true if making `task_id` depend on `candidate_id` would create a cycle.
    async fn would_create_cycle(
        &mut self,
        task_id: TaskId,
        candidate_id: TaskId,
    ) -> Result<bool, TaskError> {
        // BFS from candidate_id: if we can reach task_id through its dependencies, it's a cycle.
        let mut visited: HashSet<i64> = HashSet::new();
        let mut queue: VecDeque<i64> = VecDeque::new();
        queue.push_back(candidate_id.0);

        while let Some(current) = queue.pop_front() {
            if current == task_id.0 {
                return Ok(true);
            }
            if !visited.insert(current) {
                continue;
            }
            #[derive(sqlx::FromRow)]
            struct DependencyRow {
                dependency_id: i64,
            }
            let children = sqlx::query_as::<_, DependencyRow>(
                "SELECT dependency_id FROM task_dependencies WHERE task_id = ? AND dependency_type = 'task'",
            )
            .bind(current)
            .fetch_all(&mut *self.connection)
            .await?;

            for child in children {
                queue.push_back(child.dependency_id);
            }
        }
        Ok(false)
    }
}

/// Creates a goal, rejecting it if its Time Scope escapes the parent's.
///
/// Validation reads scopes as well as goals, so this is a free function over the session rather
/// than a `GoalOperator` method. It takes a transactional session because the insert writes twice
/// (the row, then its sort position) and because validating inside the transaction is what stops
/// the parent's scope changing between the check and the write.
///
/// This is the **only** way to write a goal row: the operator method underneath is module-private.
///
/// ```no_run
/// # use arlesh_core::database::session::SessionFactory;
/// # use arlesh_core::tasks::{create_goal, error::TaskError, model::CreateGoalRequest};
/// # async fn add(factory: &SessionFactory) -> Result<(), TaskError> {
/// let mut db = factory.begin().await?;
/// create_goal(&mut db, CreateGoalRequest { title: "Ship it".into(), ..Default::default() })
///     .await?;
/// db.commit().await?;
/// # Ok(())
/// # }
/// ```
#[tracing::instrument(skip(db))]
pub async fn create_goal(
    db: &mut Db<Transactional>,
    request: CreateGoalRequest,
) -> Result<Goal, TaskError> {
    scope_rules::validate_goal_containment(
        db,
        None,
        &request.parent_type,
        request.parent_id.require_stored()?,
        &request.time_scope,
    )
    .await?;
    db.goals().insert(request).await
}

/// Updates a goal, rejecting the write if the merged Time Scope escapes the effective parent's.
///
/// Reads the stored row, merges the request over it, validates, then writes — all on one
/// transactional session, so the row cannot move underneath the check. This is the **only** way to
/// change a goal row: the operator method underneath is module-private, and so is the merged
/// `GoalWrite` value it takes.
///
/// ```no_run
/// # use arlesh_core::database::session::SessionFactory;
/// # use arlesh_core::tasks::{error::TaskError, model::{GoalId, UpdateGoalRequest}, update_goal};
/// # async fn rename(factory: &SessionFactory) -> Result<(), TaskError> {
/// let mut db = factory.begin().await?;
/// update_goal(
///     &mut db,
///     GoalId(1),
///     UpdateGoalRequest { title: Some("Renamed".into()), ..Default::default() },
/// )
/// .await?;
/// db.commit().await?;
/// # Ok(())
/// # }
/// ```
#[tracing::instrument(skip(db))]
pub async fn update_goal(
    db: &mut Db<Transactional>,
    id: GoalId,
    request: UpdateGoalRequest,
) -> Result<Goal, TaskError> {
    let stored = db.goals().get(id).await?;
    let write = GoalWrite::merge(stored, request)?;
    scope_rules::validate_goal_containment(
        db,
        Some(id),
        &write.parent_type,
        write.parent_id,
        &write.time_scope,
    )
    .await?;
    let moves = write.reparent.is_some();
    let goal = db.goals().update(id, write).await?;
    // A Goal passes the Agentic flag through: moved under another ancestor, the Tasks beneath it
    // may change kind.
    if moves {
        agentic::reconcile(db, vec![agentic::Reach::Below("goal".to_string(), id.0)]).await?;
    }
    Ok(goal)
}

/// Deletes a goal and its entire subtree (descendant tasks/goals and their infos).
#[tracing::instrument(skip(db))]
pub async fn delete_goal(db: &mut Db<Transactional>, id: GoalId) -> Result<(), TaskError> {
    db.goals().get(id).await?;
    delete_node_subtree(db, "goal", id.0).await
}

/// Creates a task, rejecting it if its Time Scope or Plan escapes the windows above it.
///
/// Validation reads scopes and goals as well as tasks, so this is a free function over the session
/// rather than a `TaskOperator` method. It takes a transactional session because the insert writes
/// twice (the row, then its sort position) and because validating inside the transaction is what
/// stops an ancestor's scope changing between the check and the write.
///
/// This is the **only** way to write a task row: the operator method underneath is module-private.
///
/// ```no_run
/// # use arlesh_core::database::session::SessionFactory;
/// # use arlesh_core::tasks::{create_task, error::TaskError, model::CreateTaskRequest};
/// # async fn add(factory: &SessionFactory) -> Result<(), TaskError> {
/// let mut db = factory.begin().await?;
/// create_task(&mut db, CreateTaskRequest { title: "Write it up".into(), ..Default::default() })
///     .await?;
/// db.commit().await?;
/// # Ok(())
/// # }
/// ```
pub async fn create_task(
    db: &mut Db<Transactional>,
    request: CreateTaskRequest,
) -> Result<Task, TaskError> {
    create_task_at(db, request, expectations::now()).await
}

/// [`create_task`] as of `now` — the instant that decides whether the task is written flagged
/// **Overdue**, which lifts the bound on its Plan by its own Time Scope (see
/// `scope_rules::is_overdue`). An explicit due is held within the task's effective Time Scope. A
/// command passes the one `now` it read, so every decision in one request agrees on the time.
#[tracing::instrument(skip(db))]
pub async fn create_task_at(
    db: &mut Db<Transactional>,
    request: CreateTaskRequest,
    now: NaiveDateTime,
) -> Result<Task, TaskError> {
    let parent = (
        request.parent_type.clone(),
        request.parent_id.require_stored()?,
    );
    let own = request
        .agentic
        .map(|agentic| agentic.as_column())
        .unwrap_or(None);
    let agentic = agentic::resolves_agentic(db, None, own, (&parent.0, parent.1)).await?;
    create_task_as(db, request, now, agentic).await
}

/// [`create_task_at`] for a Task whose kind the caller has already resolved — one created under a
/// Habit occurrence reads the occurrence, which its stored parent columns do not name.
///
/// A new Task holds the To Do of its kind's model unless it names a status. A named one of the
/// other model — a duplicate made under an ancestor of the other kind — is converted to its
/// counterpart, and refused, naming the Task, when it has none.
pub(crate) async fn create_task_as(
    db: &mut Db<Transactional>,
    mut request: CreateTaskRequest,
    now: NaiveDateTime,
    agentic: bool,
) -> Result<Task, TaskError> {
    request.status = Some(match request.status {
        None => Status::todo(agentic),
        Some(Status::Agentic(model::AgenticStatus::Review)) => {
            return Err(TaskError::ReviewIsDerived)
        }
        Some(named) if named.is_agentic() == agentic => named,
        Some(named) => named
            .converted(agentic)
            .ok_or_else(|| TaskError::KindConversion(agentic::stranded(&request.title, named)))?,
    });
    reject_backlog_with_plan(request.archival.unwrap_or_default(), &request.plan)?;
    // No Spec check here: creating a task is not starting one. The one path that creates a task
    // already in progress is a duplicate, and a copy of work underway is not a start either.
    scope_rules::validate_task_containment(
        db,
        None,
        &request.parent_type,
        request.parent_id.require_stored()?,
        &scope_rules::WrittenTask {
            time_scope: &request.time_scope,
            on_exit: request.on_scope_exit,
            plan: &request.plan,
            due_scope: &request.due_scope,
            archival: request.archival.unwrap_or_default(),
            done: request.status.is_some_and(|status| status.is_done()),
        },
        now,
    )
    .await?;
    db.tasks().insert(request).await
}

/// Updates a task, rejecting the write if the merged Time Scope or Plan escapes the windows above
/// the effective parent, or if it would leave the task both backlogged and planned.
///
/// That second refusal is a question rather than a failure: it comes back as
/// [`TaskError::BacklogWithPlan`], which the command boundary reports as **needs confirmation**,
/// and the caller answers by asking again with `plan: Some(None)` alongside the backlog. The
/// opposite order is not refused at all — a request that *sets* a Plan on a backlogged task takes
/// it out of the backlog on its way through [`TaskWrite::merge`], and so does one that sets its
/// status to `in_progress` or `started`.
///
/// Reads the stored row, merges the request over it, validates, then writes — all on one
/// transactional session, so the row cannot move underneath the check. This is the **only** way to
/// change a task row: the operator method underneath is module-private, and so is the merged
/// `TaskWrite` value it takes.
///
/// ```no_run
/// # use arlesh_core::database::session::SessionFactory;
/// # use arlesh_core::tasks::{error::TaskError, model::{TaskId, UpdateTaskRequest}, update_task};
/// # async fn rename(factory: &SessionFactory) -> Result<(), TaskError> {
/// let mut db = factory.begin().await?;
/// update_task(
///     &mut db,
///     TaskId(1),
///     UpdateTaskRequest { title: Some("Renamed".into()), ..Default::default() },
/// )
/// .await?;
/// db.commit().await?;
/// # Ok(())
/// # }
/// ```
pub async fn update_task(
    db: &mut Db<Transactional>,
    id: TaskId,
    request: UpdateTaskRequest,
) -> Result<Task, TaskError> {
    update_task_at(db, id, request, expectations::now()).await
}

/// [`update_task`] as of `now` — the instant that decides whether the task, as written, is flagged
/// **Overdue**, which lifts the bound on its Plan by its own Time Scope (see
/// `scope_rules::is_overdue`). The merged row is what is judged, so a write that reopens a lapsed
/// task and plans it in one go is judged as the reopened task it leaves.
#[tracing::instrument(skip(db))]
pub async fn update_task_at(
    db: &mut Db<Transactional>,
    id: TaskId,
    request: UpdateTaskRequest,
    now: NaiveDateTime,
) -> Result<Task, TaskError> {
    let stored = db.tasks().get(id).await?;
    // A compound Task's status is derived from its sub-items, so a request naming one is
    // refused — unless the same request switches compound off, when the status it names is
    // the one kept (see `nodes::write::update_task`, which names the derived one).
    let releases = releases_compound(&stored, &request);
    if stored.compound && !releases && request.status.is_some() {
        return Err(TaskError::CompoundStatus(id.0));
    }
    // Starting is the move into begun work — In Progress or Started, On Agent or Doing — from To
    // Do or Done; a write to a task already begun is not a start (pausing, resuming, handing it
    // between the agent and the user), so an edit to one never trips the Spec rule. Nor does
    // switching compound off: the status it keeps is the one the Task already showed.
    let starts = !releases
        && request.status.as_ref().is_some_and(Status::is_begun)
        && !stored.status.is_begun();
    let requested = request.status;
    let before = stored.status;
    let title = request
        .title
        .clone()
        .unwrap_or_else(|| stored.title.clone());
    let mut write = TaskWrite::merge(stored, request)?;
    reject_backlog_with_plan(write.archival, &write.plan)?;
    // The kind the Task holds after the write — its flag, or its parent's — decides its model. A
    // change of kind converts its status explicitly, and is refused when there is no counterpart.
    let agentic = agentic::resolves_agentic(
        db,
        Some(id),
        write.agentic,
        (write.parent_type.as_str(), write.parent_id),
    )
    .await?;
    write.status = agentic::settle_status(&title, before, requested, agentic)?;
    if starts {
        agentic::require_spec(agentic, &write.agentic_brief)?;
    }
    scope_rules::validate_task_containment(
        db,
        Some(id),
        &write.parent_type,
        write.parent_id,
        &scope_rules::WrittenTask {
            time_scope: &write.time_scope,
            on_exit: write.on_scope_exit,
            plan: &write.plan,
            due_scope: &write.due_scope,
            archival: write.archival,
            done: write.status.is_done(),
        },
        now,
    )
    .await?;
    // Nothing else is written for the wait an Asynchronous task spawns: it is derived from the task
    // being done and having a template, so completing and reopening — and undoing either — are
    // just this row's own status change.
    let kind_changed = before.is_agentic() != agentic;
    let task = db.tasks().update(id, write).await?;
    // Everything beneath that inherits its kind from this Task changes kind with it.
    if kind_changed {
        agentic::reconcile(db, vec![agentic::Reach::Below("task".to_string(), id.0)]).await?;
    }
    Ok(task)
}

/// Adds a dependency to a task, rejecting chains that would close a cycle.
///
/// A **check-then-write**, and so a free function over a transactional session rather than an
/// operator method, even though it touches one resource and writes one statement. The cycle search
/// reads the very edges the `INSERT` is validated against, and **no schema constraint expresses
/// acyclicity**: two concurrent calls can each find no cycle and jointly create one, and the
/// database would accept both. The transaction is what closes that window — SQLite refuses the
/// second writer instead of letting both land — so it belongs in the signature.
///
/// ```no_run
/// # use arlesh_core::database::session::SessionFactory;
/// # use arlesh_core::tasks::{add_task_dependency, error::TaskError, model::{Dependency, TaskId}};
/// # async fn depend(factory: &SessionFactory) -> Result<(), TaskError> {
/// let mut db = factory.begin().await?;
/// add_task_dependency(&mut db, TaskId(1), Dependency::Task { id: 2.into() }).await?;
/// db.commit().await?;
/// # Ok(())
/// # }
/// ```
#[tracing::instrument(skip(db))]
pub async fn add_task_dependency(
    db: &mut Db<Transactional>,
    task_id: TaskId,
    dependency: Dependency,
) -> Result<(), TaskError> {
    // An edge onto a wait that does not exist would not dangle harmlessly: the column carries no
    // foreign key, so it would attach to whichever expectation takes that id next. Nothing can
    // depend on an expectation through it, so there is no cycle to look for.
    if let Dependency::Expectation { id } = dependency {
        db.expectations().get(ExpectationId(id)).await?;
    }
    db.tasks().add_dependency(task_id, dependency).await
}

/// Deletes a task and its entire subtree (descendant tasks, goals, commitments and expectations,
/// and their infos).
#[tracing::instrument(skip(db))]
pub async fn delete_task(db: &mut Db<Transactional>, id: TaskId) -> Result<(), TaskError> {
    db.tasks().get(id).await?;
    delete_node_subtree(db, "task", id.0).await
}

/// Fetches a task with its computed block reasons: the explicit ones plus one per unmet
/// dependency.
///
/// Reads tasks, goals and block reasons, so it is a free function over the session. Nothing is
/// written — a pooled session is enough.
#[tracing::instrument(skip(db))]
pub async fn get_task_with_blockers<M: SessionMode>(
    db: &mut Db<M>,
    id: TaskId,
) -> Result<TaskWithBlockers, TaskError> {
    get_task_with_blockers_as(db, id, &HashMap::new(), &HashMap::new()).await
}

/// [`get_task_with_blockers`], reading each stored Task's status from `served` where it has one
/// — the board's status, which for a compound Task is the one derived from its sub-items
/// ([`compound`]) and for an Agentic one may be the derived Review ([`review`]), not the one its
/// row last held. The Task's own status and every Task
/// dependency's are read this way, so the answer agrees with the board. Each dependency it is
/// blocked by is named by its short id in `names` ([`dependency_name`]).
#[tracing::instrument(skip(db, served, names))]
pub async fn get_task_with_blockers_as<M: SessionMode>(
    db: &mut Db<M>,
    id: TaskId,
    served: &HashMap<i64, Status>,
    names: &HashMap<String, String>,
) -> Result<TaskWithBlockers, TaskError> {
    let mut task = db.tasks().get(id).await?;
    if let Some(status) = served.get(&id.0) {
        task.status = *status;
    }
    // Explicit reasons first (from the block_reasons table), then virtual ones from unmet dependencies.
    let mut reasons = db.block_reasons().list_for("task", id.0).await?;

    let dependencies = db.tasks().list_dependencies(id).await?;
    for dependency in dependencies {
        match dependency {
            Dependency::Task { id: dependency_id } => {
                let row = dependency_id.require_stored()?;
                let dependency_task = db.tasks().get(TaskId(row)).await?;
                let status = served.get(&row).unwrap_or(&dependency_task.status);
                if !status.is_done() {
                    reasons.push(format!(
                        "Blocked by task {} ({})",
                        dependency_name(names, "task", &dependency_id),
                        dependency_task.title
                    ));
                }
            }
            Dependency::Goal { id: dependency_id } => {
                let (goal_status, goal_title) = db
                    .goals()
                    .status_and_title(GoalId(dependency_id.require_stored()?))
                    .await?;
                if goal_status != GoalStatus::Achieved.as_str() {
                    reasons.push(format!(
                        "Blocked by goal {} ({})",
                        dependency_name(names, "goal", &dependency_id),
                        goal_title
                    ));
                }
            }
            Dependency::Expectation { id: dependency_id } => {
                let expectation = db.expectations().get(ExpectationId(dependency_id)).await?;
                if expectation.status == ExpectationStatus::Pending {
                    reasons.push(format!(
                        "Blocked by expectation {} ({})",
                        dependency_name(names, "expectation", &NodeId::Stored(dependency_id)),
                        expectation.title
                    ));
                }
            }
        }
    }

    Ok(TaskWithBlockers {
        task,
        block_reasons: reasons,
    })
}

/// The `(dependency_type, dependency_id)` columns a stored edge is written as. An edge naming a
/// Habit occurrence is not a `task_dependencies` row — it lives in `derived_dependencies` — so a
/// derived target reaching here is refused.
fn dependency_parts(
    dependency: &Dependency,
) -> Result<(&'static str, i64), crate::nodes::id::NotStored> {
    Ok(match dependency {
        Dependency::Task { id } => ("task", id.require_stored()?),
        Dependency::Goal { id } => ("goal", id.require_stored()?),
        Dependency::Expectation { id } => (expectations::EXPECTATION, *id),
    })
}

#[cfg(test)]
mod tests;
