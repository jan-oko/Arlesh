//! Flows: templates for Goal/Task subtrees, materialized on demand.

pub mod error;
pub mod model;

use std::time::{SystemTime, UNIX_EPOCH};

use crate::database::DatabasePool;
use error::FlowError;
use model::{
    CreateFlowItemRequest, CreateFlowRequest, Flow, FlowCycleInput, FlowDependency, FlowGoal,
    FlowId, FlowItemCycle, FlowItemType, FlowTask, UpdateFlowItemRequest, UpdateFlowRequest,
};

/// Millisecond timestamp used to seed sort position (matches the tasks/goals convention).
fn now_position() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// Repository for Flow and flow-item CRUD.
pub struct FlowRepository<'a> {
    pool: &'a DatabasePool,
}

impl<'a> FlowRepository<'a> {
    /// Creates a new repository backed by `pool`.
    pub fn new(pool: &'a DatabasePool) -> Self {
        Self { pool }
    }

    /// Creates a new flow.
    pub async fn create(&self, request: CreateFlowRequest) -> Result<Flow, FlowError> {
        let instance_type = request.instance_type.map(|it| it.as_str()).unwrap_or("task");
        let id = sqlx::query(
            "INSERT INTO flows
                (title, instance_type, parent_type, parent_id, target_type, target_id,
                 flow_duration_n, flow_duration_kind, position)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&request.title)
        .bind(instance_type)
        .bind(&request.parent_type)
        .bind(request.parent_id)
        .bind(&request.target_type)
        .bind(request.target_id)
        .bind(request.flow_duration_n)
        .bind(&request.flow_duration_kind)
        .bind(now_position())
        .execute(self.pool)
        .await?
        .last_insert_rowid();
        self.get(FlowId(id)).await
    }

    /// Fetches a flow by id.
    pub async fn get(&self, id: FlowId) -> Result<Flow, FlowError> {
        sqlx::query_as::<_, Flow>("SELECT * FROM flows WHERE id = ?")
            .bind(id.0)
            .fetch_optional(self.pool)
            .await?
            .ok_or(FlowError::NotFound(id.0))
    }

    /// Lists all flows in sort order.
    pub async fn list(&self) -> Result<Vec<Flow>, FlowError> {
        Ok(sqlx::query_as::<_, Flow>("SELECT * FROM flows ORDER BY position ASC")
            .fetch_all(self.pool)
            .await?)
    }

    /// Updates a flow.
    pub async fn update(&self, id: FlowId, request: UpdateFlowRequest) -> Result<Flow, FlowError> {
        let flow = self.get(id).await?;
        let title = request.title.unwrap_or(flow.title);
        let instance_type = request
            .instance_type
            .map(|it| it.as_str().to_string())
            .unwrap_or(flow.instance_type);
        let target_type = request.target_type.unwrap_or(flow.target_type);
        let target_id = request.target_id.unwrap_or(flow.target_id);
        let flow_duration_n = request.flow_duration_n.unwrap_or(flow.flow_duration_n);
        let flow_duration_kind = request.flow_duration_kind.unwrap_or(flow.flow_duration_kind);
        let parent_type = request.parent_type.unwrap_or(flow.parent_type);
        let parent_id = request.parent_id.unwrap_or(flow.parent_id);
        let position = request.position.unwrap_or(flow.position);
        sqlx::query(
            "UPDATE flows SET title=?, instance_type=?, parent_type=?, parent_id=?,
                target_type=?, target_id=?, flow_duration_n=?, flow_duration_kind=?, position=?
             WHERE id=?",
        )
        .bind(&title)
        .bind(&instance_type)
        .bind(&parent_type)
        .bind(parent_id)
        .bind(&target_type)
        .bind(target_id)
        .bind(flow_duration_n)
        .bind(&flow_duration_kind)
        .bind(position)
        .bind(id.0)
        .execute(self.pool)
        .await?;
        self.get(id).await
    }

    /// Deletes a flow and (via cascade) its items.
    pub async fn delete(&self, id: FlowId) -> Result<(), FlowError> {
        self.get(id).await?;
        sqlx::query("DELETE FROM flows WHERE id = ?")
            .bind(id.0)
            .execute(self.pool)
            .await?;
        Ok(())
    }

