//! [`HttpBackend`]'s `tasks` operations: each one REST call to `arlesh-server`, as
//! `conformance/client-mode.json` lists it.

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

use super::{device_now, segment, Call, HttpBackend};
use crate::backend::tasks::TasksPort;
use reqwest::Method;

#[async_trait::async_trait]
impl TasksPort for HttpBackend {
    async fn create_task(&self, request: CreateTaskRequest) -> Result<Task, WireError> {
        self.write(Call::new(Method::POST, "/tasks".to_owned()).json(&request))
            .await
    }

    async fn get_task(&self, id: i64) -> Result<TaskWithBlockers, WireError> {
        self.read(Call::new(Method::GET, format!("/tasks/{}", segment(&id))))
            .await
    }

    async fn list_tasks(&self, now: chrono::NaiveDateTime) -> Result<Vec<Task>, WireError> {
        self.read(Call::new(Method::GET, "/tasks".to_owned()).query("now", &now))
            .await
    }

    async fn update_task(
        &self,
        id: NodeId,
        request: UpdateTaskRequest,
        confirmed: Option<bool>,
    ) -> Result<Task, WireError> {
        self.write(
            Call::new(Method::PATCH, format!("/tasks/{}", segment(&id)))
                .query_opt("confirmed", confirmed.as_ref())
                .json(&request),
        )
        .await
    }

    async fn update_task_settling_plans(
        &self,
        id: NodeId,
        request: UpdateTaskRequest,
        confirmed: Option<bool>,
        descendant_plans: DescendantPlans,
    ) -> Result<Task, WireError> {
        self.write(
            Call::new(Method::PATCH, format!("/tasks/{}", segment(&id)))
                .query_opt("confirmed", confirmed.as_ref())
                .query("descendant_plans", &descendant_plans)
                .json(&request),
        )
        .await
    }

    async fn dependency_candidates(&self, id: NodeId) -> Result<Vec<Dependency>, WireError> {
        self.read(
            Call::new(
                Method::GET,
                format!("/tasks/{}/dependency-candidates", segment(&id)),
            )
            .query("now", &device_now()),
        )
        .await
    }

    async fn plan_containment_conflicts(
        &self,
        id: NodeId,
        plan: Option<TimeScope>,
    ) -> Result<Vec<crate::mindmap::rules::plans::PlanClampTarget>, WireError> {
        self.read(
            Call::new(
                Method::POST,
                format!("/tasks/{}/plan-containment-conflicts", segment(&id)),
            )
            .json(&plan),
        )
        .await
    }

    async fn scope_containment_conflicts(
        &self,
        node_type: String,
        node_id: i64,
        time_scope: TimeScope,
    ) -> Result<Vec<ViolatingDescendant>, WireError> {
        self.read(
            Call::new(
                Method::POST,
                format!(
                    "/nodes/{}/{}/scope-containment-conflicts",
                    segment(&node_type),
                    segment(&node_id)
                ),
            )
            .json(&time_scope),
        )
        .await
    }

    async fn reparent_scope_conflicts(
        &self,
        node_type: String,
        node_id: i64,
        new_parent_type: String,
        new_parent_id: i64,
    ) -> Result<ReparentConflicts, WireError> {
        self.read(
            Call::new(
                Method::GET,
                format!(
                    "/nodes/{}/{}/reparent-conflicts",
                    segment(&node_type),
                    segment(&node_id)
                ),
            )
            .query("parent_type", &new_parent_type)
            .query("parent_id", &new_parent_id),
        )
        .await
    }

    async fn delete_task(&self, id: NodeId) -> Result<(), WireError> {
        self.write(Call::new(
            Method::DELETE,
            format!("/tasks/{}", segment(&id)),
        ))
        .await
    }

    async fn duplicate_task(
        &self,
        id: i64,
        target_type: String,
        target_id: i64,
        position: i64,
    ) -> Result<DuplicatedSubtree<Task>, WireError> {
        self.write(
            Call::new(Method::POST, format!("/tasks/{}/duplicate", segment(&id)))
                .query("target_type", &target_type)
                .query("target_id", &target_id)
                .query("position", &position),
        )
        .await
    }

    async fn add_task_dependency(
        &self,
        task_id: NodeId,
        dependency: Dependency,
    ) -> Result<(), WireError> {
        self.write(
            Call::new(
                Method::POST,
                format!("/tasks/{}/dependencies", segment(&task_id)),
            )
            .json(&dependency),
        )
        .await
    }

