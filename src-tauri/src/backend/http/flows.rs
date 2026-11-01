//! [`HttpBackend`]'s `flows` operations: each one REST call to `arlesh-server`, as
//! `conformance/client-mode.json` lists it.

use crate::{
    error::WireError,
    flows::{
        self,
        model::{
            CreateFlowItemRequest, CreateFlowRequest, Flow, FlowCommitment, FlowCycleInput,
            FlowDependency, FlowExpectation, FlowGoal, FlowItemCycle, FlowItemType, FlowOrigin,
            FlowRecurrence, FlowTask, MaterializedFlow, SetRecurrenceRequest, StartFlowRequest,
            TargetRef, UpdateFlowItemRequest, UpdateFlowRequest,
        },
    },
};

use super::{segment, Call, HttpBackend};
use crate::backend::flows::FlowsPort;
use reqwest::Method;

#[async_trait::async_trait]
impl FlowsPort for HttpBackend {
    async fn create_flow(&self, request: CreateFlowRequest) -> Result<Flow, WireError> {
        self.write(Call::new(Method::POST, "/flows".to_owned()).json(&request))
            .await
    }

    async fn get_flow(&self, id: i64) -> Result<Flow, WireError> {
        self.read(Call::new(Method::GET, format!("/flows/{}", segment(&id))))
            .await
    }

    async fn list_flows(&self) -> Result<Vec<Flow>, WireError> {
        self.read(Call::new(Method::GET, "/flows".to_owned())).await
    }

    async fn update_flow(&self, id: i64, request: UpdateFlowRequest) -> Result<Flow, WireError> {
        self.write(Call::new(Method::PATCH, format!("/flows/{}", segment(&id))).json(&request))
            .await
    }

    async fn delete_flow(&self, id: i64) -> Result<(), WireError> {
        self.write(Call::new(
            Method::DELETE,
            format!("/flows/{}", segment(&id)),
        ))
        .await
    }

    async fn create_flow_goal(
        &self,
        request: CreateFlowItemRequest,
    ) -> Result<FlowGoal, WireError> {
        self.write(Call::new(Method::POST, "/flow-items/flow_goal".to_owned()).json(&request))
            .await
    }

    async fn create_flow_task(
        &self,
        request: CreateFlowItemRequest,
    ) -> Result<FlowTask, WireError> {
        self.write(Call::new(Method::POST, "/flow-items/flow_task".to_owned()).json(&request))
            .await
    }

    async fn create_flow_commitment(
        &self,
        request: CreateFlowItemRequest,
    ) -> Result<FlowCommitment, WireError> {
        self.write(Call::new(Method::POST, "/flow-items/flow_commitment".to_owned()).json(&request))
            .await
    }

    async fn create_flow_expectation(
        &self,
        request: CreateFlowItemRequest,
    ) -> Result<FlowExpectation, WireError> {
        self.write(
            Call::new(Method::POST, "/flow-items/flow_expectation".to_owned()).json(&request),
        )
        .await
    }

    async fn update_flow_commitment(
        &self,
        id: i64,
        request: UpdateFlowItemRequest,
    ) -> Result<FlowCommitment, WireError> {
        self.write(
            Call::new(
                Method::PATCH,
                format!("/flow-items/flow_commitment/{}", segment(&id)),
            )
            .json(&request),
        )
        .await
    }

    async fn update_flow_expectation(
        &self,
        id: i64,
        request: UpdateFlowItemRequest,
    ) -> Result<FlowExpectation, WireError> {
        self.write(
            Call::new(
                Method::PATCH,
                format!("/flow-items/flow_expectation/{}", segment(&id)),
            )
            .json(&request),
        )
        .await
    }

    async fn list_flow_goals(&self, flow_id: i64) -> Result<Vec<FlowGoal>, WireError> {
        self.read(Call::new(
            Method::GET,
            format!("/flows/{}/goals", segment(&flow_id)),
        ))
        .await
    }

    async fn list_flow_tasks(&self, flow_id: i64) -> Result<Vec<FlowTask>, WireError> {
        self.read(Call::new(
            Method::GET,
            format!("/flows/{}/tasks", segment(&flow_id)),
        ))
        .await
    }

