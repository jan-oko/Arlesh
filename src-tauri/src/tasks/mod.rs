//! Tasks and Goals: action items and desired states.

pub mod error;
pub mod lifecycle;
pub mod model;
mod scope_rules;

use std::collections::{HashSet, VecDeque};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::database::DatabasePool;
use error::TaskError;
pub use scope_rules::{
    derive_all_scope_lifecycles, effective_window, time_scope_bounds, ReparentConflicts,
    ViolatingDescendant,
};
use model::{
    CreateGoalRequest, CreateTaskRequest, Dependency, DurationSpec, Goal, GoalId, GoalStatus,
    OnScopeExit, Task, TaskDependencyEdge, TaskId, TaskStatus, TaskWithBlockers, TimeScope,
    UpdateGoalRequest, UpdateTaskRequest,
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

/// Deletes every info that hangs (directly or transitively) under `(parent_type, parent_id)`.
/// Infos nest polymorphically with no foreign key, so the subtree is walked explicitly.
async fn delete_infos_under(
    pool: &DatabasePool,
    parent_type: &str,
    parent_id: i64,
) -> Result<(), TaskError> {
    let mut stack: Vec<i64> =
        sqlx::query_scalar("SELECT id FROM infos WHERE parent_type = ? AND parent_id = ?")
            .bind(parent_type)
            .bind(parent_id)
            .fetch_all(pool)
            .await?;
    let mut all = Vec::new();
    while let Some(id) = stack.pop() {
        all.push(id);
        let children: Vec<i64> =
            sqlx::query_scalar("SELECT id FROM infos WHERE parent_type = 'info' AND parent_id = ?")
                .bind(id)
                .fetch_all(pool)
                .await?;
        stack.extend(children);
    }
    for id in all {
        sqlx::query("DELETE FROM infos WHERE id = ?").bind(id).execute(pool).await?;
    }
    Ok(())
}

/// Cascade-deletes a task/goal subtree: the node, every descendant task/goal, and all infos under
/// them. Dependencies and tags fall away via their `ON DELETE CASCADE` foreign keys; the polymorphic
/// parent links do not, so descendants are collected explicitly to avoid orphaning them.
async fn delete_task_goal_subtree(
    pool: &DatabasePool,
    root_type: &str,
    root_id: i64,
) -> Result<(), TaskError> {
    let mut stack = vec![(root_type.to_string(), root_id)];
    let mut nodes = Vec::new();
    while let Some((node_type, node_id)) = stack.pop() {
        nodes.push((node_type.clone(), node_id));
        for table in ["tasks", "goals"] {
            let children: Vec<i64> = sqlx::query_scalar(&format!(
                "SELECT id FROM {table} WHERE parent_type = ? AND parent_id = ?"
            ))
            .bind(&node_type)
            .bind(node_id)
            .fetch_all(pool)
            .await?;
            let child_kind = if table == "tasks" { "task" } else { "goal" };
            stack.extend(children.into_iter().map(|id| (child_kind.to_string(), id)));
        }
    }
    for (node_type, node_id) in &nodes {
        delete_infos_under(pool, node_type, *node_id).await?;
        // Block reasons hang off a polymorphic owner link with no foreign key, like infos.
        sqlx::query("DELETE FROM block_reasons WHERE owner_type = ? AND owner_id = ?")
            .bind(node_type)
            .bind(node_id)
            .execute(pool)
            .await?;
        let table = if node_type == "goal" { "goals" } else { "tasks" };
        sqlx::query(&format!("DELETE FROM {table} WHERE id = ?")).bind(node_id).execute(pool).await?;
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
    position: i64,
    nsfw: bool,
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
            tag_ids: vec![],
            position: row.position,
            nsfw: row.nsfw,
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
    nsfw: bool,
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
            nsfw: row.nsfw,
        }
    }
}

async fn fetch_task_tag_ids(
    pool: &DatabasePool,
    task_id: i64,
) -> Result<Vec<i64>, sqlx::Error> {
    sqlx::query_scalar::<_, i64>(
        "SELECT tag_id FROM tags_on_tasks WHERE task_id = ? ORDER BY tag_id",
    )
    .bind(task_id)
    .fetch_all(pool)
    .await
}

