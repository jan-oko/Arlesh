//! Flows: templates for Goal/Task subtrees, materialized on demand.

pub mod error;
pub mod model;

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{Duration, Months, NaiveDate};

use crate::database::DatabasePool;
use crate::scopes::model::{PartOfDay, Scope, ScopeKind};
use crate::scopes::ScopeRepository;
use crate::tasks::model::{
    CreateGoalRequest, CreateTaskRequest, Dependency, DurationSpec, TaskId, TimeScope,
};
use crate::tasks::{GoalRepository, TaskRepository};
use error::FlowError;
use model::{
    CreateFlowItemRequest, CreateFlowRequest, Flow, FlowCycleInput, FlowDependency, FlowGoal,
    FlowId, FlowItemCycle, FlowItemType, FlowTask, MaterializedFlow, StartFlowRequest,
    UpdateFlowItemRequest, UpdateFlowRequest,
};

/// Advances `date` by `k` (possibly zero) periods of `kind`; `None` on calendar overflow.
fn advance(date: NaiveDate, k: i64, kind: &str) -> Option<NaiveDate> {
    match kind {
        "day" => date.checked_add_signed(Duration::days(k)),
        "week" => date.checked_add_signed(Duration::days(k * 7)),
        "month" => date.checked_add_months(Months::new(u32::try_from(k).ok()?)),
        "season" => date.checked_add_months(Months::new(u32::try_from(k * 3).ok()?)),
        _ => None,
    }
}

/// Maps a target node kind to the parent_type a real goal/task uses (domain-table kinds → project).
fn target_parent_type(kind: &str) -> String {
    match kind {
        "goal" => "goal",
        "task" => "task",
        _ => "project",
    }
    .to_string()
}

