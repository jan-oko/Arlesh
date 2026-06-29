//! Tasks and Goals: action items and desired states.

pub mod error;
pub mod model;

use std::collections::{HashSet, VecDeque};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::database::DatabasePool;
use crate::scopes::model::ScopeId;
use crate::scopes::resolve::{self, Bounds};
use crate::scopes::ScopeRepository;
use error::TaskError;
use model::{
    CreateGoalRequest, CreateTaskRequest, Dependency, DurationSpec, Goal, GoalId, GoalStatus, Task,
    TaskId, TaskStatus, TaskWithBlockers, TimeScope, UpdateGoalRequest, UpdateTaskRequest,
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
    blocked_reason: Option<String>,
    delegate_to: Option<i64>,
    time_scope_start_id: Option<i64>,
    time_scope_end_id: Option<i64>,
    time_scope_duration_n: Option<i64>,
    time_scope_duration_kind: Option<String>,
    plan_scope_id: Option<i64>,
    position: i64,
}

impl From<TaskRow> for Task {
    fn from(row: TaskRow) -> Self {
        Self {
            id: row.id,
            title: row.title,
            parent_type: row.parent_type,
            parent_id: row.parent_id,
            status: row.status,
            blocked_reason: row.blocked_reason,
            delegate_to: row.delegate_to,
            time_scope: time_scope_from_row(
                row.time_scope_start_id,
                row.time_scope_end_id,
                row.time_scope_duration_n,
                row.time_scope_duration_kind,
            ),
            plan_scope_id: row.plan_scope_id,
            tag_ids: vec![],
            position: row.position,
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
    blocked_reason: Option<String>,
    time_scope_start_id: Option<i64>,
    time_scope_end_id: Option<i64>,
    time_scope_duration_n: Option<i64>,
    time_scope_duration_kind: Option<String>,
    position: i64,
}

impl From<GoalRow> for Goal {
    fn from(row: GoalRow) -> Self {
        Self {
            id: row.id,
            title: row.title,
            parent_type: row.parent_type,
            parent_id: row.parent_id,
            status: row.status,
            blocked_reason: row.blocked_reason,
            time_scope: time_scope_from_row(
                row.time_scope_start_id,
                row.time_scope_end_id,
                row.time_scope_duration_n,
                row.time_scope_duration_kind,
            ),
            tag_ids: vec![],
            position: row.position,
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
        let status = request.status.as_ref().map(|s| s.as_str()).unwrap_or("active");
        let (ts_start, ts_end, ts_n, ts_kind) = time_scope_columns(&request.time_scope);
        let id = sqlx::query(
            "INSERT INTO goals
                (title, parent_type, parent_id, status,
                 time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&request.title)
        .bind(&request.parent_type)
        .bind(request.parent_id)
        .bind(status)
        .bind(ts_start)
        .bind(ts_end)
        .bind(ts_n)
        .bind(&ts_kind)
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
        let blocked_reason = match request.blocked_reason {
            Some(reason) if reason.is_empty() => None,
            Some(reason) => Some(reason),
            None => goal.blocked_reason,
        };
        let time_scope = match request.time_scope {
            Some(new_time_scope) => new_time_scope,
            None => goal.time_scope,
        };
        let (ts_start, ts_end, ts_n, ts_kind) = time_scope_columns(&time_scope);

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
        sqlx::query(
            "UPDATE goals SET title=?, status=?, blocked_reason=?,
                time_scope_start_id=?, time_scope_end_id=?,
                time_scope_duration_n=?, time_scope_duration_kind=?, position=? WHERE id=?",
        )
        .bind(&title)
        .bind(&status)
        .bind(&blocked_reason)
        .bind(ts_start)
        .bind(ts_end)
        .bind(ts_n)
        .bind(&ts_kind)
        .bind(position)
        .bind(id.0)
        .execute(self.pool)
        .await?;
        self.get(id).await
    }

    /// Deletes a goal by id.
    pub async fn delete(&self, id: GoalId) -> Result<(), TaskError> {
        self.get(id).await?;
        sqlx::query("DELETE FROM goals WHERE id = ?")
            .bind(id.0)
            .execute(self.pool)
            .await?;
        Ok(())
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

    /// Resolves a single scope id to its half-open datetime window.
    async fn scope_window(&self, scope_id: i64) -> Result<Bounds, TaskError> {
        let scope = ScopeRepository::new(self.pool).get(ScopeId(scope_id)).await?;
        Ok(resolve::scope_bounds(&scope)?)
    }

    /// Resolves a Time Scope's boundaries to its combined window: the start of the start
    /// boundary through the end of the end boundary.
    async fn time_scope_window(&self, time_scope: &TimeScope) -> Result<Bounds, TaskError> {
        let start = self.scope_window(time_scope.start_id).await?.0;
        let end = self.scope_window(time_scope.end_id).await?.1;
        Ok((start, end))
    }

    /// Rejects a write whose Plan is not wholly contained within its Time Scope. A task with no
    /// Plan, or no Time Scope, is unconstrained here (a null Time Scope inherits an ancestor's).
    async fn validate_plan_within_time_scope(
        &self,
        time_scope: &Option<TimeScope>,
        plan_scope_id: Option<i64>,
    ) -> Result<(), TaskError> {
        let (Some(time_scope), Some(plan)) = (time_scope, plan_scope_id) else {
            return Ok(());
        };
        let time_window = self.time_scope_window(time_scope).await?;
        let plan_window = self.scope_window(plan).await?;
        if resolve::interval_contains(time_window, plan_window) {
            Ok(())
        } else {
            Err(TaskError::ScopeContainment(format!(
                "plan scope {plan} is not within the task's time scope"
            )))
        }
    }

    /// Creates a new task.
    pub async fn create(&self, request: CreateTaskRequest) -> Result<Task, TaskError> {
        self.validate_plan_within_time_scope(&request.time_scope, request.plan_scope_id)
            .await?;
        let status = request.status.as_ref().map(|s| s.as_str()).unwrap_or("todo");
        let (ts_start, ts_end, ts_n, ts_kind) = time_scope_columns(&request.time_scope);
        let id = sqlx::query(
            "INSERT INTO tasks
                (title, parent_type, parent_id, status,
                 time_scope_start_id, time_scope_end_id, time_scope_duration_n,
                 time_scope_duration_kind, plan_scope_id)
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
        .bind(request.plan_scope_id)
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
        let mut reasons = Vec::new();
        if let Some(ref reason) = task.blocked_reason {
            reasons.push(reason.clone());
        }

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
        let blocked_reason = match request.blocked_reason {
            Some(reason) if reason.is_empty() => None,
            Some(reason) => Some(reason),
            None => task.blocked_reason,
        };
        let delegate_to = match request.delegate_to {
            Some(new_delegate) => new_delegate,
            None => task.delegate_to,
        };
        let time_scope = match request.time_scope {
            Some(new_time_scope) => new_time_scope,
            None => task.time_scope,
        };
        let (ts_start, ts_end, ts_n, ts_kind) = time_scope_columns(&time_scope);
        let plan_scope_id = match request.plan_scope_id {
            Some(new_plan) => new_plan,
            None => task.plan_scope_id,
        };
        self.validate_plan_within_time_scope(&time_scope, plan_scope_id)
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
        sqlx::query(
            "UPDATE tasks SET title=?, status=?, blocked_reason=?, delegate_to=?,
                time_scope_start_id=?, time_scope_end_id=?, time_scope_duration_n=?,
                time_scope_duration_kind=?, plan_scope_id=?, position=? WHERE id=?",
        )
        .bind(&title)
        .bind(&status)
        .bind(&blocked_reason)
        .bind(delegate_to)
        .bind(ts_start)
        .bind(ts_end)
        .bind(ts_n)
        .bind(&ts_kind)
        .bind(plan_scope_id)
        .bind(position)
        .bind(id.0)
        .execute(self.pool)
        .await?;
        self.get(id).await
    }

    /// Deletes a task by id.
    pub async fn delete(&self, id: TaskId) -> Result<(), TaskError> {
        self.get(id).await?;
        sqlx::query("DELETE FROM tasks WHERE id = ?")
            .bind(id.0)
            .execute(self.pool)
            .await?;
        Ok(())
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