    async fn list_all_flow_goals(&self) -> Result<Vec<FlowGoal>, WireError> {
        self.read(Call::new(Method::GET, "/flow-items/flow_goal".to_owned()))
            .await
    }

    async fn list_all_flow_tasks(&self) -> Result<Vec<FlowTask>, WireError> {
        self.read(Call::new(Method::GET, "/flow-items/flow_task".to_owned()))
            .await
    }

    async fn update_flow_goal(
        &self,
        id: i64,
        request: UpdateFlowItemRequest,
    ) -> Result<FlowGoal, WireError> {
        self.write(
            Call::new(
                Method::PATCH,
                format!("/flow-items/flow_goal/{}", segment(&id)),
            )
            .json(&request),
        )
        .await
    }

    async fn update_flow_task(
        &self,
        id: i64,
        request: UpdateFlowItemRequest,
    ) -> Result<FlowTask, WireError> {
        self.write(
            Call::new(
                Method::PATCH,
                format!("/flow-items/flow_task/{}", segment(&id)),
            )
            .json(&request),
        )
        .await
    }

    async fn start_flow(
        &self,
        flow_id: i64,
        request: StartFlowRequest,
    ) -> Result<MaterializedFlow, WireError> {
        self.write(
            Call::new(Method::POST, format!("/flows/{}/start", segment(&flow_id))).json(&request),
        )
        .await
    }

    async fn scope_valid_flow_targets(
        &self,
        duration_n: Option<i64>,
        duration_kind: Option<String>,
        anchor_date: Option<chrono::NaiveDate>,
        candidates: Vec<TargetRef>,
    ) -> Result<Vec<TargetRef>, WireError> {
        self.read(
            Call::new(Method::POST, "/flows/scope-valid-targets".to_owned())
                .query_opt("duration_n", duration_n.as_ref())
                .query_opt("duration_kind", duration_kind.as_ref())
                .query_opt("anchor_date", anchor_date.as_ref())
                .json(&candidates),
        )
        .await
    }

    async fn set_flow_recurrence(
        &self,
        flow_id: i64,
        request: SetRecurrenceRequest,
    ) -> Result<FlowRecurrence, WireError> {
        self.write(
            Call::new(
                Method::PUT,
                format!("/flows/{}/recurrence", segment(&flow_id)),
            )
            .json(&request),
        )
        .await
    }

    async fn get_flow_recurrence(&self, flow_id: i64) -> Result<Option<FlowRecurrence>, WireError> {
        self.read(Call::new(
            Method::GET,
            format!("/flows/{}/recurrence", segment(&flow_id)),
        ))
        .await
    }

    async fn delete_flow_recurrence(&self, flow_id: i64) -> Result<(), WireError> {
        self.write(Call::new(
            Method::DELETE,
            format!("/flows/{}/recurrence", segment(&flow_id)),
        ))
        .await
    }

    async fn flow_origins(&self, nodes: Vec<TargetRef>) -> Result<Vec<FlowOrigin>, WireError> {
        self.read(Call::new(Method::POST, "/flows/origins".to_owned()).json(&nodes))
            .await
    }

    async fn list_flow_instance_nodes(&self) -> Result<Vec<TargetRef>, WireError> {
        self.read(Call::new(Method::GET, "/flows/instance-nodes".to_owned()))
            .await
    }

    async fn delete_flow_item(&self, item_type: FlowItemType, id: i64) -> Result<(), WireError> {
        self.write(Call::new(
            Method::DELETE,
            format!("/flow-items/{}/{}", segment(&item_type), segment(&id)),
        ))
        .await
    }

    async fn set_flow_item_cycles(
        &self,
        flow_id: i64,
        item_type: FlowItemType,
        item_id: i64,
        cycles: Vec<FlowCycleInput>,
        reconcile: Option<flows::cycles::Reconcile>,
        now: Option<chrono::NaiveDateTime>,
    ) -> Result<Option<flows::cycles::ForkedTemplate>, WireError> {
        self.write(
            Call::new(
                Method::PUT,
                format!(
                    "/flow-items/{}/{}/cycles",
                    segment(&item_type),
                    segment(&item_id)
                ),
            )
            .query("flow_id", &flow_id)
            .query_opt("reconcile", reconcile.as_ref())
            .query_opt("now", now.as_ref())
            .json(&cycles),
        )
        .await
    }

