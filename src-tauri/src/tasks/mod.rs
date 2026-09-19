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

mod ancestry;
pub mod commitments;
pub mod error;
pub mod lifecycle;
pub mod model;
pub mod retype;
mod scope_rules;

use std::collections::{HashSet, VecDeque};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::database::session::{Db, SessionMode, Transactional};
use crate::infos::model::InfoId;
use ancestry::{AncestryLink, NodeKind, NodeRef};
pub use commitments::{
    create_commitment, delete_commitment, update_commitment, CommitmentOperator,
};
use error::TaskError;
use model::CommitmentId;
pub use scope_rules::{
    conflicts_for_new_time_scope, derive_all_scope_lifecycles, nearest_scoped_ancestor_window,
    reparent_conflicts, time_scope_window, ReparentConflicts, ViolatingDescendant,
};
use model::{
    CreateGoalRequest, CreateTaskRequest, Dependency, DurationSpec, Goal, GoalId, GoalStatus,
    OnScopeExit, Task, TaskArchival, TaskDependencyEdge, TaskId, TaskStatus, TaskWithBlockers,
    TimeScope, UpdateGoalRequest, UpdateTaskRequest,
};

// Internal row types that map directly to database columns via sqlx::FromRow.
// Public API types (Task, Goal) include derived fields like tag_ids.

/// Decomposes a Time Scope into its four flat column values for persistence.
fn time_scope_columns(
    time_scope: &Option<TimeScope>,
) -> (Option<i64>, Option<i64>, Option<i64>, Option<String>) {
    match time_scope {
        Some(ts) => {
            let (n, kind) = match &ts.duration {
                Some(d) => (Some(d.n), Some(d.kind.clone())),
                None => (None, None),
            };
            (Some(ts.start_id), Some(ts.end_id), n, kind)
        }
        None => (None, None, None, None),
    }
}

/// The `on_scope_exit` column value for a write: absent (NULL) when the item is unscoped, otherwise
/// the requested behavior defaulted to `keep` (the UI always supplies an explicit choice; this keeps
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

/// Refuses a write that would leave a Task both backlogged and planned.
///
/// The invariant is `archival = Backlog ⇒ plan IS NULL`, and this is the single place it is
/// enforced, for creates and updates alike. It is deliberately not a schema CHECK: the frontend
/// answers this refusal by asking again with the Plan cleared, which reads as a prompt rather than
/// as corrupt input.
fn reject_backlog_with_plan(
    archival: TaskArchival,
    plan: &Option<TimeScope>,
) -> Result<(), TaskError> {
    if plan.is_some() && !archival.allows_plan() {
        return Err(TaskError::BacklogWithPlan);
    }
    Ok(())
}

/// The millisecond timestamp a freshly inserted row takes as its sort position.
fn insertion_position() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64
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
        db.infos().delete(InfoId(id)).await?;
    }
    Ok(())
}

/// Cascade-deletes a content-node subtree: the node, every descendant task, goal and commitment,
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
        stack.extend(commitment_children.into_iter().map(|id| ("commitment".to_string(), id)));
    }
    for (node_type, node_id) in &nodes {
        delete_infos_under(db, node_type, *node_id).await?;
        // Block reasons hang off a polymorphic owner link with no foreign key, like infos. A
        // Commitment never has any, and asking for none costs one statement against the risk of
        // leaving a stale row behind if that ever changes.
        db.block_reasons().delete_for(node_type, *node_id).await?;
        match node_type.as_str() {
            "goal" => db.goals().delete_row(GoalId(*node_id)).await?,
            "commitment" => db.commitments().delete_row(CommitmentId(*node_id)).await?,
            _ => db.tasks().delete_row(TaskId(*node_id)).await?,
        }
    }
    Ok(())
}

