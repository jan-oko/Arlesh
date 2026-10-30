//! [`SqliteBackend`]'s `tasks` operations: the in-process core over the local file.

use crate::{
    duplicate::{duplicate_subtree, DuplicableKind, DuplicatedSubtree},
    error::WireError,
    nodes::{id::NodeId, write},
    tasks::{
        lifecycle::ItemLifecycle,
        model::{
            CreateGoalRequest, CreateTaskRequest, Dependency, DescendantPlans, Goal, GoalId, Task,
            TaskDependencyEdge, TaskId, TaskWithBlockers, TimeScope, UpdateGoalRequest,
            UpdateTaskRequest,
        },
        ReparentConflicts, ViolatingDescendant,
    },
};

use super::SqliteBackend;
use crate::backend::tasks::TasksPort;

#[async_trait::async_trait]
impl TasksPort for SqliteBackend {
    async fn create_task(&self, request: CreateTaskRequest) -> Result<Task, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let task = write::create_task(&mut db, request, chrono::Local::now().naive_local())
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(task)
    }

    async fn get_task(&self, id: i64) -> Result<TaskWithBlockers, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        crate::tasks::get_task_with_blockers(&mut db, TaskId(id))
            .await
            .map_err(WireError::from_error)
    }

    async fn list_tasks(&self, now: chrono::NaiveDateTime) -> Result<Vec<Task>, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let load = crate::mindmap::load(&mut db, now)
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(load.tasks)
    }

    async fn update_task(
        &self,
        id: NodeId,
        request: UpdateTaskRequest,
        confirmed: Option<bool>,
    ) -> Result<Task, WireError> {
        let now = chrono::Local::now().naive_local();
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let task = write_task_guarded(&mut db, &id, request, (confirmed, None), now).await?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(task)
    }

    async fn update_task_settling_plans(
        &self,
        id: NodeId,
        request: UpdateTaskRequest,
        confirmed: Option<bool>,
        descendant_plans: DescendantPlans,
    ) -> Result<Task, WireError> {
        let now = chrono::Local::now().naive_local();
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let answer = (confirmed, Some(descendant_plans));
        let task = write_task_guarded(&mut db, &id, request, answer, now).await?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(task)
    }

    async fn dependency_candidates(&self, id: NodeId) -> Result<Vec<Dependency>, WireError> {
        let now = chrono::Local::now().naive_local();
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let load = crate::mindmap::load(&mut db, now)
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(crate::tasks::rules::dependencies::candidates(
            &id,
            &load.tasks,
            &load.goals,
            &load.expectations,
            &load.task_dependencies,
        ))
    }

    async fn plan_containment_conflicts(
        &self,
        id: NodeId,
        plan: Option<TimeScope>,
    ) -> Result<Vec<crate::mindmap::rules::plans::PlanClampTarget>, WireError> {
        let now = chrono::Local::now().naive_local();
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let targets =
            crate::nodes::composite::plan_containment_conflicts(&mut db, &id, plan.as_ref(), now)
                .await?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(targets)
    }

    async fn scope_containment_conflicts(
        &self,
        node_type: String,
        node_id: i64,
        time_scope: TimeScope,
    ) -> Result<Vec<ViolatingDescendant>, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        crate::tasks::conflicts_for_new_time_scope(&mut db, &node_type, node_id, &time_scope)
            .await
            .map_err(WireError::from_error)
    }

    async fn reparent_scope_conflicts(
        &self,
        node_type: String,
        node_id: i64,
        new_parent_type: String,
        new_parent_id: i64,
    ) -> Result<ReparentConflicts, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        crate::tasks::reparent_conflicts(
            &mut db,
            &node_type,
            node_id,
            &new_parent_type,
            new_parent_id,
        )
        .await
        .map_err(WireError::from_error)
    }

    async fn delete_task(&self, id: NodeId) -> Result<(), WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        write::delete(&mut db, "task", &id, chrono::Local::now().naive_local())
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)
    }

    async fn duplicate_task(
        &self,
        id: i64,
        target_type: String,
        target_id: i64,
        position: i64,
    ) -> Result<DuplicatedSubtree<Task>, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let subtree = duplicate_subtree(
            &mut db,
            DuplicableKind::Task,
            id,
            &target_type,
            target_id,
            position,
        )
        .await
        .map_err(WireError::from_error)?;
        let task = db
            .tasks()
            .get(TaskId(subtree.root_id))
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(DuplicatedSubtree {
            copy: task,
            left_behind: subtree.left_behind,
        })
    }

    async fn add_task_dependency(
        &self,
        task_id: NodeId,
        dependency: Dependency,
    ) -> Result<(), WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        write::add_dependency(
            &mut db,
            &task_id,
            dependency,
            chrono::Local::now().naive_local(),
        )
        .await
        .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)
    }

    async fn remove_task_dependency(
        &self,
        task_id: NodeId,
        dependency: Dependency,
    ) -> Result<(), WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        write::remove_dependency(
            &mut db,
            &task_id,
            dependency,
            chrono::Local::now().naive_local(),
        )
        .await
        .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)
    }

    async fn list_task_dependencies(&self, task_id: NodeId) -> Result<Vec<Dependency>, WireError> {
        // A transaction only because the derivation reads through one; it writes nothing.
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let dependencies =
            write::dependencies_of(&mut db, &task_id, chrono::Local::now().naive_local())
                .await
                .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(dependencies)
    }

    async fn task_done_at(&self, id: NodeId) -> Result<Option<chrono::NaiveDateTime>, WireError> {
        // A transaction only because resolving a derived id reads through one; it writes nothing.
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let done_at = write::done_at(&mut db, &id, chrono::Local::now().naive_local())
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(done_at)
    }

    async fn set_task_done_at(
        &self,
        id: NodeId,
        at: chrono::NaiveDateTime,
    ) -> Result<(), WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        write::set_done_at(&mut db, &id, at, chrono::Local::now().naive_local())
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)
    }

    async fn list_all_task_dependencies(&self) -> Result<Vec<TaskDependencyEdge>, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let edges = write::all_dependencies(&mut db, chrono::Local::now().naive_local())
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(edges)
    }

    async fn create_goal(&self, request: CreateGoalRequest) -> Result<Goal, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let goal = write::create_goal(&mut db, request, chrono::Local::now().naive_local())
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(goal)
    }

    async fn get_goal(&self, id: i64) -> Result<Goal, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.goals()
            .get(GoalId(id))
            .await
            .map_err(WireError::from_error)
    }

    async fn list_goals(&self, now: chrono::NaiveDateTime) -> Result<Vec<Goal>, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let load = crate::mindmap::load(&mut db, now)
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(load.goals)
    }

    async fn update_goal(
        &self,
        id: NodeId,
        request: UpdateGoalRequest,
        confirmed: Option<bool>,
    ) -> Result<Goal, WireError> {
        let now = chrono::Local::now().naive_local();
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let goal = crate::nodes::composite::update_goal_confirmed(
            &mut db,
            &id,
            request,
            confirmed == Some(true),
            now,
        )
        .await?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(goal)
    }

    async fn delete_goal(&self, id: NodeId) -> Result<(), WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        write::delete(&mut db, "goal", &id, chrono::Local::now().naive_local())
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)
    }

    async fn duplicate_goal(
        &self,
        id: i64,
        target_type: String,
        target_id: i64,
        position: i64,
    ) -> Result<DuplicatedSubtree<Goal>, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let subtree = duplicate_subtree(
            &mut db,
            DuplicableKind::Goal,
            id,
            &target_type,
            target_id,
            position,
        )
        .await
        .map_err(WireError::from_error)?;
        let goal = db
            .goals()
            .get(GoalId(subtree.root_id))
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(DuplicatedSubtree {
            copy: goal,
            left_behind: subtree.left_behind,
        })
    }

    async fn add_tag_to_task(&self, task_id: NodeId, tag_id: i64) -> Result<(), WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        write::set_tag(
            &mut db,
            "task",
            &task_id,
            tag_id,
            true,
            chrono::Local::now().naive_local(),
        )
        .await
        .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)
    }

    async fn remove_tag_from_task(&self, task_id: NodeId, tag_id: i64) -> Result<(), WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        write::set_tag(
            &mut db,
            "task",
            &task_id,
            tag_id,
            false,
            chrono::Local::now().naive_local(),
        )
        .await
        .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)
    }

    async fn add_tag_to_goal(&self, goal_id: NodeId, tag_id: i64) -> Result<(), WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        write::set_tag(
            &mut db,
            "goal",
            &goal_id,
            tag_id,
            true,
            chrono::Local::now().naive_local(),
        )
        .await
        .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)
    }

    async fn remove_tag_from_goal(&self, goal_id: NodeId, tag_id: i64) -> Result<(), WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        write::set_tag(
            &mut db,
            "goal",
            &goal_id,
            tag_id,
            false,
            chrono::Local::now().naive_local(),
        )
        .await
        .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)
    }

    async fn derive_scope_lifecycles(
        &self,
        now: chrono::NaiveDateTime,
    ) -> Result<Vec<ItemLifecycle>, WireError> {
        // Every row of the virtual tables, a Habit's occurrences included. A transaction only because
        // the derivation reads through one; it writes nothing.
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let lifecycles = crate::mindmap::load(&mut db, now)
            .await
            .map_err(WireError::from_error)?
            .lifecycles;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(lifecycles)
    }
}

/// Writes `request` to the Task `id` — through the guard that asks, unless `confirmed`, before a
/// Habit occurrence is marked done while it still holds unfinished children it would close over —
/// settling the Tasks below a new Plan would leave outside as `descendant_plans` says.
async fn write_task_guarded(
    db: &mut crate::database::session::Db<crate::database::session::Transactional>,
    id: &NodeId,
    request: UpdateTaskRequest,
    (confirmed, descendant_plans): (Option<bool>, Option<DescendantPlans>),
    now: chrono::NaiveDateTime,
) -> Result<Task, WireError> {
    crate::nodes::composite::update_task_confirmed(
        db,
        id,
        request,
        confirmed == Some(true),
        descendant_plans,
        now,
    )
    .await
}