    async fn list_all_flow_cycles(&self) -> Result<Vec<FlowItemCycle>, WireError> {
        self.read(Call::new(Method::GET, "/flow-items/cycles".to_owned()))
            .await
    }

    async fn add_flow_dependency(
        &self,
        flow_id: i64,
        dependent_type: FlowItemType,
        dependent_id: i64,
        depends_on_type: FlowItemType,
        depends_on_id: i64,
    ) -> Result<(), WireError> {
        self.write(
            Call::new(
                Method::POST,
                format!("/flows/{}/dependencies", segment(&flow_id)),
            )
            .query("dependent_type", &dependent_type)
            .query("dependent_id", &dependent_id)
            .query("depends_on_type", &depends_on_type)
            .query("depends_on_id", &depends_on_id),
        )
        .await
    }

    async fn remove_flow_dependency(
        &self,
        dependent_type: FlowItemType,
        dependent_id: i64,
        depends_on_type: FlowItemType,
        depends_on_id: i64,
    ) -> Result<(), WireError> {
        self.write(Call::new(
            Method::DELETE,
            format!(
                "/flow-items/{}/{}/dependencies/{}/{}",
                segment(&dependent_type),
                segment(&dependent_id),
                segment(&depends_on_type),
                segment(&depends_on_id)
            ),
        ))
        .await
    }

    async fn list_all_flow_dependencies(&self) -> Result<Vec<FlowDependency>, WireError> {
        self.read(Call::new(
            Method::GET,
            "/flow-items/dependencies".to_owned(),
        ))
        .await
    }

    async fn habit_completion_count(&self, flow_id: i64) -> Result<i64, WireError> {
        self.read(Call::new(
            Method::GET,
            format!("/flows/{}/completion-count", segment(&flow_id)),
        ))
        .await
    }

    async fn clear_habit_modifications(&self, flow_id: i64) -> Result<(), WireError> {
        self.write(Call::new(
            Method::DELETE,
            format!("/flows/{}/habit-modifications", segment(&flow_id)),
        ))
        .await
    }

    async fn fork_flow(&self, flow_id: i64, now: chrono::NaiveDateTime) -> Result<Flow, WireError> {
        self.write(
            Call::new(Method::POST, format!("/flows/{}/fork", segment(&flow_id)))
                .query("now", &now),
        )
        .await
    }

    async fn duplicate_flow(
        &self,
        flow_id: i64,
        parent_type: String,
        parent_id: i64,
        position: i64,
    ) -> Result<Flow, WireError> {
        self.write(
            Call::new(
                Method::POST,
                format!("/flows/{}/duplicate", segment(&flow_id)),
            )
            .query("parent_type", &parent_type)
            .query("parent_id", &parent_id)
            .query("position", &position),
        )
        .await
    }

    async fn duplicate_flow_item(
        &self,
        item_type: FlowItemType,
        item_id: i64,
        parent_type: String,
        parent_id: i64,
        position: i64,
    ) -> Result<i64, WireError> {
        self.write(
            Call::new(
                Method::POST,
                format!(
                    "/flow-items/{}/{}/duplicate",
                    segment(&item_type),
                    segment(&item_id)
                ),
            )
            .query("parent_type", &parent_type)
            .query("parent_id", &parent_id)
            .query("position", &position),
        )
        .await
    }

    async fn convert_to_flow(
        &self,
        node_type: String,
        node_id: i64,
        keep_dependencies: bool,
        map_scopes: bool,
    ) -> Result<Flow, WireError> {
        self.write(
            Call::new(
                Method::POST,
                format!(
                    "/{}s/{}/convert-to-flow",
                    segment(&node_type),
                    segment(&node_id)
                ),
            )
            .query("keep_dependencies", &keep_dependencies)
            .query("map_scopes", &map_scopes),
        )
        .await
    }
}