async fn fetch_goal_tag_ids(
    pool: &DatabasePool,
    goal_id: i64,
) -> Result<Vec<i64>, sqlx::Error> {
    sqlx::query_scalar::<_, i64>(
        "SELECT tag_id FROM tags_on_goals WHERE goal_id = ? ORDER BY tag_id",
    )
    .bind(goal_id)
    .fetch_all(pool)
    .await
}

/// Repository for Goal CRUD operations.
pub struct GoalRepository<'a> {
    pool: &'a DatabasePool,
}

impl<'a> GoalRepository<'a> {
    /// Creates a new repository backed by `pool`.
    pub fn new(pool: &'a DatabasePool) -> Self {
        Self { pool }
    }

    /// Creates a new goal.
    pub async fn create(&self, request: CreateGoalRequest) -> Result<Goal, TaskError> {
        scope_rules::validate_goal_containment(
            self.pool,
            &request.parent_type,
            request.parent_id,
            &request.time_scope,
        )
        .await?;
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
        .execute(self.pool)
        .await?
        .last_insert_rowid();
        let position = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        sqlx::query("UPDATE goals SET position = ? WHERE id = ?")
            .bind(position)
            .bind(id)
            .execute(self.pool)
            .await?;
        self.get(GoalId(id)).await
    }

    /// Fetches a goal by id.
    pub async fn get(&self, id: GoalId) -> Result<Goal, TaskError> {
        let row = sqlx::query_as::<_, GoalRow>("SELECT * FROM goals WHERE id = ?")
            .bind(id.0)
            .fetch_optional(self.pool)
            .await?
            .ok_or(TaskError::GoalNotFound(id.0))?;
        let tag_ids = fetch_goal_tag_ids(self.pool, id.0).await?;
        Ok(Goal { tag_ids, ..row.into() })
    }

    /// Lists all goals.
    pub async fn list(&self) -> Result<Vec<Goal>, TaskError> {
        let rows = sqlx::query_as::<_, GoalRow>("SELECT * FROM goals ORDER BY position ASC")
            .fetch_all(self.pool)
            .await?;
        let mut goals = Vec::with_capacity(rows.len());
        for row in rows {
            let tag_ids = fetch_goal_tag_ids(self.pool, row.id).await?;
            goals.push(Goal { tag_ids, ..row.into() });
        }
        Ok(goals)
    }

    /// Updates a goal.
    pub async fn update(&self, id: GoalId, request: UpdateGoalRequest) -> Result<Goal, TaskError> {
        let goal = self.get(id).await?;
        let title = request.title.unwrap_or(goal.title);
        let status = request
            .status
            .as_ref()
            .map(|s| s.as_str())
            .unwrap_or(&goal.status)
            .to_string();
        let time_scope = match request.time_scope {
            Some(new_time_scope) => new_time_scope,
            None => goal.time_scope,
        };
        let (ts_start, ts_end, ts_n, ts_kind) = time_scope_columns(&time_scope);
        let requested_on_exit = request.on_scope_exit.unwrap_or(goal.on_scope_exit);
        let on_exit = on_scope_exit_column(&time_scope, requested_on_exit);
        let (effective_parent_type, effective_parent_id) =
            match (request.parent_type.as_deref(), request.parent_id) {
                (Some(parent_type), Some(parent_id)) => (parent_type.to_string(), parent_id),
                _ => (goal.parent_type.clone(), goal.parent_id),
            };
        scope_rules::validate_goal_containment(
            self.pool,
            &effective_parent_type,
            effective_parent_id,
            &time_scope,
        )
        .await?;

        if let (Some(new_parent_type), Some(new_parent_id)) =
            (request.parent_type.as_deref(), request.parent_id)
        {
            sqlx::query(
                "UPDATE goals SET parent_type = ?, parent_id = ? WHERE id = ?",
            )
            .bind(new_parent_type)
            .bind(new_parent_id)
            .bind(id.0)
            .execute(self.pool)
            .await?;
        }

        let position = request.position.unwrap_or(goal.position);
        let nsfw = request.nsfw.unwrap_or(goal.nsfw);
        sqlx::query(
            "UPDATE goals SET title=?, status=?,
                time_scope_start_id=?, time_scope_end_id=?,
                time_scope_duration_n=?, time_scope_duration_kind=?, on_scope_exit=?, position=?, nsfw=? WHERE id=?",
        )
        .bind(&title)
        .bind(&status)
        .bind(ts_start)
        .bind(ts_end)
        .bind(ts_n)
        .bind(&ts_kind)
        .bind(on_exit)
        .bind(position)
        .bind(nsfw)
        .bind(id.0)
        .execute(self.pool)
        .await?;
        self.get(id).await
    }