/// The canonical `ScopeKind` for a flow-scope kind string.
fn flow_scope_kind(kind: &str) -> Result<ScopeKind, FlowError> {
    match kind {
        "day" => Ok(ScopeKind::Day),
        "week" => Ok(ScopeKind::Week),
        "month" => Ok(ScopeKind::Month),
        "season" => Ok(ScopeKind::Season),
        other => Err(FlowError::Invalid(format!("unsupported flow kind {other}"))),
    }
}

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
        let parent_type = request.parent_type.unwrap_or(goal.parent_type);
        let parent_id = request.parent_id.unwrap_or(goal.parent_id);
        let position = request.position.unwrap_or(goal.position);
        sqlx::query(
            "UPDATE flow_goals SET title=?, parent_type=?, parent_id=?, position=?
             WHERE id=?",
        )
        .bind(&title)
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
        let parent_type = request.parent_type.unwrap_or(task.parent_type);
        let parent_id = request.parent_id.unwrap_or(task.parent_id);
        let position = request.position.unwrap_or(task.position);
        sqlx::query(
            "UPDATE flow_tasks SET title=?, parent_type=?, parent_id=?, position=?
             WHERE id=?",
        )
        .bind(&title)
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

    /// Converts a flow item to the other kind (goal↔task), moving it to the other table.
    ///
    /// The item's cycle pairs and dependency edges (both directions) are re-pointed to the new
    /// row, and children still parented on it are reparented onto it where the nesting rules allow
    /// (a flow-goal child cannot sit under a flow-task, so the caller must move or delete those
    /// first). Returns the new item id.
    pub async fn convert_item(
        &self,
        from: FlowItemType,
        id: i64,
        to: FlowItemType,
    ) -> Result<i64, FlowError> {
        if from == to {
            return Ok(id);
        }
        // Common fields carry over regardless of which table the item lives in.
        let (flow_id, title, parent_type, parent_id, position) = match from {
            FlowItemType::FlowGoal => {
                let g = sqlx::query_as::<_, FlowGoal>("SELECT * FROM flow_goals WHERE id = ?")
                    .bind(id)
                    .fetch_optional(self.pool)
                    .await?
                    .ok_or(FlowError::NotFound(id))?;
                (g.flow_id, g.title, g.parent_type, g.parent_id, g.position)
            }
            FlowItemType::FlowTask => {
                let t = sqlx::query_as::<_, FlowTask>("SELECT * FROM flow_tasks WHERE id = ?")
                    .bind(id)
                    .fetch_optional(self.pool)
                    .await?
                    .ok_or(FlowError::NotFound(id))?;
                (t.flow_id, t.title, t.parent_type, t.parent_id, t.position)
            }
        };

        let new_table = match to {
            FlowItemType::FlowGoal => "flow_goals",
            FlowItemType::FlowTask => "flow_tasks",
        };
        let new_id = sqlx::query(&format!(
            "INSERT INTO {new_table} (flow_id, title, parent_type, parent_id, position)
             VALUES (?, ?, ?, ?, ?)"
        ))
        .bind(flow_id)
        .bind(&title)
        .bind(&parent_type)
        .bind(parent_id)
        .bind(position)
        .execute(self.pool)
        .await?
        .last_insert_rowid();

        // Re-point this item's cycles and dependency edges (both directions) to the new row.
        sqlx::query("UPDATE flow_item_cycles SET item_type = ?, item_id = ? WHERE item_type = ? AND item_id = ?")
            .bind(to.as_str()).bind(new_id).bind(from.as_str()).bind(id)
            .execute(self.pool).await?;
        sqlx::query("UPDATE flow_dependencies SET dependent_type = ?, dependent_id = ? WHERE dependent_type = ? AND dependent_id = ?")
            .bind(to.as_str()).bind(new_id).bind(from.as_str()).bind(id)
            .execute(self.pool).await?;
        sqlx::query("UPDATE flow_dependencies SET depends_on_type = ?, depends_on_id = ? WHERE depends_on_type = ? AND depends_on_id = ?")
            .bind(to.as_str()).bind(new_id).bind(from.as_str()).bind(id)
            .execute(self.pool).await?;

        // Reparent children onto the new row where nesting allows. Task children are valid under
        // both kinds; goal children only under a goal.
        sqlx::query("UPDATE flow_tasks SET parent_type = ?, parent_id = ? WHERE parent_type = ? AND parent_id = ?")
            .bind(to.as_str()).bind(new_id).bind(from.as_str()).bind(id)
            .execute(self.pool).await?;
        if to == FlowItemType::FlowGoal {
            sqlx::query("UPDATE flow_goals SET parent_type = ?, parent_id = ? WHERE parent_type = ? AND parent_id = ?")
                .bind(to.as_str()).bind(new_id).bind(from.as_str()).bind(id)
                .execute(self.pool).await?;
        }

        // The old row's links were re-pointed, so a plain delete orphans nothing.
        let old_table = match from {
            FlowItemType::FlowGoal => "flow_goals",
            FlowItemType::FlowTask => "flow_tasks",
        };
        sqlx::query(&format!("DELETE FROM {old_table} WHERE id = ?"))
            .bind(id)
            .execute(self.pool)
            .await?;
        Ok(new_id)
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

    /// Resolves the `index`-th (1-based) `kind` subscope beginning at `base`, by offset.
    async fn offset_scope(
        &self,
        scopes: &ScopeRepository<'_>,
        base: NaiveDate,
        index: i64,
        kind: &str,
    ) -> Result<Scope, FlowError> {
        let off = index - 1;
        let bad_date = || FlowError::Invalid("cycle resolves outside the calendar".to_string());
        match kind {
            "season" | "month" | "week" | "day" => {
                let date = advance(base, off, kind).ok_or_else(bad_date)?;
                Ok(scopes.get_or_create(flow_scope_kind(kind)?, date).await?)
            }
            "part_of_day" => {
                let date = advance(base, off / 6, "day").ok_or_else(bad_date)?;
                let part = PartOfDay::CYCLE[usize::try_from(off % 6).unwrap_or(0)];
                Ok(scopes.get_or_create_part(date, part).await?)
            }
            other => Err(FlowError::Invalid(format!("unsupported cycle kind {other}"))),
        }
    }

    /// Resolves a cycle pair into a concrete (Time Scope, Plan) against the window start.
    /// A null-scope pair (or an unscoped flow) yields `(None, None)` — the item inherits the root.
    async fn resolve_pair(
        &self,
        scopes: &ScopeRepository<'_>,
        pair: Option<&FlowItemCycle>,
        window_start: Option<NaiveDate>,
    ) -> Result<(Option<TimeScope>, Option<TimeScope>), FlowError> {
        let (Some(pair), Some(base)) = (pair, window_start) else { return Ok((None, None)) };
        let (Some(kind), Some(index)) = (pair.scope_kind.as_deref(), pair.scope_index) else {
            return Ok((None, None));
        };
        let scope = self.offset_scope(scopes, base, index, kind).await?;
        let cycle_start = NaiveDate::parse_from_str(&scope.start_date, "%Y-%m-%d")
            .map_err(|e| FlowError::Invalid(e.to_string()))?;
        let time_scope = Some(TimeScope { start_id: scope.id, end_id: scope.id, duration: None });

        let plan = match (pair.plan_kind.as_deref(), pair.plan_start, pair.plan_end) {
            (Some(pk), Some(ps), Some(pe)) => {
                let start = self.offset_scope(scopes, cycle_start, ps, pk).await?;
                let end = self.offset_scope(scopes, cycle_start, pe, pk).await?;
                Some(TimeScope { start_id: start.id, end_id: end.id, duration: None })
            }
            _ => None,
        };
        Ok((time_scope, plan))
    }

    /// Records a materialised node against a flow instance. Each `(type, id)` pair identifies the
    /// real node, the flow item it came from, and the parent it was created under.
    async fn record_node(
        &self,
        instance_id: i64,
        node: (&str, i64),
        source: (&str, i64),
        parent: (&str, i64),
    ) -> Result<(), FlowError> {
        sqlx::query(
            "INSERT INTO flow_instance_nodes
                (flow_instance_id, node_type, node_id, source_item_type, source_item_id,
                 original_parent_type, original_parent_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(instance_id).bind(node.0).bind(node.1).bind(source.0).bind(source.1)
        .bind(parent.0).bind(parent.1)
        .execute(self.pool)
        .await?;
        Ok(())
    }

    /// Starts a flow: materialises its template into a real, independent Goal/Task subtree under
    /// the target, resolving every cycle pair and remapping intra-flow dependencies by fan-in.
    pub async fn start(
        &self,
        flow_id: FlowId,
        request: StartFlowRequest,
    ) -> Result<MaterializedFlow, FlowError> {
        let flow = self.get(flow_id).await?;
        let scopes = ScopeRepository::new(self.pool);
        let goals = GoalRepository::new(self.pool);
        let tasks = TaskRepository::new(self.pool);

        // Resolve the flow window (only when the flow is scoped).
        let (window, window_start): (Option<TimeScope>, Option<NaiveDate>) =
            match (flow.flow_duration_n, flow.flow_duration_kind.as_deref()) {
                (Some(n), Some(kind)) => {
                    let start_scope = scopes.get_or_create(flow_scope_kind(kind)?, request.anchor_date).await?;
                    let start_date = NaiveDate::parse_from_str(&start_scope.start_date, "%Y-%m-%d")
                        .map_err(|e| FlowError::Invalid(e.to_string()))?;
                    let end_date = advance(start_date, n - 1, kind)
                        .ok_or_else(|| FlowError::Invalid("window exceeds the calendar".to_string()))?;
                    let end_scope = scopes.get_or_create(flow_scope_kind(kind)?, end_date).await?;
                    (
                        Some(TimeScope {
                            start_id: start_scope.id,
                            end_id: end_scope.id,
                            duration: Some(DurationSpec { n, kind: kind.to_string() }),
                        }),
                        Some(start_date),
                    )
                }
                _ => (None, None),
            };

        // Materialise the root of the flow's Instance Type under the (kind-mapped) target.
        let root_parent_type = target_parent_type(&request.target_type);
        let (root_type, root_id) = if flow.instance_type == "goal" {
            let g = goals
                .create(CreateGoalRequest {
                    title: request.title.clone(),
                    parent_type: root_parent_type.clone(),
                    parent_id: request.target_id,
                    status: None,
                    time_scope: window.clone(),
                })
                .await?;
            ("goal".to_string(), g.id)
        } else {
            let t = tasks
                .create(CreateTaskRequest {
                    title: request.title.clone(),
                    parent_type: root_parent_type.clone(),
                    parent_id: request.target_id,
                    status: None,
                    time_scope: window.clone(),
                    plan: None,
                })
                .await?;
            ("task".to_string(), t.id)
        };

        let instance_id = sqlx::query(
            "INSERT INTO flow_instances (flow_id, root_type, root_id, started_at) VALUES (?, ?, ?, ?)",
        )
        .bind(flow_id.0).bind(&root_type).bind(root_id).bind(now_position())
        .execute(self.pool).await?.last_insert_rowid();
        self.record_node(instance_id, (&root_type, root_id), ("flow", flow_id.0), (&request.target_type, request.target_id)).await?;

        // Owned item list + per-item cycles, so nothing borrows across awaits.
        let flow_goals = self.list_goals(flow_id).await?;
        let flow_tasks = self.list_tasks(flow_id).await?;
        let all_cycles = self.list_all_cycles().await?;
        struct MItem { kind: FlowItemType, id: i64, title: String, parent_type: String, parent_id: i64, position: i64 }
        let mut items: Vec<MItem> = Vec::new();
        for g in &flow_goals {
            items.push(MItem { kind: FlowItemType::FlowGoal, id: g.id, title: g.title.clone(), parent_type: g.parent_type.clone(), parent_id: g.parent_id, position: g.position });
        }
        for t in &flow_tasks {
            items.push(MItem { kind: FlowItemType::FlowTask, id: t.id, title: t.title.clone(), parent_type: t.parent_type.clone(), parent_id: t.parent_id, position: t.position });
        }

        // template (item_type, id) -> its instance node refs, in pair order.
        let mut instances: HashMap<(String, i64), Vec<(String, i64)>> = HashMap::new();

        // Breadth-first from the root so a parent is always materialised before its children.
        let mut queue: Vec<(String, i64, String, i64)> = vec![("flow".to_string(), flow_id.0, root_type.clone(), root_id)];
        while let Some((parent_key_type, parent_key_id, parent_node_type, parent_node_id)) = queue.pop() {
            let mut children: Vec<(FlowItemType, i64, String)> = items
                .iter()
                .filter(|m| m.parent_type == parent_key_type && m.parent_id == parent_key_id)
                .map(|m| (m.kind, m.id, m.title.clone()))
                .collect();
            children.sort_by_key(|(_, id, _)| {
                items.iter().find(|m| m.id == *id).map(|m| m.position).unwrap_or(0)
            });

            for (kind, id, title) in children {
                let mut pairs: Vec<FlowItemCycle> = all_cycles
                    .iter()
                    .filter(|c| c.flow_id == flow_id.0 && c.item_type == kind.as_str() && c.item_id == id)
                    .cloned()
                    .collect();
                pairs.sort_by_key(|c| c.position);
                let pair_opts: Vec<Option<FlowItemCycle>> =
                    if pairs.is_empty() { vec![None] } else { pairs.into_iter().map(Some).collect() };

                let mut child_nodes: Vec<(String, i64)> = Vec::new();
                for pair in &pair_opts {
                    let (time_scope, plan) = self.resolve_pair(&scopes, pair.as_ref(), window_start).await?;
                    let node = if kind == FlowItemType::FlowGoal {
                        let g = goals.create(CreateGoalRequest { title: title.clone(), parent_type: parent_node_type.clone(), parent_id: parent_node_id, status: None, time_scope }).await?;
                        ("goal".to_string(), g.id)
                    } else {
                        let t = tasks.create(CreateTaskRequest { title: title.clone(), parent_type: parent_node_type.clone(), parent_id: parent_node_id, status: None, time_scope, plan }).await?;
                        ("task".to_string(), t.id)
                    };
                    self.record_node(instance_id, (&node.0, node.1), (kind.as_str(), id), (&parent_node_type, parent_node_id)).await?;
                    child_nodes.push(node);
                }

                // Children of this item nest under its first instance.
                if let Some(first) = child_nodes.first().cloned() {
                    queue.push((kind.as_str().to_string(), id, first.0, first.1));
                }
                instances.insert((kind.as_str().to_string(), id), child_nodes);
            }
        }

        // Fan-in dependencies: each dependent-task instance waits on every blocker instance.
        for dep in self.list_all_dependencies().await?.iter().filter(|d| d.flow_id == flow_id.0) {
            let dependents = instances.get(&(dep.dependent_type.clone(), dep.dependent_id)).cloned().unwrap_or_default();
            let blockers = instances.get(&(dep.depends_on_type.clone(), dep.depends_on_id)).cloned().unwrap_or_default();
            for (dtype, did) in &dependents {
                if dtype != "task" { continue; } // only tasks can be dependents in the real model
                for (btype, bid) in &blockers {
                    let dependency = if btype == "goal" { Dependency::Goal { id: *bid } } else { Dependency::Task { id: *bid } };
                    tasks.add_dependency(TaskId(*did), dependency).await?;
                }
            }
        }

        Ok(MaterializedFlow { root_type, root_id })
    }
}