    /// Creates a flow-goal item.
    pub async fn create_goal(&self, request: CreateFlowItemRequest) -> Result<FlowGoal, FlowError> {
        let id = sqlx::query(
            "INSERT INTO flow_goals (flow_id, title, parent_type, parent_id, position)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(request.flow_id)
        .bind(&request.title)
        .bind(&request.parent_type)
        .bind(request.parent_id)
        .bind(now_position())
        .execute(self.pool)
        .await?
        .last_insert_rowid();
        sqlx::query_as::<_, FlowGoal>("SELECT * FROM flow_goals WHERE id = ?")
            .bind(id)
            .fetch_one(self.pool)
            .await
            .map_err(FlowError::from)
    }

    /// Creates a flow-task item.
    pub async fn create_task(&self, request: CreateFlowItemRequest) -> Result<FlowTask, FlowError> {
        let id = sqlx::query(
            "INSERT INTO flow_tasks (flow_id, title, parent_type, parent_id, position)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(request.flow_id)
        .bind(&request.title)
        .bind(&request.parent_type)
        .bind(request.parent_id)
        .bind(now_position())
        .execute(self.pool)
        .await?
        .last_insert_rowid();
        sqlx::query_as::<_, FlowTask>("SELECT * FROM flow_tasks WHERE id = ?")
            .bind(id)
            .fetch_one(self.pool)
            .await
            .map_err(FlowError::from)
    }

    /// Lists a flow's goal items.
    pub async fn list_goals(&self, flow_id: FlowId) -> Result<Vec<FlowGoal>, FlowError> {
        Ok(
            sqlx::query_as::<_, FlowGoal>("SELECT * FROM flow_goals WHERE flow_id = ? ORDER BY position ASC")
                .bind(flow_id.0)
                .fetch_all(self.pool)
                .await?,
        )
    }

    /// Lists a flow's task items.
    pub async fn list_tasks(&self, flow_id: FlowId) -> Result<Vec<FlowTask>, FlowError> {
        Ok(
            sqlx::query_as::<_, FlowTask>("SELECT * FROM flow_tasks WHERE flow_id = ? ORDER BY position ASC")
                .bind(flow_id.0)
                .fetch_all(self.pool)
                .await?,
        )
    }

    /// Lists every flow's goal items (for the mindmap load).
    pub async fn list_all_goals(&self) -> Result<Vec<FlowGoal>, FlowError> {
        Ok(sqlx::query_as::<_, FlowGoal>("SELECT * FROM flow_goals ORDER BY position ASC")
            .fetch_all(self.pool)
            .await?)
    }

    /// Lists every flow's task items (for the mindmap load).
    pub async fn list_all_tasks(&self) -> Result<Vec<FlowTask>, FlowError> {
        Ok(sqlx::query_as::<_, FlowTask>("SELECT * FROM flow_tasks ORDER BY position ASC")
            .fetch_all(self.pool)
            .await?)
    }

    /// Updates a flow-goal item.
    pub async fn update_goal(
        &self,
        id: i64,
        request: UpdateFlowItemRequest,
    ) -> Result<FlowGoal, FlowError> {
        let goal = sqlx::query_as::<_, FlowGoal>("SELECT * FROM flow_goals WHERE id = ?")
            .bind(id)
            .fetch_optional(self.pool)
            .await?
            .ok_or(FlowError::NotFound(id))?;
        let title = request.title.unwrap_or(goal.title);
        let status = request.status.unwrap_or(goal.status);
        let blocked_reason = request.blocked_reason.unwrap_or(goal.blocked_reason);
        let parent_type = request.parent_type.unwrap_or(goal.parent_type);
        let parent_id = request.parent_id.unwrap_or(goal.parent_id);
        let position = request.position.unwrap_or(goal.position);
        sqlx::query(
            "UPDATE flow_goals SET title=?, status=?, blocked_reason=?, parent_type=?, parent_id=?, position=?
             WHERE id=?",
        )
        .bind(&title)
        .bind(&status)
        .bind(&blocked_reason)
        .bind(&parent_type)
        .bind(parent_id)
        .bind(position)
        .bind(id)
        .execute(self.pool)
        .await?;
        sqlx::query_as::<_, FlowGoal>("SELECT * FROM flow_goals WHERE id = ?")
            .bind(id)
            .fetch_one(self.pool)
            .await
            .map_err(FlowError::from)
    }

    /// Updates a flow-task item.
    pub async fn update_task(
        &self,
        id: i64,
        request: UpdateFlowItemRequest,
    ) -> Result<FlowTask, FlowError> {
        let task = sqlx::query_as::<_, FlowTask>("SELECT * FROM flow_tasks WHERE id = ?")
            .bind(id)
            .fetch_optional(self.pool)
            .await?
            .ok_or(FlowError::NotFound(id))?;
        let title = request.title.unwrap_or(task.title);
        let status = request.status.unwrap_or(task.status);
        let blocked_reason = request.blocked_reason.unwrap_or(task.blocked_reason);
        let parent_type = request.parent_type.unwrap_or(task.parent_type);
        let parent_id = request.parent_id.unwrap_or(task.parent_id);
        let position = request.position.unwrap_or(task.position);
        sqlx::query(
            "UPDATE flow_tasks SET title=?, status=?, blocked_reason=?, parent_type=?, parent_id=?, position=?
             WHERE id=?",
        )
        .bind(&title)
        .bind(&status)
        .bind(&blocked_reason)
        .bind(&parent_type)
        .bind(parent_id)
        .bind(position)
        .bind(id)
        .execute(self.pool)
        .await?;
        sqlx::query_as::<_, FlowTask>("SELECT * FROM flow_tasks WHERE id = ?")
            .bind(id)
            .fetch_one(self.pool)
            .await
            .map_err(FlowError::from)
    }

    /// Deletes a flow item and its cycles and dependency links.
    pub async fn delete_item(&self, item_type: FlowItemType, id: i64) -> Result<(), FlowError> {
        let table = match item_type {
            FlowItemType::FlowGoal => "flow_goals",
            FlowItemType::FlowTask => "flow_tasks",
        };
        self.clear_item_links(item_type, id).await?;
        sqlx::query(&format!("DELETE FROM {table} WHERE id = ?"))
            .bind(id)
            .execute(self.pool)
            .await?;
        Ok(())
    }

    /// Removes an item's cycle pairs and any dependency it participates in.
    async fn clear_item_links(&self, item_type: FlowItemType, id: i64) -> Result<(), FlowError> {
        sqlx::query("DELETE FROM flow_item_cycles WHERE item_type = ? AND item_id = ?")
            .bind(item_type.as_str())
            .bind(id)
            .execute(self.pool)
            .await?;
        sqlx::query(
            "DELETE FROM flow_dependencies
             WHERE (dependent_type = ?1 AND dependent_id = ?2)
                OR (depends_on_type = ?1 AND depends_on_id = ?2)",
        )
        .bind(item_type.as_str())
        .bind(id)
        .execute(self.pool)
        .await?;
        Ok(())
    }

    /// Replaces a flow item's (Cycle Scope, Cycle Plan) pairs with `cycles`.
    pub async fn set_cycles(
        &self,
        flow_id: i64,
        item_type: FlowItemType,
        item_id: i64,
        cycles: &[FlowCycleInput],
    ) -> Result<(), FlowError> {
        sqlx::query("DELETE FROM flow_item_cycles WHERE item_type = ? AND item_id = ?")
            .bind(item_type.as_str())
            .bind(item_id)
            .execute(self.pool)
            .await?;
        for (position, cycle) in cycles.iter().enumerate() {
            sqlx::query(
                "INSERT INTO flow_item_cycles
                    (flow_id, item_type, item_id, scope_kind, scope_index,
                     plan_kind, plan_start, plan_end, position)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(flow_id)
            .bind(item_type.as_str())
            .bind(item_id)
            .bind(&cycle.scope_kind)
            .bind(cycle.scope_index)
            .bind(&cycle.plan_kind)
            .bind(cycle.plan_start)
            .bind(cycle.plan_end)
            .bind(position as i64)
            .execute(self.pool)
            .await?;
        }
        Ok(())
    }

    /// Lists every flow's cycle pairs (for the mindmap load).
    pub async fn list_all_cycles(&self) -> Result<Vec<FlowItemCycle>, FlowError> {
        Ok(sqlx::query_as::<_, FlowItemCycle>(
            "SELECT * FROM flow_item_cycles ORDER BY item_type, item_id, position ASC",
        )
        .fetch_all(self.pool)
        .await?)
    }

    /// Adds an intra-flow dependency (`dependent` waits on `depends_on`); a no-op if it exists.
    pub async fn add_dependency(
        &self,
        flow_id: i64,
        dependent_type: FlowItemType,
        dependent_id: i64,
        depends_on_type: FlowItemType,
        depends_on_id: i64,
    ) -> Result<(), FlowError> {
        sqlx::query(
            "INSERT OR IGNORE INTO flow_dependencies
                (flow_id, dependent_type, dependent_id, depends_on_type, depends_on_id)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(flow_id)
        .bind(dependent_type.as_str())
        .bind(dependent_id)
        .bind(depends_on_type.as_str())
        .bind(depends_on_id)
        .execute(self.pool)
        .await?;
        Ok(())
    }

    /// Removes an intra-flow dependency.
    pub async fn remove_dependency(
        &self,
        dependent_type: FlowItemType,
        dependent_id: i64,
        depends_on_type: FlowItemType,
        depends_on_id: i64,
    ) -> Result<(), FlowError> {
        sqlx::query(
            "DELETE FROM flow_dependencies
             WHERE dependent_type = ? AND dependent_id = ?
               AND depends_on_type = ? AND depends_on_id = ?",
        )
        .bind(dependent_type.as_str())
        .bind(dependent_id)
        .bind(depends_on_type.as_str())
        .bind(depends_on_id)
        .execute(self.pool)
        .await?;
        Ok(())
    }

    /// Lists every flow's dependencies (for the mindmap load).
    pub async fn list_all_dependencies(&self) -> Result<Vec<FlowDependency>, FlowError> {
        Ok(sqlx::query_as::<_, FlowDependency>("SELECT * FROM flow_dependencies")
            .fetch_all(self.pool)
            .await?)
    }
}