    /// Deletes a goal and its entire subtree (descendant tasks/goals and their infos).
    pub async fn delete(&self, id: GoalId) -> Result<(), TaskError> {
        self.get(id).await?;
        delete_task_goal_subtree(self.pool, "goal", id.0).await
    }

    /// Returns true if the goal with `id` has status `achieved`.
    pub async fn is_achieved(&self, id: GoalId) -> Result<bool, TaskError> {
        let goal = self.get(id).await?;
        Ok(goal.status == GoalStatus::Achieved.as_str())
    }

    /// Attaches a tag to a goal.
    pub async fn add_tag(&self, goal_id: GoalId, tag_id: i64) -> Result<(), TaskError> {
        sqlx::query(
            "INSERT OR IGNORE INTO tags_on_goals (goal_id, tag_id) VALUES (?, ?)",
        )
        .bind(goal_id.0)
        .bind(tag_id)
        .execute(self.pool)
        .await?;
        Ok(())
    }

    /// Removes a tag from a goal.
    pub async fn remove_tag(&self, goal_id: GoalId, tag_id: i64) -> Result<(), TaskError> {
        sqlx::query("DELETE FROM tags_on_goals WHERE goal_id = ? AND tag_id = ?")
            .bind(goal_id.0)
            .bind(tag_id)
            .execute(self.pool)
            .await?;
        Ok(())
    }
}

/// Repository for Task CRUD and dependency operations.
pub struct TaskRepository<'a> {
    pool: &'a DatabasePool,
}

impl<'a> TaskRepository<'a> {
    /// Creates a new repository backed by `pool`.
    pub fn new(pool: &'a DatabasePool) -> Self {
        Self { pool }
    }

    /// Returns the task/goal descendants of a node whose explicit Time Scope would fall outside
    /// `time_scope` — the items that narrowing this node's scope (or reparenting under a tighter
    /// window) would orphan. Drives the frontend's clamp-or-cancel prompt.
    pub async fn scope_containment_conflicts(
        &self,
        node_type: &str,
        node_id: i64,
        time_scope: &TimeScope,
    ) -> Result<Vec<ViolatingDescendant>, TaskError> {
        scope_rules::conflicts_for_new_time_scope(self.pool, node_type, node_id, time_scope).await
    }

    /// Detects the items a reparent would orphan (the node and/or descendants that would fall
    /// outside the new parent's binding scope), plus the ancestor Time Scope to clamp them to.
    pub async fn reparent_scope_conflicts(
        &self,
        node_type: &str,
        node_id: i64,
        new_parent_type: &str,
        new_parent_id: i64,
    ) -> Result<ReparentConflicts, TaskError> {
        scope_rules::reparent_conflicts(self.pool, node_type, node_id, new_parent_type, new_parent_id)
            .await
    }

