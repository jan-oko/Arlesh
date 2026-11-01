//! [`SqliteBackend`]'s `flows` operations: the in-process core over the local file.

use crate::{
    error::WireError,
    flows::{
        self,
        model::{
            CreateFlowItemRequest, CreateFlowRequest, Flow, FlowCommitment, FlowCycleInput,
            FlowDependency, FlowExpectation, FlowGoal, FlowId, FlowItemCycle, FlowItemType,
            FlowOrigin, FlowRecurrence, FlowTask, MaterializedFlow, SetRecurrenceRequest,
            StartFlowRequest, TargetRef, UpdateFlowItemRequest, UpdateFlowRequest,
        },
    },
};

use super::SqliteBackend;
use crate::backend::flows::FlowsPort;

#[async_trait::async_trait]
impl FlowsPort for SqliteBackend {
    async fn create_flow(&self, request: CreateFlowRequest) -> Result<Flow, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.flows()
            .create(request)
            .await
            .map_err(WireError::from_error)
    }

    async fn get_flow(&self, id: i64) -> Result<Flow, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.flows()
            .get(FlowId(id))
            .await
            .map_err(WireError::from_error)
    }

    async fn list_flows(&self) -> Result<Vec<Flow>, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.flows().list().await.map_err(WireError::from_error)
    }

    async fn update_flow(&self, id: i64, request: UpdateFlowRequest) -> Result<Flow, WireError> {
        let now = chrono::Local::now().naive_local();
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let flow =
            crate::nodes::composite::update_flow_checked(&mut db, FlowId(id), request, now).await?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(flow)
    }

    async fn delete_flow(&self, id: i64) -> Result<(), WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        flows::delete_flow(&mut db, FlowId(id))
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)
    }

    async fn create_flow_goal(
        &self,
        request: CreateFlowItemRequest,
    ) -> Result<FlowGoal, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.flows()
            .create_goal(request)
            .await
            .map_err(WireError::from_error)
    }

    async fn create_flow_task(
        &self,
        request: CreateFlowItemRequest,
    ) -> Result<FlowTask, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.flows()
            .create_task(request)
            .await
            .map_err(WireError::from_error)
    }

    async fn create_flow_commitment(
        &self,
        request: CreateFlowItemRequest,
    ) -> Result<FlowCommitment, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.flows()
            .create_commitment_item(request)
            .await
            .map_err(WireError::from_error)
    }

    async fn create_flow_expectation(
        &self,
        request: CreateFlowItemRequest,
    ) -> Result<FlowExpectation, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.flows()
            .create_expectation_item(request)
            .await
            .map_err(WireError::from_error)
    }

    async fn update_flow_commitment(
        &self,
        id: i64,
        request: UpdateFlowItemRequest,
    ) -> Result<FlowCommitment, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let item = flows::update_flow_commitment(&mut db, id, request)
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(item)
    }

    async fn update_flow_expectation(
        &self,
        id: i64,
        request: UpdateFlowItemRequest,
    ) -> Result<FlowExpectation, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let item = flows::update_flow_expectation(&mut db, id, request)
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(item)
    }

    async fn list_flow_goals(&self, flow_id: i64) -> Result<Vec<FlowGoal>, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.flows()
            .list_goals(FlowId(flow_id))
            .await
            .map_err(WireError::from_error)
    }

    async fn list_flow_tasks(&self, flow_id: i64) -> Result<Vec<FlowTask>, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.flows()
            .list_tasks(FlowId(flow_id))
            .await
            .map_err(WireError::from_error)
    }

    async fn list_all_flow_goals(&self) -> Result<Vec<FlowGoal>, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.flows()
            .list_all_goals()
            .await
            .map_err(WireError::from_error)
    }

    async fn list_all_flow_tasks(&self) -> Result<Vec<FlowTask>, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.flows()
            .list_all_tasks()
            .await
            .map_err(WireError::from_error)
    }

    async fn update_flow_goal(
        &self,
        id: i64,
        request: UpdateFlowItemRequest,
    ) -> Result<FlowGoal, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let goal = flows::update_flow_goal(&mut db, id, request)
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(goal)
    }

    async fn update_flow_task(
        &self,
        id: i64,
        request: UpdateFlowItemRequest,
    ) -> Result<FlowTask, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let task = flows::update_flow_task(&mut db, id, request)
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(task)
    }

    async fn start_flow(
        &self,
        flow_id: i64,
        request: StartFlowRequest,
    ) -> Result<MaterializedFlow, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let materialized = flows::start(&mut db, FlowId(flow_id), request)
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(materialized)
    }

    async fn scope_valid_flow_targets(
        &self,
        duration_n: Option<i64>,
        duration_kind: Option<String>,
        anchor_date: Option<chrono::NaiveDate>,
        candidates: Vec<TargetRef>,
    ) -> Result<Vec<TargetRef>, WireError> {
        let duration = match (duration_n, duration_kind) {
            (Some(n), Some(kind)) => Some((n, kind)),
            _ => None,
        };
        // A read: resolving a concrete window derives its scopes and writes nothing.
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        flows::valid_targets(&mut db, duration, anchor_date, candidates)
            .await
            .map_err(WireError::from_error)
    }

    async fn set_flow_recurrence(
        &self,
        flow_id: i64,
        request: SetRecurrenceRequest,
    ) -> Result<FlowRecurrence, WireError> {
        let now = chrono::Local::now().naive_local();
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let recurrence = crate::nodes::composite::set_flow_recurrence_checked(
            &mut db,
            FlowId(flow_id),
            request,
            now,
        )
        .await?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(recurrence)
    }

    async fn get_flow_recurrence(&self, flow_id: i64) -> Result<Option<FlowRecurrence>, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.flows()
            .get_recurrence(FlowId(flow_id))
            .await
            .map_err(WireError::from_error)
    }

    async fn delete_flow_recurrence(&self, flow_id: i64) -> Result<(), WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.flows()
            .delete_recurrence(FlowId(flow_id))
            .await
            .map_err(WireError::from_error)
    }

    async fn flow_origins(&self, nodes: Vec<TargetRef>) -> Result<Vec<FlowOrigin>, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.flows()
            .origins(nodes)
            .await
            .map_err(WireError::from_error)
    }

    async fn list_flow_instance_nodes(&self) -> Result<Vec<TargetRef>, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.flows()
            .list_instance_node_refs()
            .await
            .map_err(WireError::from_error)
    }

    async fn delete_flow_item(&self, item_type: FlowItemType, id: i64) -> Result<(), WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        db.flows()
            .delete_item(item_type, id)
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)
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
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let fork = crate::nodes::composite::set_item_cycles_confirmed(
            &mut db,
            FlowId(flow_id),
            item_type,
            item_id,
            &cycles,
            reconcile,
            now,
            chrono::Local::now().naive_local(),
        )
        .await?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(fork)
    }

    async fn list_all_flow_cycles(&self) -> Result<Vec<FlowItemCycle>, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.flows()
            .list_all_cycles()
            .await
            .map_err(WireError::from_error)
    }

    async fn add_flow_dependency(
        &self,
        flow_id: i64,
        dependent_type: FlowItemType,
        dependent_id: i64,
        depends_on_type: FlowItemType,
        depends_on_id: i64,
    ) -> Result<(), WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.flows()
            .add_dependency(
                flow_id,
                dependent_type,
                dependent_id,
                depends_on_type,
                depends_on_id,
            )
            .await
            .map_err(WireError::from_error)
    }

    async fn remove_flow_dependency(
        &self,
        dependent_type: FlowItemType,
        dependent_id: i64,
        depends_on_type: FlowItemType,
        depends_on_id: i64,
    ) -> Result<(), WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.flows()
            .remove_dependency(dependent_type, dependent_id, depends_on_type, depends_on_id)
            .await
            .map_err(WireError::from_error)
    }

    async fn list_all_flow_dependencies(&self) -> Result<Vec<FlowDependency>, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.flows()
            .list_all_dependencies()
            .await
            .map_err(WireError::from_error)
    }

    async fn habit_completion_count(&self, flow_id: i64) -> Result<i64, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.flows()
            .habit_completion_count(FlowId(flow_id))
            .await
            .map_err(WireError::from_error)
    }

    async fn clear_habit_modifications(&self, flow_id: i64) -> Result<(), WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.flows()
            .clear_habit_modifications(FlowId(flow_id))
            .await
            .map_err(WireError::from_error)
    }

    async fn fork_flow(&self, flow_id: i64, now: chrono::NaiveDateTime) -> Result<Flow, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let forked = flows::archive_and_fork(&mut db, FlowId(flow_id), now)
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(forked)
    }

    async fn duplicate_flow(
        &self,
        flow_id: i64,
        parent_type: String,
        parent_id: i64,
        position: i64,
    ) -> Result<Flow, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let copy =
            flows::duplicate_flow(&mut db, FlowId(flow_id), &parent_type, parent_id, position)
                .await
                .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(copy)
    }

    async fn duplicate_flow_item(
        &self,
        item_type: FlowItemType,
        item_id: i64,
        parent_type: String,
        parent_id: i64,
        position: i64,
    ) -> Result<i64, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let new_id = flows::duplicate_flow_item(
            &mut db,
            item_type,
            item_id,
            &parent_type,
            parent_id,
            position,
        )
        .await
        .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(new_id)
    }

    async fn convert_to_flow(
        &self,
        node_type: String,
        node_id: i64,
        keep_dependencies: bool,
        map_scopes: bool,
    ) -> Result<Flow, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let flow =
            flows::convert_to_flow(&mut db, &node_type, node_id, keep_dependencies, map_scopes)
                .await
                .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(flow)
    }
}
