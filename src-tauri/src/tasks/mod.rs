//! Tasks and Goals: action items and desired states.

pub mod error;
pub mod model;

use std::collections::{HashSet, VecDeque};

use crate::db::DbPool;
use error::TaskError;
use model::{
    CreateGoalRequest, CreateTaskRequest, Dependency, Goal, GoalId, GoalStatus, Task, TaskId,
    TaskStatus, TaskWithBlockers, UpdateGoalRequest, UpdateTaskRequest,
};

/// Repository for Goal CRUD operations.
pub struct GoalRepository<'a> {
    pool: &'a DbPool,
}

impl<'a> GoalRepository<'a> {
    /// Creates a new repository backed by `pool`.
    pub fn new(pool: &'a DbPool) -> Self {
        Self { pool }
    }

    /// Creates a new goal.
    pub async fn create(&self, req: CreateGoalRequest) -> Result<Goal, TaskError> {
        let status = req.status.as_ref().map(|s| s.as_str()).unwrap_or("active");
        let id = sqlx::query(
            "INSERT INTO goals (title, parent_type, parent_id, status, scope_id)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&req.title)
        .bind(&req.parent_type)
        .bind(req.parent_id)
        .bind(status)
        .bind(req.scope_id)
        .execute(self.pool)
        .await?
        .last_insert_rowid();
        self.get(GoalId(id)).await
    }

    /// Fetches a goal by id.
    pub async fn get(&self, id: GoalId) -> Result<Goal, TaskError> {
        sqlx::query_as::<_, Goal>("SELECT * FROM goals WHERE id = ?")
            .bind(id.0)
            .fetch_optional(self.pool)
            .await?
            .ok_or(TaskError::GoalNotFound(id.0))
    }

    /// Lists all goals.
    pub async fn list(&self) -> Result<Vec<Goal>, TaskError> {
        sqlx::query_as::<_, Goal>("SELECT * FROM goals ORDER BY id")
            .fetch_all(self.pool)
            .await
            .map_err(Into::into)
    }

    /// Updates a goal.
    pub async fn update(&self, id: GoalId, req: UpdateGoalRequest) -> Result<Goal, TaskError> {
        let goal = self.get(id).await?;
        let title = req.title.unwrap_or(goal.title);
        let status = req.status.as_ref().map(|s| s.as_str()).unwrap_or(&goal.status).to_string();
        let blocked_reason = match req.blocked_reason {
            Some(r) if r.is_empty() => None,
            Some(r) => Some(r),
            None => goal.blocked_reason,
        };
        let scope_id = req.scope_id.unwrap_or(goal.scope_id.map(|_| None).unwrap_or(goal.scope_id));

        sqlx::query(
            "UPDATE goals SET title=?, status=?, blocked_reason=?, scope_id=? WHERE id=?",
        )
        .bind(&title)
        .bind(&status)
        .bind(&blocked_reason)
        .bind(scope_id)
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
}

/// Repository for Task CRUD and dependency operations.
pub struct TaskRepository<'a> {
    pool: &'a DbPool,
}

impl<'a> TaskRepository<'a> {
    /// Creates a new repository backed by `pool`.
    pub fn new(pool: &'a DbPool) -> Self {
        Self { pool }
    }