/// Reassembles a Time Scope value object from its flat row columns. A scope exists only when
/// both boundary ids are present; the duration parameters are optional metadata on top.
fn time_scope_from_row(
    start_id: Option<i64>,
    end_id: Option<i64>,
    duration_n: Option<i64>,
    duration_kind: Option<String>,
) -> Option<TimeScope> {
    let (start_id, end_id) = (start_id?, end_id?);
    let duration = match (duration_n, duration_kind) {
        (Some(n), Some(kind)) => Some(DurationSpec { n, kind }),
        _ => None,
    };
    Some(TimeScope {
        start_id,
        end_id,
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
    delegate_to: Option<i64>,
    time_scope_start_id: Option<i64>,
    time_scope_end_id: Option<i64>,
    time_scope_duration_n: Option<i64>,
    time_scope_duration_kind: Option<String>,
    on_scope_exit: Option<String>,
    plan_start_id: Option<i64>,
    plan_end_id: Option<i64>,
    archival: String,
    position: i64,
    is_private: bool,
    beads_id: Option<String>,
}

impl From<TaskRow> for Task {
    fn from(row: TaskRow) -> Self {
        Self {
            id: row.id,
            title: row.title,
            parent_type: row.parent_type,
            parent_id: row.parent_id,
            status: row.status,
            delegate_to: row.delegate_to,
            time_scope: time_scope_from_row(
                row.time_scope_start_id,
                row.time_scope_end_id,
                row.time_scope_duration_n,
                row.time_scope_duration_kind,
            ),
            on_scope_exit: row.on_scope_exit.as_deref().and_then(OnScopeExit::from_db),
            plan: time_scope_from_row(row.plan_start_id, row.plan_end_id, None, None),
            // An unrecognised spelling reads as Live — the least surprising fallback, and the one
            // that never hides work. The CHECK constraint is what keeps it from arising.
            archival: TaskArchival::from_db(&row.archival).unwrap_or_default(),
            tag_ids: vec![],
            position: row.position,
            is_private: row.is_private,
            beads_id: row.beads_id,
        }
    }
}

#[derive(sqlx::FromRow)]
struct GoalRow {
    id: i64,
    title: String,
    parent_type: String,
    parent_id: i64,
    status: String,
    time_scope_start_id: Option<i64>,
    time_scope_end_id: Option<i64>,
    time_scope_duration_n: Option<i64>,
    time_scope_duration_kind: Option<String>,
    on_scope_exit: Option<String>,
    position: i64,
    is_private: bool,
    beads_id: Option<String>,
}

impl From<GoalRow> for Goal {
    fn from(row: GoalRow) -> Self {
        Self {
            id: row.id,
            title: row.title,
            parent_type: row.parent_type,
            parent_id: row.parent_id,
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
            beads_id: row.beads_id,
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
    time_scope_start_id: Option<i64>,
    time_scope_end_id: Option<i64>,
    time_scope_duration_n: Option<i64>,
    time_scope_duration_kind: Option<String>,
    on_scope_exit: Option<String>,
    plan_start_id: Option<i64>,
    plan_end_id: Option<i64>,
}

/// The narrow goal row one step of an ancestry climb reads. Goals have no Plan column, so the
/// link's `plan` is always absent.
#[derive(sqlx::FromRow)]
struct GoalAncestryRow {
    parent_type: String,
    parent_id: i64,
    time_scope_start_id: Option<i64>,
    time_scope_end_id: Option<i64>,
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
    fn merge(stored: Goal, request: UpdateGoalRequest) -> Self {
        let reparent = match (request.parent_type, request.parent_id) {
            (Some(parent_type), Some(parent_id)) => Some((parent_type, parent_id)),
            _ => None,
        };
        let (parent_type, parent_id) =
            reparent.clone().unwrap_or((stored.parent_type, stored.parent_id));
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
        Self {
            reparent,
            parent_type,
            parent_id,
            title: request.title.unwrap_or(stored.title),
            status,
            time_scope,
            on_scope_exit: request.on_scope_exit.unwrap_or(stored.on_scope_exit),
            position: request.position.unwrap_or(stored.position),
            is_private: request.is_private.unwrap_or(stored.is_private),
        }
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
    /// Final status, as its database string.
    status: String,
    /// Final delegate, or `None`.
    delegate_to: Option<i64>,
    /// Final Time Scope, or `None` for unscoped.
    time_scope: Option<TimeScope>,
    /// Requested on-exit behavior; dropped by [`on_scope_exit_column`] when unscoped.
    on_scope_exit: Option<OnScopeExit>,
    /// Final Plan window, or `None`.
    plan: Option<TimeScope>,
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
    fn merge(stored: Task, request: UpdateTaskRequest) -> Self {
        let reparent = match (request.parent_type, request.parent_id) {
            (Some(parent_type), Some(parent_id)) => Some((parent_type, parent_id)),
            _ => None,
        };
        // Validate against the effective parent — the new one when reparenting.
        let (parent_type, parent_id) =
            reparent.clone().unwrap_or((stored.parent_type, stored.parent_id));
        let status = request
            .status
            .as_ref()
            .map(|s| s.as_str())
            .unwrap_or(&stored.status)
            .to_string();
        let delegate_to = match request.delegate_to {
            Some(new_delegate) => new_delegate,
            None => stored.delegate_to,
        };
        let time_scope = match request.time_scope {
            Some(new_time_scope) => new_time_scope,
            None => stored.time_scope,
        };
        let plan = match request.plan {
            Some(new_plan) => new_plan,
            None => stored.plan,
        };
        // Scheduling a backlogged task takes it out of the backlog. The gesture is unambiguous —
        // nobody plans a week for work they mean to leave aside — so it is done rather than asked
        // about; the caller raises a toast, which is what keeps it from being silent. The reverse
        // direction is the one that needs consent, and `update_task` refuses it.
        let plans_a_backlogged_task =
            request.archival.is_none() && !stored.archival.allows_plan() && plan.is_some();
        let archival = if plans_a_backlogged_task {
            TaskArchival::Live
        } else {
            request.archival.unwrap_or(stored.archival)
        };
        Self {
            reparent,
            parent_type,
            parent_id,
            title: request.title.unwrap_or(stored.title),
            status,
            delegate_to,
            time_scope,
            on_scope_exit: request.on_scope_exit.unwrap_or(stored.on_scope_exit),
            plan,
            archival,
            position: request.position.unwrap_or(stored.position),
            is_private: request.is_private.unwrap_or(stored.is_private),
        }
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
        let status = request.status.as_ref().map(|s| s.as_str()).unwrap_or("active");
        let (ts_start, ts_end, ts_n, ts_kind) = time_scope_columns(&request.time_scope);
        let on_exit = on_scope_exit_column(&request.time_scope, request.on_scope_exit);
        let id = sqlx::query(
            "INSERT INTO goals
                (title, parent_type, parent_id, status,
                 time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind,
                 on_scope_exit)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&request.title)
        .bind(&request.parent_type)
        .bind(request.parent_id)
        .bind(status)
        .bind(ts_start)
        .bind(ts_end)
        .bind(ts_n)
        .bind(&ts_kind)
        .bind(on_exit)
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
        Ok(Goal { tag_ids, ..row.into() })
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
            goals.push(Goal { tag_ids, ..row.into() });
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
                .bind(parent_type)
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
            sqlx::query(
                "UPDATE goals SET parent_type = ?, parent_id = ? WHERE id = ?",
            )
            .bind(new_parent_type)
            .bind(new_parent_id)
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?;
        }

        sqlx::query(
            "UPDATE goals SET title=?, status=?,
                time_scope_start_id=?, time_scope_end_id=?,
                time_scope_duration_n=?, time_scope_duration_kind=?, on_scope_exit=?, position=?, is_private=? WHERE id=?",
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

    /// Links a goal to the `bd` issue tracking it, or unlinks it when given `None`.
    ///
    /// **The only setter of `beads_id`, and the MCP server is its only *source*.**
    /// [`UpdateGoalRequest`] has no field for it, so no gesture can author, edit or clear a link from the UI.
    /// One command does reach this method: [`duplicate_subtree`](crate::duplicate::duplicate_subtree)
    /// *propagates* an id a node already carries onto its copy — SPEC's named exception. It can
    /// only ever pass on a value `bd` issued, never invent or change one.
    ///
    /// `bd` owns the issue; the app only mirrors which one a node belongs to.
    ///
    /// One statement over one column, so it needs no containment check and no transaction of its
    /// own. Errors with [`TaskError::GoalNotFound`] when no goal has that id, rather than reporting
    /// success for a write that landed nowhere.
    pub async fn set_beads_id(
        &mut self,
        id: GoalId,
        beads_id: Option<String>,
    ) -> Result<(), TaskError> {
        let affected = sqlx::query("UPDATE goals SET beads_id = ? WHERE id = ?")
            .bind(&beads_id)
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?
            .rows_affected();
        if affected == 0 {
            return Err(TaskError::GoalNotFound(id.0));
        }
        Ok(())
    }

    /// Attaches a tag to a goal.
    pub async fn add_tag(&mut self, goal_id: GoalId, tag_id: i64) -> Result<(), TaskError> {
        sqlx::query(
            "INSERT OR IGNORE INTO tags_on_goals (goal_id, tag_id) VALUES (?, ?)",
        )
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
        let status = request.status.as_ref().map(|s| s.as_str()).unwrap_or("todo");
        let (ts_start, ts_end, ts_n, ts_kind) = time_scope_columns(&request.time_scope);
        let on_exit = on_scope_exit_column(&request.time_scope, request.on_scope_exit);
        let (plan_start, plan_end, _, _) = time_scope_columns(&request.plan);
        let archival = request.archival.unwrap_or_default();
        let id = sqlx::query(
            "INSERT INTO tasks
                (title, parent_type, parent_id, status,
                 time_scope_start_id, time_scope_end_id, time_scope_duration_n,
                 time_scope_duration_kind, on_scope_exit, plan_start_id, plan_end_id, archival)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&request.title)
        .bind(&request.parent_type)
        .bind(request.parent_id)
        .bind(status)
        .bind(ts_start)
        .bind(ts_end)
        .bind(ts_n)
        .bind(&ts_kind)
        .bind(on_exit)
        .bind(plan_start)
        .bind(plan_end)
        .bind(archival.as_str())
        .execute(&mut *self.connection)
        .await?
        .last_insert_rowid();
        sqlx::query("UPDATE tasks SET position = ? WHERE id = ?")
            .bind(insertion_position())
            .bind(id)
            .execute(&mut *self.connection)
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
        Ok(Task { tag_ids, ..row.into() })
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
        let mut tasks = Vec::with_capacity(rows.len());
        for row in rows {
            let tag_ids = fetch_task_tag_ids(&mut *self.connection, row.id).await?;
            tasks.push(Task { tag_ids, ..row.into() });
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
                .bind(parent_type)
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

        if let Some((new_parent_type, new_parent_id)) = &write.reparent {
            sqlx::query(
                "UPDATE tasks SET parent_type = ?, parent_id = ? WHERE id = ?",
            )
            .bind(new_parent_type)
            .bind(new_parent_id)
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?;
        }

        sqlx::query(
            "UPDATE tasks SET title=?, status=?, delegate_to=?,
                time_scope_start_id=?, time_scope_end_id=?, time_scope_duration_n=?,
                time_scope_duration_kind=?, on_scope_exit=?, plan_start_id=?, plan_end_id=?,
                archival=?, position=?, is_private=? WHERE id=?",
        )
        .bind(&write.title)
        .bind(&write.status)
        .bind(write.delegate_to)
        .bind(ts_start)
        .bind(ts_end)
        .bind(ts_n)
        .bind(&ts_kind)
        .bind(on_exit)
        .bind(plan_start)
        .bind(plan_end)
        .bind(write.archival.as_str())
        .bind(write.position)
        .bind(write.is_private)
        .bind(id.0)
        .execute(&mut *self.connection)
        .await?;
        self.get(id).await
    }

    /// Deletes one task row and nothing else. Descendants and the infos and block reasons hanging
    /// off them are the subtree cascade's job — see [`delete_task`].
    ///
    /// Module-private: called directly it orphans the whole subtree under the task, since the
    /// polymorphic parent links have no foreign key to cascade along.
    async fn delete_row(&mut self, id: TaskId) -> Result<(), TaskError> {
        sqlx::query("DELETE FROM tasks WHERE id = ?")
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
        if let Dependency::Task { id: dependency_id } = dependency {
            if self.would_create_cycle(task_id, TaskId(dependency_id)).await? {
                return Err(TaskError::CircularDependency);
            }
        }
        let (dependency_type, dependency_id) = dependency_parts(&dependency);
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
        let (dependency_type, dependency_id) = dependency_parts(&dependency);
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
    pub async fn list_dependencies(&mut self, task_id: TaskId) -> Result<Vec<Dependency>, TaskError> {
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
                "task" => Dependency::Task { id: row.dependency_id },
                _ => Dependency::Goal { id: row.dependency_id },
            })
            .collect();
        Ok(dependencies)
    }

    /// Lists every task-dependency edge across all tasks (for the mindmap bulk load).
    pub async fn list_all_dependencies(&mut self) -> Result<Vec<TaskDependencyEdge>, TaskError> {
        let rows: Vec<(i64, String, i64)> = sqlx::query_as(
            "SELECT task_id, dependency_type, dependency_id FROM task_dependencies",
        )
        .fetch_all(&mut *self.connection)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(task_id, dependency_type, dependency_id)| TaskDependencyEdge {
                task_id,
                dependency_type,
                dependency_id,
            })
            .collect())
    }

    /// Counts the dependency edges that point **at** `(node_type, node_id)` — the rows where it
    /// is the thing depended on rather than the dependent.
    ///
    /// Module-private: only [`retype`] asks, and only because those rows carry no foreign key
    /// (`task_dependencies.dependency_id` is polymorphic) and so nothing else would notice them
    /// going stale.
    async fn count_dependents(&mut self, node_type: &str, node_id: i64) -> Result<i64, TaskError> {
        Ok(sqlx::query_scalar(
            "SELECT COUNT(*) FROM task_dependencies WHERE dependency_type = ? AND dependency_id = ?",
        )
        .bind(node_type)
        .bind(node_id)
        .fetch_one(&mut *self.connection)
        .await?)
    }

    /// Counts the dependency edges a task owns — the things it is waiting on.
    ///
    /// Module-private, for the same caller: they die with the task row's `ON DELETE CASCADE`, so
    /// a retype away from `task` has to count them before it can say what it is about to drop.
    async fn count_dependencies(&mut self, task_id: TaskId) -> Result<i64, TaskError> {
        Ok(
            sqlx::query_scalar("SELECT COUNT(*) FROM task_dependencies WHERE task_id = ?")
                .bind(task_id.0)
                .fetch_one(&mut *self.connection)
                .await?,
        )
    }

    /// Aims every inbound dependency edge at a different node.
    ///
    /// **Module-private, and only ever correct inside a retype's transaction.** The rows it moves
    /// have no foreign key on `dependency_id`, and no table in this schema uses `AUTOINCREMENT`,
    /// so SQLite hands a deleted row's id to the next insert: an edge left pointing at a deleted
    /// node does not dangle harmlessly, it silently re-attaches to whatever unrelated task or
    /// goal is created next. Repointing before the delete is what stops that.
    async fn repoint_dependents(
        &mut self,
        from_type: &str,
        from_id: i64,
        to_type: &str,
        to_id: i64,
    ) -> Result<(), TaskError> {
        // `OR IGNORE`: the primary key is (task_id, dependency_type, dependency_id), so a task
        // already depending on the destination would collide. That edge is redundant, and the row
        // it would have duplicated is dropped by the sweep just below.
        sqlx::query(
            "UPDATE OR IGNORE task_dependencies SET dependency_type = ?, dependency_id = ?
             WHERE dependency_type = ? AND dependency_id = ?",
        )
        .bind(to_type)
        .bind(to_id)
        .bind(from_type)
        .bind(from_id)
        .execute(&mut *self.connection)
        .await?;
        self.drop_dependents(from_type, from_id).await
    }

    /// Deletes every inbound dependency edge aimed at a node.
    ///
    /// Module-private. The counterpart to [`Self::repoint_dependents`] for a retype whose target
    /// cannot be depended on at all: only a task or a goal can, so becoming a domain, project or
    /// tag ends those edges rather than moving them.
    async fn drop_dependents(&mut self, node_type: &str, node_id: i64) -> Result<(), TaskError> {
        sqlx::query("DELETE FROM task_dependencies WHERE dependency_type = ? AND dependency_id = ?")
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

    /// Links a task to the `bd` issue tracking it, or unlinks it when given `None`.
    ///
    /// **The only setter of `beads_id`, and the MCP server is its only *source*.**
    /// [`UpdateTaskRequest`] has no field for it, so no gesture can author, edit or clear a link from the UI.
    /// One command does reach this method: [`duplicate_subtree`](crate::duplicate::duplicate_subtree)
    /// *propagates* an id a node already carries onto its copy — SPEC's named exception. It can
    /// only ever pass on a value `bd` issued, never invent or change one.
    ///
    /// `bd` owns the issue; the app only mirrors which one a node belongs to.
    ///
    /// One statement over one column, so it needs no containment check and no transaction of its
    /// own. Errors with [`TaskError::TaskNotFound`] when no task has that id, rather than reporting
    /// success for a write that landed nowhere.
    pub async fn set_beads_id(
        &mut self,
        id: TaskId,
        beads_id: Option<String>,
    ) -> Result<(), TaskError> {
        let affected = sqlx::query("UPDATE tasks SET beads_id = ? WHERE id = ?")
            .bind(&beads_id)
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?
            .rows_affected();
        if affected == 0 {
            return Err(TaskError::TaskNotFound(id.0));
        }
        Ok(())
    }

    /// Attaches a tag to a task.
    pub async fn add_tag(&mut self, task_id: TaskId, tag_id: i64) -> Result<(), TaskError> {
        sqlx::query(
            "INSERT OR IGNORE INTO tags_on_tasks (task_id, tag_id) VALUES (?, ?)",
        )
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
/// # use arlesh_lib::database::session::SessionFactory;
/// # use arlesh_lib::tasks::{create_goal, error::TaskError, model::CreateGoalRequest};
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
        &request.parent_type,
        request.parent_id,
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
/// # use arlesh_lib::database::session::SessionFactory;
/// # use arlesh_lib::tasks::{error::TaskError, model::{GoalId, UpdateGoalRequest}, update_goal};
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
    let write = GoalWrite::merge(stored, request);
    scope_rules::validate_goal_containment(db, &write.parent_type, write.parent_id, &write.time_scope)
        .await?;
    db.goals().update(id, write).await
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
/// # use arlesh_lib::database::session::SessionFactory;
/// # use arlesh_lib::tasks::{create_task, error::TaskError, model::CreateTaskRequest};
/// # async fn add(factory: &SessionFactory) -> Result<(), TaskError> {
/// let mut db = factory.begin().await?;
/// create_task(&mut db, CreateTaskRequest { title: "Write it up".into(), ..Default::default() })
///     .await?;
/// db.commit().await?;
/// # Ok(())
/// # }
/// ```
#[tracing::instrument(skip(db))]
pub async fn create_task(
    db: &mut Db<Transactional>,
    request: CreateTaskRequest,
) -> Result<Task, TaskError> {
    reject_backlog_with_plan(request.archival.unwrap_or_default(), &request.plan)?;
    scope_rules::validate_task_containment(
        db,
        &request.parent_type,
        request.parent_id,
        &request.time_scope,
        &request.plan,
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
/// it out of the backlog on its way through [`TaskWrite::merge`].
///
/// Reads the stored row, merges the request over it, validates, then writes — all on one
/// transactional session, so the row cannot move underneath the check. This is the **only** way to
/// change a task row: the operator method underneath is module-private, and so is the merged
/// `TaskWrite` value it takes.
///
/// ```no_run
/// # use arlesh_lib::database::session::SessionFactory;
/// # use arlesh_lib::tasks::{error::TaskError, model::{TaskId, UpdateTaskRequest}, update_task};
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
#[tracing::instrument(skip(db))]
pub async fn update_task(
    db: &mut Db<Transactional>,
    id: TaskId,
    request: UpdateTaskRequest,
) -> Result<Task, TaskError> {
    let stored = db.tasks().get(id).await?;
    let write = TaskWrite::merge(stored, request);
    reject_backlog_with_plan(write.archival, &write.plan)?;
    scope_rules::validate_task_containment(
        db,
        &write.parent_type,
        write.parent_id,
        &write.time_scope,
        &write.plan,
    )
    .await?;
    db.tasks().update(id, write).await
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
/// (Contrast [`crate::scopes::ScopeOperator::get_or_create`], whose probe-then-insert stays an
/// operator method because a unique index independently enforces what it checks.)
///
/// ```no_run
/// # use arlesh_lib::database::session::SessionFactory;
/// # use arlesh_lib::tasks::{add_task_dependency, error::TaskError, model::{Dependency, TaskId}};
/// # async fn depend(factory: &SessionFactory) -> Result<(), TaskError> {
/// let mut db = factory.begin().await?;
/// add_task_dependency(&mut db, TaskId(1), Dependency::Task { id: 2 }).await?;
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
    db.tasks().add_dependency(task_id, dependency).await
}

/// Deletes a task and its entire subtree (descendant tasks/goals and their infos).
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
    let task = db.tasks().get(id).await?;
    // Explicit reasons first (from the block_reasons table), then virtual ones from unmet dependencies.
    let mut reasons = db.block_reasons().list_for("task", id.0).await?;

    let dependencies = db.tasks().list_dependencies(id).await?;
    for dependency in dependencies {
        match dependency {
            Dependency::Task { id: dependency_id } => {
                let dependency_task = db.tasks().get(TaskId(dependency_id)).await?;
                if dependency_task.status != TaskStatus::Done.as_str() {
                    reasons.push(format!(
                        "Blocked by task {} ({})",
                        dependency_id, dependency_task.title
                    ));
                }
            }
            Dependency::Goal { id: dependency_id } => {
                let (goal_status, goal_title) =
                    db.goals().status_and_title(GoalId(dependency_id)).await?;
                if goal_status != GoalStatus::Achieved.as_str() {
                    reasons.push(format!(
                        "Blocked by goal {} ({})",
                        dependency_id, goal_title
                    ));
                }
            }
        }
    }

    Ok(TaskWithBlockers { task, block_reasons: reasons })
}

fn dependency_parts(dependency: &Dependency) -> (&'static str, i64) {
    match dependency {
        Dependency::Task { id } => ("task", *id),
        Dependency::Goal { id } => ("goal", *id),
    }
}

#[cfg(test)]
#[cfg_attr(coverage_nightly, coverage(off))]
mod tests {
    use super::*;
    use crate::tasks::model::Dependency;

    #[test]
    fn dependency_parts_task_variant() {
        let (ty, id) = dependency_parts(&Dependency::Task { id: 42 });
        assert_eq!(ty, "task");
        assert_eq!(id, 42);
    }

    #[test]
    fn dependency_parts_goal_variant() {
        let (ty, id) = dependency_parts(&Dependency::Goal { id: 99 });
        assert_eq!(ty, "goal");
        assert_eq!(id, 99);
    }

    fn stored_task() -> Task {
        Task {
            id: 1,
            title: "Stored".to_string(),
            parent_type: "project".to_string(),
            parent_id: 7,
            status: TaskStatus::Todo.as_str().to_string(),
            delegate_to: Some(3),
            time_scope: Some(TimeScope { start_id: 10, end_id: 11, duration: None }),
            on_scope_exit: Some(OnScopeExit::Keep),
            plan: Some(TimeScope { start_id: 12, end_id: 12, duration: None }),
            archival: TaskArchival::Live,
            tag_ids: vec![],
            position: 100,
            is_private: false,
            // Tracked in `bd`. `TaskWrite` has no counterpart field, so the merge below cannot
            // carry it either way — which is the write-path constraint, stated in the type.
            beads_id: Some("Arlesh-5fs".to_string()),
        }
    }

    /// The same row, set aside — and so, by the invariant, unplanned.
    fn backlogged_task() -> Task {
        Task { plan: None, archival: TaskArchival::Backlog, ..stored_task() }
    }

    #[test]
    fn merging_leaves_a_backlogged_task_in_the_backlog_when_nothing_says_otherwise() {
        let write = TaskWrite::merge(backlogged_task(), UpdateTaskRequest {
            title: Some("Renamed".to_string()),
            ..Default::default()
        });
        assert_eq!(write.archival, TaskArchival::Backlog);
    }

    #[test]
    fn setting_a_plan_on_a_backlogged_task_takes_it_out_of_the_backlog() {
        // The unambiguous gesture: nobody schedules a week for work they mean to leave aside. The
        // caller raises a toast, which is what keeps this from being a silent change.
        let plan = TimeScope { start_id: 20, end_id: 20, duration: None };
        let write = TaskWrite::merge(backlogged_task(), UpdateTaskRequest {
            plan: Some(Some(plan.clone())),
            ..Default::default()
        });
        assert_eq!(write.archival, TaskArchival::Live);
        assert_eq!(write.plan, Some(plan));
    }

    #[test]
    fn an_explicit_backlog_is_never_overridden_by_the_plan_rule() {
        // Asking for both is a contradiction, and `update_task` refuses it — but the merge must
        // report what was asked for rather than quietly resolving it one way.
        let plan = TimeScope { start_id: 20, end_id: 20, duration: None };
        let write = TaskWrite::merge(backlogged_task(), UpdateTaskRequest {
            plan: Some(Some(plan)),
            archival: Some(TaskArchival::Backlog),
            ..Default::default()
        });
        assert_eq!(write.archival, TaskArchival::Backlog);
        assert!(write.plan.is_some());
    }

    #[test]
    fn a_live_task_that_keeps_its_plan_is_untouched_by_the_backlog_rule() {
        let write = TaskWrite::merge(stored_task(), UpdateTaskRequest::default());
        assert_eq!(write.archival, TaskArchival::Live);
        assert!(write.plan.is_some());
    }

    #[test]
    fn the_invariant_refuses_backlog_with_a_plan_and_allows_every_other_pair() {
        let plan = Some(TimeScope { start_id: 1, end_id: 1, duration: None });
        assert!(matches!(
            reject_backlog_with_plan(TaskArchival::Backlog, &plan),
            Err(TaskError::BacklogWithPlan)
        ));
        assert!(reject_backlog_with_plan(TaskArchival::Backlog, &None).is_ok());
        assert!(reject_backlog_with_plan(TaskArchival::Live, &plan).is_ok());
        assert!(reject_backlog_with_plan(TaskArchival::Live, &None).is_ok());
    }

    #[test]
    fn an_empty_update_request_writes_the_stored_row_back_unchanged() {
        let write = TaskWrite::merge(stored_task(), UpdateTaskRequest::default());
        assert!(write.reparent.is_none());
        assert_eq!(write.parent_type, "project");
        assert_eq!(write.parent_id, 7);
        assert_eq!(write.title, "Stored");
        assert_eq!(write.delegate_to, Some(3));
        assert_eq!(write.position, 100);
        assert!(!write.is_private);
    }

    #[test]
    fn clearing_the_time_scope_clears_it_rather_than_keeping_the_stored_one() {
        let write = TaskWrite::merge(
            stored_task(),
            UpdateTaskRequest { time_scope: Some(None), ..Default::default() },
        );
        assert_eq!(write.time_scope, None);
    }

    #[test]
    fn a_reparent_needs_both_halves_and_becomes_the_validated_parent() {
        let half = TaskWrite::merge(
            stored_task(),
            UpdateTaskRequest { parent_type: Some("goal".into()), ..Default::default() },
        );
        assert!(half.reparent.is_none(), "a parent type without an id is not a move");
        assert_eq!(half.parent_type, "project");

        let full = TaskWrite::merge(
            stored_task(),
            UpdateTaskRequest {
                parent_type: Some("goal".into()),
                parent_id: Some(42),
                ..Default::default()
            },
        );
        assert_eq!(full.reparent, Some(("goal".to_string(), 42)));
        assert_eq!(full.parent_type, "goal");
        assert_eq!(full.parent_id, 42);
    }

    #[test]
    fn a_goal_update_merges_its_request_over_the_stored_row() {
        let stored = Goal {
            id: 2,
            title: "Stored".to_string(),
            parent_type: "project".to_string(),
            parent_id: 7,
            status: GoalStatus::Active.as_str().to_string(),
            time_scope: None,
            on_scope_exit: None,
            tag_ids: vec![],
            position: 5,
            is_private: true,
            // As in `stored_task`: `GoalWrite` has no `beads_id`, so an update cannot reach it.
            beads_id: Some("Arlesh-5fs".to_string()),
        };
        let write = GoalWrite::merge(
            stored,
            UpdateGoalRequest {
                status: Some(GoalStatus::Achieved),
                position: Some(9),
                ..Default::default()
            },
        );
        assert_eq!(write.title, "Stored");
        assert_eq!(write.status, GoalStatus::Achieved.as_str());
        assert_eq!(write.position, 9);
        assert!(write.is_private);
    }
}