    async fn remove_task_dependency(
        &self,
        task_id: NodeId,
        dependency: Dependency,
    ) -> Result<(), WireError> {
        self.write(
            Call::new(
                Method::DELETE,
                format!("/tasks/{}/dependencies", segment(&task_id)),
            )
            .json(&dependency),
        )
        .await
    }

    async fn list_task_dependencies(&self, task_id: NodeId) -> Result<Vec<Dependency>, WireError> {
        self.read(Call::new(
            Method::GET,
            format!("/tasks/{}/dependencies", segment(&task_id)),
        ))
        .await
    }

    async fn task_done_at(&self, id: NodeId) -> Result<Option<chrono::NaiveDateTime>, WireError> {
        self.read(Call::new(
            Method::GET,
            format!("/tasks/{}/done-at", segment(&id)),
        ))
        .await
    }

    async fn set_task_done_at(
        &self,
        id: NodeId,
        at: chrono::NaiveDateTime,
    ) -> Result<(), WireError> {
        self.write(
            Call::new(Method::PUT, format!("/tasks/{}/done-at", segment(&id))).query("at", &at),
        )
        .await
    }

    async fn list_all_task_dependencies(&self) -> Result<Vec<TaskDependencyEdge>, WireError> {
        self.read(
            Call::new(Method::GET, "/board/task-dependencies".to_owned())
                .query("now", &device_now()),
        )
        .await
    }

    async fn create_goal(&self, request: CreateGoalRequest) -> Result<Goal, WireError> {
        self.write(Call::new(Method::POST, "/goals".to_owned()).json(&request))
            .await
    }

    async fn get_goal(&self, id: i64) -> Result<Goal, WireError> {
        self.read(Call::new(Method::GET, format!("/goals/{}", segment(&id))))
            .await
    }

    async fn list_goals(&self, now: chrono::NaiveDateTime) -> Result<Vec<Goal>, WireError> {
        self.read(Call::new(Method::GET, "/goals".to_owned()).query("now", &now))
            .await
    }

    async fn update_goal(
        &self,
        id: NodeId,
        request: UpdateGoalRequest,
        confirmed: Option<bool>,
    ) -> Result<Goal, WireError> {
        self.write(
            Call::new(Method::PATCH, format!("/goals/{}", segment(&id)))
                .query_opt("confirmed", confirmed.as_ref())
                .json(&request),
        )
        .await
    }

    async fn delete_goal(&self, id: NodeId) -> Result<(), WireError> {
        self.write(Call::new(
            Method::DELETE,
            format!("/goals/{}", segment(&id)),
        ))
        .await
    }

    async fn duplicate_goal(
        &self,
        id: i64,
        target_type: String,
        target_id: i64,
        position: i64,
    ) -> Result<DuplicatedSubtree<Goal>, WireError> {
        self.write(
            Call::new(Method::POST, format!("/goals/{}/duplicate", segment(&id)))
                .query("target_type", &target_type)
                .query("target_id", &target_id)
                .query("position", &position),
        )
        .await
    }

    async fn add_tag_to_task(&self, task_id: NodeId, tag_id: i64) -> Result<(), WireError> {
        self.write(Call::new(
            Method::PUT,
            format!(
                "/nodes/task/{}/tags/{}",
                segment(&task_id),
                segment(&tag_id)
            ),
        ))
        .await
    }

    async fn remove_tag_from_task(&self, task_id: NodeId, tag_id: i64) -> Result<(), WireError> {
        self.write(Call::new(
            Method::DELETE,
            format!(
                "/nodes/task/{}/tags/{}",
                segment(&task_id),
                segment(&tag_id)
            ),
        ))
        .await
    }

    async fn add_tag_to_goal(&self, goal_id: NodeId, tag_id: i64) -> Result<(), WireError> {
        self.write(Call::new(
            Method::PUT,
            format!(
                "/nodes/goal/{}/tags/{}",
                segment(&goal_id),
                segment(&tag_id)
            ),
        ))
        .await
    }

    async fn remove_tag_from_goal(&self, goal_id: NodeId, tag_id: i64) -> Result<(), WireError> {
        self.write(Call::new(
            Method::DELETE,
            format!(
                "/nodes/goal/{}/tags/{}",
                segment(&goal_id),
                segment(&tag_id)
            ),
        ))
        .await
    }

    async fn derive_scope_lifecycles(
        &self,
        now: chrono::NaiveDateTime,
    ) -> Result<Vec<ItemLifecycle>, WireError> {
        self.read(Call::new(Method::GET, "/board/lifecycles".to_owned()).query("now", &now))
            .await
    }
}