    /// Creates a new task.
    pub async fn create(&self, request: CreateTaskRequest) -> Result<Task, TaskError> {
        scope_rules::validate_task_containment(
            self.pool,
            &request.parent_type,
            request.parent_id,
            &request.time_scope,
            &request.plan,
        )
        .await?;
        let status = request.status.as_ref().map(|s| s.as_str()).unwrap_or("todo");
        let (ts_start, ts_end, ts_n, ts_kind) = time_scope_columns(&request.time_scope);
        let on_exit = on_scope_exit_column(&request.time_scope, request.on_scope_exit);
        let (plan_start, plan_end, _, _) = time_scope_columns(&request.plan);
        let id = sqlx::query(
            "INSERT INTO tasks
                (title, parent_type, parent_id, status,
                 time_scope_start_id, time_scope_end_id, time_scope_duration_n,
                 time_scope_duration_kind, on_scope_exit, plan_start_id, plan_end_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        .execute(self.pool)
        .await?
        .last_insert_rowid();
        let position = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        sqlx::query("UPDATE tasks SET position = ? WHERE id = ?")
            .bind(position)
            .bind(id)
            .execute(self.pool)
            .await?;
        self.get(TaskId(id)).await
    }

    /// Fetches a task by id.
    pub async fn get(&self, id: TaskId) -> Result<Task, TaskError> {
        let row = sqlx::query_as::<_, TaskRow>("SELECT * FROM tasks WHERE id = ?")
            .bind(id.0)
            .fetch_optional(self.pool)
            .await?
            .ok_or(TaskError::TaskNotFound(id.0))?;
        let tag_ids = fetch_task_tag_ids(self.pool, id.0).await?;
        Ok(Task { tag_ids, ..row.into() })
    }

    /// Fetches a task with its computed block reasons.
    pub async fn get_with_blockers(&self, id: TaskId) -> Result<TaskWithBlockers, TaskError> {
        let task = self.get(id).await?;
        // Explicit reasons first (from the block_reasons table), then virtual ones from unmet dependencies.
        let mut reasons = crate::block_reasons::BlockReasonRepository::new(self.pool)
            .list_for("task", id.0)
            .await?;

        let dependencies = self.list_dependencies(id).await?;
        for dependency in dependencies {
            match dependency {
                Dependency::Task { id: dependency_id } => {
                    let dependency_task = self.get(TaskId(dependency_id)).await?;
                    if dependency_task.status != TaskStatus::Done.as_str() {
                        reasons.push(format!(
                            "Blocked by task {} ({})",
                            dependency_id, dependency_task.title
                        ));
                    }
                }
                Dependency::Goal { id: dependency_id } => {
                    let (goal_status, goal_title): (String, String) =
                        sqlx::query_as("SELECT status, title FROM goals WHERE id = ?")
                            .bind(dependency_id)
                            .fetch_optional(self.pool)
                            .await?
                            .ok_or(TaskError::GoalNotFound(dependency_id))?;
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

    /// Lists all tasks.
    pub async fn list(&self) -> Result<Vec<Task>, TaskError> {
        let rows = sqlx::query_as::<_, TaskRow>("SELECT * FROM tasks ORDER BY position ASC")
            .fetch_all(self.pool)
            .await?;
        let mut tasks = Vec::with_capacity(rows.len());
        for row in rows {
            let tag_ids = fetch_task_tag_ids(self.pool, row.id).await?;
            tasks.push(Task { tag_ids, ..row.into() });
        }
        Ok(tasks)
    }

    /// Updates a task.
    pub async fn update(&self, id: TaskId, request: UpdateTaskRequest) -> Result<Task, TaskError> {
        let task = self.get(id).await?;
        let title = request.title.unwrap_or(task.title);
        let status = request
            .status
            .as_ref()
            .map(|s| s.as_str())
            .unwrap_or(&task.status)
            .to_string();
        let delegate_to = match request.delegate_to {
            Some(new_delegate) => new_delegate,
            None => task.delegate_to,
        };
        let time_scope = match request.time_scope {
            Some(new_time_scope) => new_time_scope,
            None => task.time_scope,
        };
        let (ts_start, ts_end, ts_n, ts_kind) = time_scope_columns(&time_scope);
        let requested_on_exit = request.on_scope_exit.unwrap_or(task.on_scope_exit);
        let on_exit = on_scope_exit_column(&time_scope, requested_on_exit);
        let plan = match request.plan {
            Some(new_plan) => new_plan,
            None => task.plan,
        };
        let (plan_start, plan_end, _, _) = time_scope_columns(&plan);
        // Validate against the effective parent — the new one when reparenting.
        let (effective_parent_type, effective_parent_id) =
            match (request.parent_type.as_deref(), request.parent_id) {
                (Some(parent_type), Some(parent_id)) => (parent_type.to_string(), parent_id),
                _ => (task.parent_type.clone(), task.parent_id),
            };
        scope_rules::validate_task_containment(
            self.pool,
            &effective_parent_type,
            effective_parent_id,
            &time_scope,
            &plan,
        )
        .await?;

        if let (Some(new_parent_type), Some(new_parent_id)) =
            (request.parent_type.as_deref(), request.parent_id)
        {
            sqlx::query(
                "UPDATE tasks SET parent_type = ?, parent_id = ? WHERE id = ?",
            )
            .bind(new_parent_type)
            .bind(new_parent_id)
            .bind(id.0)
            .execute(self.pool)
            .await?;
        }

        let position = request.position.unwrap_or(task.position);
        let nsfw = request.nsfw.unwrap_or(task.nsfw);
        sqlx::query(
            "UPDATE tasks SET title=?, status=?, delegate_to=?,
                time_scope_start_id=?, time_scope_end_id=?, time_scope_duration_n=?,
                time_scope_duration_kind=?, on_scope_exit=?, plan_start_id=?, plan_end_id=?, position=?, nsfw=? WHERE id=?",
        )
        .bind(&title)
        .bind(&status)
        .bind(delegate_to)
        .bind(ts_start)
        .bind(ts_end)
        .bind(ts_n)
        .bind(&ts_kind)
        .bind(on_exit)
        .bind(plan_start)
        .bind(plan_end)
        .bind(position)
        .bind(nsfw)
        .bind(id.0)
        .execute(self.pool)
        .await?;
        self.get(id).await
    }

    /// Deletes a task and its entire subtree (descendant tasks/goals and their infos).
    pub async fn delete(&self, id: TaskId) -> Result<(), TaskError> {
        self.get(id).await?;
        delete_task_goal_subtree(self.pool, "task", id.0).await
    }

    /// Adds a dependency to a task, rejecting circular chains.
    pub async fn add_dependency(
        &self,
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
        .execute(self.pool)
        .await?;
        Ok(())
    }

    /// Removes a dependency from a task.
    pub async fn remove_dependency(
        &self,
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
        .execute(self.pool)
        .await?;
        Ok(())
    }

    /// Lists all dependencies for a task.
    pub async fn list_dependencies(&self, task_id: TaskId) -> Result<Vec<Dependency>, TaskError> {
        #[derive(sqlx::FromRow)]
        struct DependencyRow {
            dependency_type: String,
            dependency_id: i64,
        }
        let rows = sqlx::query_as::<_, DependencyRow>(
            "SELECT dependency_type, dependency_id FROM task_dependencies WHERE task_id = ?",
        )
        .bind(task_id.0)
        .fetch_all(self.pool)
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
    pub async fn list_all_dependencies(&self) -> Result<Vec<TaskDependencyEdge>, TaskError> {
        let rows: Vec<(i64, String, i64)> = sqlx::query_as(
            "SELECT task_id, dependency_type, dependency_id FROM task_dependencies",
        )
        .fetch_all(self.pool)
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

    /// Attaches a tag to a task.
    pub async fn add_tag(&self, task_id: TaskId, tag_id: i64) -> Result<(), TaskError> {
        sqlx::query(
            "INSERT OR IGNORE INTO tags_on_tasks (task_id, tag_id) VALUES (?, ?)",
        )
        .bind(task_id.0)
        .bind(tag_id)
        .execute(self.pool)
        .await?;
        Ok(())
    }

    /// Removes a tag from a task.
    pub async fn remove_tag(&self, task_id: TaskId, tag_id: i64) -> Result<(), TaskError> {
        sqlx::query("DELETE FROM tags_on_tasks WHERE task_id = ? AND tag_id = ?")
            .bind(task_id.0)
            .bind(tag_id)
            .execute(self.pool)
            .await?;
        Ok(())
    }

    /// Returns true if making `task_id` depend on `candidate_id` would create a cycle.
    async fn would_create_cycle(
        &self,
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
            .fetch_all(self.pool)
            .await?;

            for child in children {
                queue.push_back(child.dependency_id);
            }
        }
        Ok(false)
    }
}

fn dependency_parts(dependency: &Dependency) -> (&'static str, i64) {
    match dependency {
        Dependency::Task { id } => ("task", *id),
        Dependency::Goal { id } => ("goal", *id),
    }
}

#[cfg(test)]
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
}