    /// Creates a new task.
    pub async fn create(&self, req: CreateTaskRequest) -> Result<Task, TaskError> {
        let status = req.status.as_ref().map(|s| s.as_str()).unwrap_or("todo");
        let id = sqlx::query(
            "INSERT INTO tasks (title, parent_type, parent_id, status, scope_id)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&req.title)
        .bind(&req.parent_type)
        .bind(req.parent_id)
        .bind(status)
        .bind(req.scope_id)
        .execute(self.pool)
        .await?
        .last_insert_rowid();
        self.get(TaskId(id)).await
    }

    /// Fetches a task by id.
    pub async fn get(&self, id: TaskId) -> Result<Task, TaskError> {
        sqlx::query_as::<_, Task>("SELECT * FROM tasks WHERE id = ?")
            .bind(id.0)
            .fetch_optional(self.pool)
            .await?
            .ok_or(TaskError::TaskNotFound(id.0))
    }

    /// Fetches a task with its computed block reasons.
    pub async fn get_with_blockers(&self, id: TaskId) -> Result<TaskWithBlockers, TaskError> {
        let task = self.get(id).await?;
        let mut reasons = Vec::new();
        if let Some(ref r) = task.blocked_reason {
            reasons.push(r.clone());
        }

        let deps = self.list_dependencies(id).await?;
        for dep in deps {
            match dep {
                Dependency::Task { id: dep_id } => {
                    let dep_task = self.get(TaskId(dep_id)).await?;
                    if dep_task.status != TaskStatus::Done.as_str() {
                        reasons.push(format!(
                            "Blocked by task {} ({})",
                            dep_id, dep_task.title
                        ));
                    }
                }
                Dependency::Goal { id: dep_id } => {
                    let dep_goal = sqlx::query_as::<_, Goal>("SELECT * FROM goals WHERE id = ?")
                        .bind(dep_id)
                        .fetch_optional(self.pool)
                        .await?
                        .ok_or(TaskError::GoalNotFound(dep_id))?;
                    if dep_goal.status != GoalStatus::Achieved.as_str() {
                        reasons.push(format!(
                            "Blocked by goal {} ({})",
                            dep_id, dep_goal.title
                        ));
                    }
                }
            }
        }

        Ok(TaskWithBlockers { task, block_reasons: reasons })
    }

    /// Lists all tasks.
    pub async fn list(&self) -> Result<Vec<Task>, TaskError> {
        sqlx::query_as::<_, Task>("SELECT * FROM tasks ORDER BY id")
            .fetch_all(self.pool)
            .await
            .map_err(Into::into)
    }

    /// Updates a task.
    pub async fn update(&self, id: TaskId, req: UpdateTaskRequest) -> Result<Task, TaskError> {
        let task = self.get(id).await?;
        let title = req.title.unwrap_or(task.title);
        let status = req.status.as_ref().map(|s| s.as_str()).unwrap_or(&task.status).to_string();
        let blocked_reason = match req.blocked_reason {
            Some(r) if r.is_empty() => None,
            Some(r) => Some(r),
            None => task.blocked_reason,
        };
        let delegate_to = req.delegate_to.unwrap_or(task.delegate_to.map(Some).unwrap_or(None));
        let scope_id = req.scope_id.unwrap_or(task.scope_id.map(Some).unwrap_or(None));

        sqlx::query(
            "UPDATE tasks SET title=?, status=?, blocked_reason=?, delegate_to=?, scope_id=? WHERE id=?",
        )
        .bind(&title)
        .bind(&status)
        .bind(&blocked_reason)
        .bind(delegate_to)
        .bind(scope_id)
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
    pub async fn add_dependency(&self, task_id: TaskId, dep: Dependency) -> Result<(), TaskError> {
        if let Dependency::Task { id: dep_id } = dep {
            if self.would_create_cycle(task_id, TaskId(dep_id)).await? {
                return Err(TaskError::CircularDependency);
            }
        }
        let (dep_type, dep_id) = dep_parts(&dep);
        sqlx::query(
            "INSERT OR IGNORE INTO task_dependencies (task_id, dep_type, dep_id) VALUES (?, ?, ?)",
        )
        .bind(task_id.0)
        .bind(dep_type)
        .bind(dep_id)
        .execute(self.pool)
        .await?;
        Ok(())
    }

    /// Removes a dependency from a task.
    pub async fn remove_dependency(
        &self,
        task_id: TaskId,
        dep: Dependency,
    ) -> Result<(), TaskError> {
        let (dep_type, dep_id) = dep_parts(&dep);
        sqlx::query(
            "DELETE FROM task_dependencies WHERE task_id=? AND dep_type=? AND dep_id=?",
        )
        .bind(task_id.0)
        .bind(dep_type)
        .bind(dep_id)
        .execute(self.pool)
        .await?;
        Ok(())
    }

    /// Lists all dependencies for a task.
    pub async fn list_dependencies(&self, task_id: TaskId) -> Result<Vec<Dependency>, TaskError> {
        #[derive(sqlx::FromRow)]
        struct DepRow {
            dep_type: String,
            dep_id: i64,
        }
        let rows = sqlx::query_as::<_, DepRow>(
            "SELECT dep_type, dep_id FROM task_dependencies WHERE task_id = ?",
        )
        .bind(task_id.0)
        .fetch_all(self.pool)
        .await?;

        let deps = rows
            .into_iter()
            .map(|r| match r.dep_type.as_str() {
                "task" => Dependency::Task { id: r.dep_id },
                _ => Dependency::Goal { id: r.dep_id },
            })
            .collect();
        Ok(deps)
    }

    /// Returns true if making `task_id` depend on `dep_id` would create a cycle.
    async fn would_create_cycle(
        &self,
        task_id: TaskId,
        dep_id: TaskId,
    ) -> Result<bool, TaskError> {
        // BFS from dep_id: if we can reach task_id through its dependencies, it's a cycle.
        let mut visited: HashSet<i64> = HashSet::new();
        let mut queue: VecDeque<i64> = VecDeque::new();
        queue.push_back(dep_id.0);

        while let Some(current) = queue.pop_front() {
            if current == task_id.0 {
                return Ok(true);
            }
            if !visited.insert(current) {
                continue;
            }
            #[derive(sqlx::FromRow)]
            struct DepRow {
                dep_id: i64,
            }
            let children = sqlx::query_as::<_, DepRow>(
                "SELECT dep_id FROM task_dependencies WHERE task_id = ? AND dep_type = 'task'",
            )
            .bind(current)
            .fetch_all(self.pool)
            .await?;

            for child in children {
                queue.push_back(child.dep_id);
            }
        }
        Ok(false)
    }
}

fn dep_parts(dep: &Dependency) -> (&'static str, i64) {
    match dep {
        Dependency::Task { id } => ("task", *id),
        Dependency::Goal { id } => ("goal", *id),
    }
}
