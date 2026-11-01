//! The `tasks` part of the [`Backend`](super::Backend) port: what the commands in
//! [`crate::commands::tasks`] ask of whichever backend the app runs on.

use crate::{
    duplicate::DuplicatedSubtree,
    error::WireError,
    nodes::id::NodeId,
    tasks::{
        lifecycle::ItemLifecycle,
        model::{
            CreateGoalRequest, CreateTaskRequest, Dependency, DescendantPlans, Goal, Task,
            TaskDependencyEdge, TaskWithBlockers, TimeScope, UpdateGoalRequest, UpdateTaskRequest,
        },
        ReparentConflicts, ViolatingDescendant,
    },
};

/// The `tasks` operations a backend serves.
#[async_trait::async_trait]
pub trait TasksPort: Send + Sync {
    /// Creates a new task.
    async fn create_task(&self, request: CreateTaskRequest) -> Result<Task, WireError>;

    /// Fetches a task by id with computed blockers.
    async fn get_task(&self, id: i64) -> Result<TaskWithBlockers, WireError>;

    /// Lists every task — the Task virtual table: stored rows and every Habit occurrence.
    async fn list_tasks(&self, now: chrono::NaiveDateTime) -> Result<Vec<Task>, WireError>;

    /// Updates a task, stored or derived: a Habit occurrence's update lands in its overlay.
    async fn update_task(
        &self,
        id: NodeId,
        request: UpdateTaskRequest,
        confirmed: Option<bool>,
    ) -> Result<Task, WireError>;

    /// [`update_task`], settling the Tasks below whose own Plan the new Plan would leave outside as
    async fn update_task_settling_plans(
        &self,
        id: NodeId,
        request: UpdateTaskRequest,
        confirmed: Option<bool>,
        descendant_plans: DescendantPlans,
    ) -> Result<Task, WireError>;

    /// What the Task `id` may be made to depend on — what the quick dependency picker offers: every
    async fn dependency_candidates(&self, id: NodeId) -> Result<Vec<Dependency>, WireError>;

    /// The Tasks below the Task `id` whose own Plan `plan` would leave outside the Plan they inherit,
    async fn plan_containment_conflicts(
        &self,
        id: NodeId,
        plan: Option<TimeScope>,
    ) -> Result<Vec<crate::mindmap::rules::plans::PlanClampTarget>, WireError>;

    /// Returns the task/goal descendants of a node that a candidate Time Scope would orphan, for the
    async fn scope_containment_conflicts(
        &self,
        node_type: String,
        node_id: i64,
        time_scope: TimeScope,
    ) -> Result<Vec<ViolatingDescendant>, WireError>;

    /// Returns the items a reparent of `node` under `new_parent` would orphan, plus the ancestor Time
    async fn reparent_scope_conflicts(
        &self,
        node_type: String,
        node_id: i64,
        new_parent_type: String,
        new_parent_id: i64,
    ) -> Result<ReparentConflicts, WireError>;

    /// Deletes a task — or archives a Habit occurrence, which is never deleted.
    async fn delete_task(&self, id: NodeId) -> Result<(), WireError>;

    /// Deep-clones a task and its whole subtree under `(target_type, target_id)`, putting the new
    async fn duplicate_task(
        &self,
        id: i64,
        target_type: String,
        target_id: i64,
        position: i64,
    ) -> Result<DuplicatedSubtree<Task>, WireError>;

    /// Adds a dependency to a task.
    async fn add_task_dependency(
        &self,
        task_id: NodeId,
        dependency: Dependency,
    ) -> Result<(), WireError>;

    /// Removes a dependency from a task.
    async fn remove_task_dependency(
        &self,
        task_id: NodeId,
        dependency: Dependency,
    ) -> Result<(), WireError>;

    /// Lists what one task depends on — a stored one, or a Habit occurrence, whose edges are its
    async fn list_task_dependencies(&self, task_id: NodeId) -> Result<Vec<Dependency>, WireError>;

    /// When a Done task was done — a stored one, or a Habit occurrence — as a local wall-clock
    async fn task_done_at(&self, id: NodeId) -> Result<Option<chrono::NaiveDateTime>, WireError>;

    /// Sets a Done task's done date — when it was really done, for work marked done late. Refused for
    async fn set_task_done_at(
        &self,
        id: NodeId,
        at: chrono::NaiveDateTime,
    ) -> Result<(), WireError>;

    /// Lists every task-dependency edge on the board, stored and derived.
    async fn list_all_task_dependencies(&self) -> Result<Vec<TaskDependencyEdge>, WireError>;

    /// Creates a new goal.
    async fn create_goal(&self, request: CreateGoalRequest) -> Result<Goal, WireError>;

    /// Fetches a goal by id.
    async fn get_goal(&self, id: i64) -> Result<Goal, WireError>;

    /// Lists every goal — the Goal virtual table: stored rows and every Habit occurrence.
    async fn list_goals(&self, now: chrono::NaiveDateTime) -> Result<Vec<Goal>, WireError>;

    /// Updates a goal, stored or derived. Achieving a Habit occurrence that still holds unfinished
    async fn update_goal(
        &self,
        id: NodeId,
        request: UpdateGoalRequest,
        confirmed: Option<bool>,
    ) -> Result<Goal, WireError>;

    /// Deletes a goal — or archives a Habit occurrence, which is never deleted.
    async fn delete_goal(&self, id: NodeId) -> Result<(), WireError>;

    /// Deep-clones a goal and its whole subtree under `(target_type, target_id)`, putting the new
    async fn duplicate_goal(
        &self,
        id: i64,
        target_type: String,
        target_id: i64,
        position: i64,
    ) -> Result<DuplicatedSubtree<Goal>, WireError>;

    /// Adds a tag to a task.
    async fn add_tag_to_task(&self, task_id: NodeId, tag_id: i64) -> Result<(), WireError>;

    /// Removes a tag from a task.
    async fn remove_tag_from_task(&self, task_id: NodeId, tag_id: i64) -> Result<(), WireError>;

    /// Adds a tag to a goal.
    async fn add_tag_to_goal(&self, goal_id: NodeId, tag_id: i64) -> Result<(), WireError>;

    /// Removes a tag from a goal.
    async fn remove_tag_from_goal(&self, goal_id: NodeId, tag_id: i64) -> Result<(), WireError>;

    /// Derives the scope lifecycle (Active / Overdue / Lapsed) of every Task and Goal at `now`
    async fn derive_scope_lifecycles(
        &self,
        now: chrono::NaiveDateTime,
    ) -> Result<Vec<ItemLifecycle>, WireError>;
}
