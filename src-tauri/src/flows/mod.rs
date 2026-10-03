//! Flows: templates for Goal/Task subtrees, materialized on demand.
//!
//! Single-resource SQL over the flow tables lives on [`FlowOperator`]. Everything that also has to
//! reach scopes, tasks or goals — [`start`], [`convert_to_flow`], [`valid_targets`],
//! [`generate_habit_iterations`] — is a **free function over a [`Db`] session** instead, as is
//! every operation whose write depends on a read it took first ([`update_flow`], [`delete_flow`],
//! [`set_flow_recurrence`], [`set_iteration_done`], [`fork_flow`] and the
//! two item updates). Those take `&mut Db<Transactional>` specifically, so calling one
//! non-atomically is a compile error; the operator halves they drive are module-private. See
//! [`Db`]'s `# Where an operation lives`.
//!
//! The scope helpers — `offset_scope`, `resolve_pair`, `resolve_window`, `resolve_flow_window`,
//! `habit_slots` — are pure: a scope is derived from its value key (ADR 0009), so resolving a
//! window reads and writes nothing.

mod compound_readings;
pub use rules::cooldown;
pub mod cycles;
pub mod done_date;
pub mod error;
pub use rules::habits;
pub mod model;
pub mod occurrence_edit;
pub mod occurrences;
mod render;
mod rows;
pub mod rules;
pub mod template;

use std::collections::{HashMap, VecDeque};
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{Duration, NaiveDate, NaiveDateTime};

use crate::database::session::{Db, SessionMode, Transactional};
use crate::infos::model::CreateInfoRequest;
use crate::nodes::{
    self,
    id::NodeId,
    key::{OccurrenceKey, TemplateKind},
    overlay::OverlayOperator,
};
use crate::scopes::db::DbScopeKey;
use crate::scopes::key::ScopeKey;
use crate::scopes::resolve::{day_boundary, interval_contains};
use crate::tasks::model::{
    CommitmentId, CreateCommitmentRequest, CreateGoalRequest, CreateTaskRequest, Dependency,
    GoalId, Status, TaskId, TimeScope, Verdict,
};
use crate::tasks::{
    add_task_dependency, create_commitment, create_goal, create_task, delete_goal, delete_task,
    nearest_scoped_ancestor_window,
};
use error::FlowError;
use habits::{classify_iterations, expire_unanswered, SlotWindow};
use model::{
    ChildAttachment, ClockKind, CreateFlowItemRequest, CreateFlowRequest, Flow, FlowCommitment,
    FlowCycleInput, FlowDependency, FlowExpectation, FlowGoal, FlowId, FlowItemCycle,
    FlowItemType, FlowOrigin, FlowRecurrence, FlowTask, HabitInstanceChild, HabitInstanceRef, HabitItemStatus, HabitIteration, InstanceType,
    MaterializedFlow, MissPolicy, SetRecurrenceRequest, StartFlowRequest, TargetRef,
    UnfinishedChild, UpdateFlowItemRequest, UpdateFlowRequest, NO_CYCLE,
};
use render::{render, FlowTemplate, NodeRef, PlannedSource, RenderedPlan, TemplateItem};
use rows::{
    FlowCommitmentRow, FlowDependencyRow, FlowExpectationRow, FlowGoalRow, FlowItemCycleRow,
    FlowRecurrenceRow, FlowRow, FlowTaskRow, HabitInstanceChildRow, HabitItemStatusRow,
    TargetRefRow,
};
use template::{duration_columns, TemplateFields, TemplateOperator, TemplateTable};

use rules::schedule::*;
pub(crate) use rules::schedule::{habit_verdict_window, iteration_window, whole_scope_plan};

/// Millisecond timestamp used to seed sort position (matches the tasks/goals convention).
fn now_position() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// One `derived_children` row, as the ancestry climb reads it.
#[derive(sqlx::FromRow)]
struct AttachmentRow {
    flow_id: Option<i64>,
    parent_kind: String,
    parent_key: String,
    window_start_scope_id: Option<DbScopeKey>,
    window_end_scope_id: Option<DbScopeKey>,
}

impl AttachmentRow {
    /// The attachment the row records.
    fn attachment(self) -> ChildAttachment {
        ChildAttachment {
            flow_id: self.flow_id.unwrap_or_default(),
            instance_type: self.parent_kind,
            parent_key: self.parent_key,
            window: self
                .window_start_scope_id
                .zip(self.window_end_scope_id)
                .map(|(start_id, end_id)| TimeScope {
                    start_id: start_id.0,
                    end_id: end_id.0,
                    duration: None,
                }),
        }
    }
}

/// One `derived_children` row with the child it attaches, as a whole board's index reads it.
#[derive(sqlx::FromRow)]
struct ChildAttachmentRow {
    child_type: String,
    child_id: i64,
    #[sqlx(flatten)]
    attachment: AttachmentRow,
}

/// Reads and writes flow templates — and their items, cycles, recurrences and instances —
/// on a session's connection.
///
/// Obtained as `db.flows()` and used inline; see [`Db`] for the borrow rules and for where an
/// operation belongs.
///
/// Everything here touches the flow tables only. The methods that first **read** and then write
/// what they read — `update`, `delete`, `update_goal`, `update_task`,
/// `set_recurrence`, `set_iteration_done` and `fork_flow` — are **module-private**, because an
/// operator wraps a bare connection and so cannot demand a transaction in its signature. Their
/// public entry points are the free functions below ([`update_flow`], [`delete_flow`], …), which
/// take `&mut Db<Transactional>` and therefore make a non-atomic call a compile error. See
/// [`Db`]'s `# Where an operation lives`.
pub struct FlowOperator<'session> {
    /// The session's connection, borrowed for the duration of this operator's life.
    connection: &'session mut sqlx::SqliteConnection,
}

impl<'session> FlowOperator<'session> {
    /// Wraps the connection a session is lending.
    pub(crate) fn new(connection: &'session mut sqlx::SqliteConnection) -> Self {
        Self { connection }
    }

    /// Opens a flow **instance** row — one materialisation of a flow — and returns its id.
    ///
    /// Private: an instance with no nodes recorded against it is meaningless, so the row is only
    /// ever opened from [`start`], which goes on to record them.
    async fn open_instance(
        &mut self,
        flow_id: FlowId,
        root_type: &str,
        root_id: i64,
    ) -> Result<i64, FlowError> {
        Ok(sqlx::query(
            "INSERT INTO flow_instances (flow_id, root_type, root_id, started_at) VALUES (?, ?, ?, ?)",
        )
        .bind(flow_id.0)
        .bind(root_type)
        .bind(root_id)
        .bind(now_position())
        .execute(&mut *self.connection)
        .await?
        .last_insert_rowid())
    }

    /// Creates a new flow.
    pub async fn create(&mut self, request: CreateFlowRequest) -> Result<Flow, FlowError> {
        let instance_type = request
            .instance_type
            .map(|it| it.as_str())
            .unwrap_or("task");
        let id = sqlx::query(
            "INSERT INTO flows
                (title, instance_type, parent_type, parent_id, target_type, target_id,
                 flow_duration_n, flow_duration_kind,
                 flow_window_part, flow_window_time_start, flow_window_time_end,
                 root_plan_kind, root_plan_start, root_plan_end,
                 verdict_window_n, verdict_window_kind, position, is_private)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&request.title)
        .bind(instance_type)
        .bind(&request.parent_type)
        .bind(request.parent_id)
        .bind(&request.target_type)
        .bind(request.target_id)
        .bind(request.flow_duration_n)
        .bind(&request.flow_duration_kind)
        .bind(&request.flow_window_part)
        .bind(&request.flow_window_time_start)
        .bind(&request.flow_window_time_end)
        .bind(&request.root_plan_kind)
        .bind(request.root_plan_start)
        .bind(request.root_plan_end)
        .bind(request.verdict_window_n)
        .bind(&request.verdict_window_kind)
        .bind(now_position())
        .bind(request.is_private)
        .execute(&mut *self.connection)
        .await?
        .last_insert_rowid();
        self.get(FlowId(id)).await
    }

    /// Fetches a flow by id, with its root template's fields.
    pub async fn get(&mut self, id: FlowId) -> Result<Flow, FlowError> {
        let mut flow = sqlx::query_as::<_, FlowRow>(
            "SELECT flows.*, EXISTS(SELECT 1 FROM flow_recurrences WHERE flow_recurrences.flow_id = flows.id) AS is_habit
             FROM flows WHERE id = ?",
        )
        .bind(id.0)
        .fetch_optional(&mut *self.connection)
        .await?
        .map(Flow::from)
        .ok_or(FlowError::NotFound(id.0))?;
        flow.template = self.templates().one(TemplateTable::Flow, id.0).await?;
        Ok(flow)
    }

    /// Lists all flows in sort order, each with its root template's fields.
    pub async fn list(&mut self) -> Result<Vec<Flow>, FlowError> {
        let mut flows = sqlx::query_as::<_, FlowRow>(
            "SELECT flows.*, EXISTS(SELECT 1 FROM flow_recurrences WHERE flow_recurrences.flow_id = flows.id) AS is_habit
             FROM flows ORDER BY position ASC",
        )
        .fetch_all(&mut *self.connection)
        .await?
        .into_iter()
        .map(Flow::from)
        .collect::<Vec<_>>();
        let mut fields = self.templates().all(TemplateTable::Flow).await?;
        for flow in &mut flows {
            flow.template = fields.remove(&flow.id).unwrap_or_default();
        }
        Ok(flows)
    }

    /// The template fields of this session's connection.
    fn templates(&mut self) -> TemplateOperator<'_> {
        TemplateOperator::new(&mut *self.connection)
    }

    /// Stamps each goal item with its template fields.
    async fn with_goal_templates(
        &mut self,
        mut goals: Vec<FlowGoal>,
    ) -> Result<Vec<FlowGoal>, FlowError> {
        let mut fields = self.templates().all(TemplateTable::FlowGoal).await?;
        for goal in &mut goals {
            goal.template = fields.remove(&goal.id).unwrap_or_default();
        }
        Ok(goals)
    }

    /// Stamps each task item with its template fields.
    async fn with_task_templates(
        &mut self,
        mut tasks: Vec<FlowTask>,
    ) -> Result<Vec<FlowTask>, FlowError> {
        let mut fields = self.templates().all(TemplateTable::FlowTask).await?;
        for task in &mut tasks {
            task.template = fields.remove(&task.id).unwrap_or_default();
        }
        Ok(tasks)
    }

    /// Updates a flow.
    ///
    /// **Module-private.** It reads the stored row and writes values derived from it, so it is
    /// only correct inside a transaction — and an operator wraps a bare connection, which cannot
    /// demand one in its signature. [`update_flow`] is the entry point; it takes
    /// `&mut Db<Transactional>` and is this method's only caller.
    async fn update(&mut self, id: FlowId, request: UpdateFlowRequest) -> Result<Flow, FlowError> {
        let flow = self.get(id).await?;
        let was_commitment = flow.instance_type == "commitment";
        let title = request.title.unwrap_or(flow.title);
        let instance_type = request
            .instance_type
            .map(|it| it.as_str().to_string())
            .unwrap_or(flow.instance_type);
        let target_type = request.target_type.unwrap_or(flow.target_type);
        let target_id = request.target_id.unwrap_or(flow.target_id);
        let flow_duration_n = request.flow_duration_n.unwrap_or(flow.flow_duration_n);
        let flow_duration_kind = request
            .flow_duration_kind
            .unwrap_or(flow.flow_duration_kind);
        let flow_window_part = request.flow_window_part.unwrap_or(flow.flow_window_part);
        let flow_window_time_start = request
            .flow_window_time_start
            .unwrap_or(flow.flow_window_time_start);
        let flow_window_time_end = request
            .flow_window_time_end
            .unwrap_or(flow.flow_window_time_end);
        let root_plan_kind = request.root_plan_kind.unwrap_or(flow.root_plan_kind);
        let root_plan_start = request.root_plan_start.unwrap_or(flow.root_plan_start);
        let root_plan_end = request.root_plan_end.unwrap_or(flow.root_plan_end);
        let verdict_window_n = request.verdict_window_n.unwrap_or(flow.verdict_window_n);
        let verdict_window_kind = request
            .verdict_window_kind
            .unwrap_or(flow.verdict_window_kind);
        let parent_type = request.parent_type.unwrap_or(flow.parent_type);
        let parent_id = request.parent_id.unwrap_or(flow.parent_id);
        let position = request.position.unwrap_or(flow.position);
        let is_private = request.is_private.unwrap_or(flow.is_private);
        // The same rule from the other direction: a flow that already holds goal items cannot
        // become a commitment flow, because those items would have nowhere to materialise and the
        // whole Habit would quietly stop deriving iterations. Refused by name, and the count is in
        // the message so the caller knows what stands in the way.
        if instance_type == "commitment" && !was_commitment {
            let goal_items = self.list_goals(id).await?.len();
            if goal_items > 0 {
                return Err(FlowError::Invalid(format!(
                    "this flow holds {goal_items} goal item(s), which a commitment flow cannot: \
                     remove them before changing the instance type"
                )));
            }
        }
        sqlx::query(
            "UPDATE flows SET title=?, instance_type=?, parent_type=?, parent_id=?,
                target_type=?, target_id=?, flow_duration_n=?, flow_duration_kind=?,
                flow_window_part=?, flow_window_time_start=?, flow_window_time_end=?,
                root_plan_kind=?, root_plan_start=?, root_plan_end=?,
                verdict_window_n=?, verdict_window_kind=?, position=?, is_private=?
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
        .bind(&flow_window_part)
        .bind(&flow_window_time_start)
        .bind(&flow_window_time_end)
        .bind(&root_plan_kind)
        .bind(root_plan_start)
        .bind(root_plan_end)
        .bind(verdict_window_n)
        .bind(&verdict_window_kind)
        .bind(position)
        .bind(is_private)
        .bind(id.0)
        .execute(&mut *self.connection)
        .await?;
        self.get(id).await
    }

    /// Deletes a flow and (via cascade) its items.
    ///
    /// **Module-private.** It reads the stored row and writes values derived from it, so it is
    /// only correct inside a transaction — and an operator wraps a bare connection, which cannot
    /// demand one in its signature. [`delete_flow`] is the entry point; it takes
    /// `&mut Db<Transactional>` and is this method's only caller.
    async fn delete(&mut self, id: FlowId) -> Result<(), FlowError> {
        self.get(id).await?;
        // The template relations are polymorphic and carry no foreign key, so they are forgotten
        // here rather than by the cascade that takes the items themselves.
        for goal in self.list_goals(id).await? {
            self.templates()
                .forget(TemplateTable::FlowGoal, goal.id)
                .await?;
        }
        for task in self.list_tasks(id).await? {
            self.templates()
                .forget(TemplateTable::FlowTask, task.id)
                .await?;
        }
        for kind in [FlowItemType::FlowCommitment, FlowItemType::FlowExpectation] {
            for item_id in self.item_ids(kind, id).await? {
                self.templates()
                    .forget(TemplateTable::of_item(kind), item_id)
                    .await?;
            }
        }
        self.templates().forget(TemplateTable::Flow, id.0).await?;
        sqlx::query("DELETE FROM flows WHERE id = ?")
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Creates a flow-goal item.
    ///
    /// Refused on a **commitment** flow. A Commitment holds Tasks and other Commitments and no
    /// Goals, so materialising such a template is refused by `goals.parent_type` and the whole
    /// Habit derives no iterations at all — a state the app used to let you build in one keystroke
    /// and only explain afterwards, through the Mindmap's failure banner. This is the other end of
    /// that: the item is never created, so the banner condition never exists.
    pub async fn create_goal(
        &mut self,
        request: CreateFlowItemRequest,
    ) -> Result<FlowGoal, FlowError> {
        let instance_type = self.get(FlowId(request.flow_id)).await?.instance_type;
        if instance_type == "commitment" {
            return Err(FlowError::Invalid(
                "a commitment flow holds no goal items — a Commitment cannot parent a Goal"
                    .to_string(),
            ));
        }
        rules::items::require_placement(
            FlowItemType::FlowGoal,
            &request.parent_type,
            &instance_type,
        )?;
        let id = sqlx::query(
            "INSERT INTO flow_goals (flow_id, title, parent_type, parent_id, position)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(request.flow_id)
        .bind(&request.title)
        .bind(&request.parent_type)
        .bind(request.parent_id)
        .bind(now_position())
        .execute(&mut *self.connection)
        .await?
        .last_insert_rowid();
        sqlx::query_as::<_, FlowGoalRow>("SELECT * FROM flow_goals WHERE id = ?")
            .bind(id)
            .fetch_one(&mut *self.connection)
            .await
            .map(FlowGoal::from)
            .map_err(FlowError::from)
    }

    /// Creates a flow-task item.
    pub async fn create_task(
        &mut self,
        request: CreateFlowItemRequest,
    ) -> Result<FlowTask, FlowError> {
        let instance_type = self.get(FlowId(request.flow_id)).await?.instance_type;
        rules::items::require_placement(
            FlowItemType::FlowTask,
            &request.parent_type,
            &instance_type,
        )?;
        let id = sqlx::query(
            "INSERT INTO flow_tasks (flow_id, title, parent_type, parent_id, position)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(request.flow_id)
        .bind(&request.title)
        .bind(&request.parent_type)
        .bind(request.parent_id)
        .bind(now_position())
        .execute(&mut *self.connection)
        .await?
        .last_insert_rowid();
        sqlx::query_as::<_, FlowTaskRow>("SELECT * FROM flow_tasks WHERE id = ?")
            .bind(id)
            .fetch_one(&mut *self.connection)
            .await
            .map(FlowTask::from)
            .map_err(FlowError::from)
    }

    /// Lists a flow's goal items.
    pub async fn list_goals(&mut self, flow_id: FlowId) -> Result<Vec<FlowGoal>, FlowError> {
        let goals = sqlx::query_as::<_, FlowGoalRow>(
            "SELECT * FROM flow_goals WHERE flow_id = ? ORDER BY position ASC",
        )
        .bind(flow_id.0)
        .fetch_all(&mut *self.connection)
        .await?
        .into_iter()
        .map(FlowGoal::from)
        .collect();
        self.with_goal_templates(goals).await
    }

    /// Lists a flow's task items.
    pub async fn list_tasks(&mut self, flow_id: FlowId) -> Result<Vec<FlowTask>, FlowError> {
        let tasks = sqlx::query_as::<_, FlowTaskRow>(
            "SELECT * FROM flow_tasks WHERE flow_id = ? ORDER BY position ASC",
        )
        .bind(flow_id.0)
        .fetch_all(&mut *self.connection)
        .await?
        .into_iter()
        .map(FlowTask::from)
        .collect();
        self.with_task_templates(tasks).await
    }

    /// Inserts a bare item row of `kind` — title, place and the head of its siblings — once its
    /// placement is allowed, and returns its id.
    async fn insert_item(
        &mut self,
        kind: FlowItemType,
        request: &CreateFlowItemRequest,
    ) -> Result<i64, FlowError> {
        let instance_type = self.get(FlowId(request.flow_id)).await?.instance_type;
        rules::items::require_placement(kind, &request.parent_type, &instance_type)?;
        let table = kind.table();
        Ok(sqlx::query(&format!(
            "INSERT INTO {table} (flow_id, title, parent_type, parent_id, position)
             VALUES (?, ?, ?, ?, ?)"
        ))
        .bind(request.flow_id)
        .bind(&request.title)
        .bind(&request.parent_type)
        .bind(request.parent_id)
        .bind(now_position())
        .execute(&mut *self.connection)
        .await?
        .last_insert_rowid())
    }

    /// Creates a flow **Commitment** item: each occurrence is its own Commitment.
    pub async fn create_commitment_item(
        &mut self,
        request: CreateFlowItemRequest,
    ) -> Result<FlowCommitment, FlowError> {
        let id = self
            .insert_item(FlowItemType::FlowCommitment, &request)
            .await?;
        self.commitment_item(id).await
    }

    /// Creates a flow **wait** item: each occurrence is its own wait.
    pub async fn create_expectation_item(
        &mut self,
        request: CreateFlowItemRequest,
    ) -> Result<FlowExpectation, FlowError> {
        let id = self
            .insert_item(FlowItemType::FlowExpectation, &request)
            .await?;
        self.expectation_item(id).await
    }

    /// One Commitment item, with its tags.
    pub async fn commitment_item(&mut self, id: i64) -> Result<FlowCommitment, FlowError> {
        let mut item =
            sqlx::query_as::<_, FlowCommitmentRow>("SELECT * FROM flow_commitments WHERE id = ?")
                .bind(id)
                .fetch_optional(&mut *self.connection)
                .await?
                .map(FlowCommitment::from)
                .ok_or(FlowError::NotFound(id))?;
        item.template = self
            .templates()
            .one(TemplateTable::FlowCommitment, id)
            .await?;
        Ok(item)
    }

    /// One wait item, with its tags.
    pub async fn expectation_item(&mut self, id: i64) -> Result<FlowExpectation, FlowError> {
        let mut item =
            sqlx::query_as::<_, FlowExpectationRow>("SELECT * FROM flow_expectations WHERE id = ?")
                .bind(id)
                .fetch_optional(&mut *self.connection)
                .await?
                .map(FlowExpectation::from)
                .ok_or(FlowError::NotFound(id))?;
        item.template = self
            .templates()
            .one(TemplateTable::FlowExpectation, id)
            .await?;
        Ok(item)
    }

    /// Commitment items, one flow's or (`None`) every flow's, in position order, with their tags.
    pub async fn list_commitment_items(
        &mut self,
        flow_id: Option<FlowId>,
    ) -> Result<Vec<FlowCommitment>, FlowError> {
        let mut items: Vec<FlowCommitment> = sqlx::query_as::<_, FlowCommitmentRow>(
            "SELECT * FROM flow_commitments WHERE ?1 IS NULL OR flow_id = ?1 ORDER BY position ASC",
        )
        .bind(flow_id.map(|id| id.0))
        .fetch_all(&mut *self.connection)
        .await?
        .into_iter()
        .map(FlowCommitment::from)
        .collect();
        let mut fields = self.templates().all(TemplateTable::FlowCommitment).await?;
        for item in &mut items {
            item.template = fields.remove(&item.id).unwrap_or_default();
        }
        Ok(items)
    }

    /// Wait items, one flow's or (`None`) every flow's, in position order, with their tags.
    pub async fn list_expectation_items(
        &mut self,
        flow_id: Option<FlowId>,
    ) -> Result<Vec<FlowExpectation>, FlowError> {
        let mut items: Vec<FlowExpectation> = sqlx::query_as::<_, FlowExpectationRow>(
            "SELECT * FROM flow_expectations WHERE ?1 IS NULL OR flow_id = ?1 ORDER BY position ASC",
        )
        .bind(flow_id.map(|id| id.0))
        .fetch_all(&mut *self.connection)
        .await?
        .into_iter()
        .map(FlowExpectation::from)
        .collect();
        let mut fields = self.templates().all(TemplateTable::FlowExpectation).await?;
        for item in &mut items {
            item.template = fields.remove(&item.id).unwrap_or_default();
        }
        Ok(items)
    }

    /// The ids of one flow's items of `kind`, in position order.
    async fn item_ids(&mut self, kind: FlowItemType, flow_id: FlowId) -> Result<Vec<i64>, FlowError> {
        let table = kind.table();
        Ok(sqlx::query_scalar(&format!(
            "SELECT id FROM {table} WHERE flow_id = ? ORDER BY position ASC"
        ))
        .bind(flow_id.0)
        .fetch_all(&mut *self.connection)
        .await?)
    }

    /// A flow's items as `(item_type, item_id)` in render order — goal items, task items,
    /// Commitment items then wait items, each block in position order — the order a Habit
    /// iteration lists its occurrences in.
    pub async fn instance_items(
        &mut self,
        flow_id: FlowId,
    ) -> Result<Vec<(String, i64)>, FlowError> {
        let mut items = Vec::new();
        for kind in FlowItemType::ALL {
            for id in self.item_ids(kind, flow_id).await? {
                items.push((kind.as_str().to_string(), id));
            }
        }
        Ok(items)
    }

    /// A flow's cycle pairs grouped by the item that owns them, each group in position order. An
    /// item with no pairs is absent from the map rather than present with an empty list.
    pub async fn cycles_by_item(
        &mut self,
        flow_id: FlowId,
    ) -> Result<HashMap<(String, i64), Vec<FlowItemCycle>>, FlowError> {
        let rows = sqlx::query_as::<_, FlowItemCycleRow>(
            "SELECT * FROM flow_item_cycles WHERE flow_id = ? ORDER BY item_type, item_id, position ASC",
        )
        .bind(flow_id.0)
        .fetch_all(&mut *self.connection)
        .await?
        .into_iter()
        .map(FlowItemCycle::from);
        let mut grouped: HashMap<(String, i64), Vec<FlowItemCycle>> = HashMap::new();
        for cycle in rows {
            grouped
                .entry((cycle.item_type.clone(), cycle.item_id))
                .or_default()
                .push(cycle);
        }
        Ok(grouped)
    }

    /// Lists every flow's goal items (for the mindmap load).
    pub async fn list_all_goals(&mut self) -> Result<Vec<FlowGoal>, FlowError> {
        let goals =
            sqlx::query_as::<_, FlowGoalRow>("SELECT * FROM flow_goals ORDER BY position ASC")
                .fetch_all(&mut *self.connection)
                .await?
                .into_iter()
                .map(FlowGoal::from)
                .collect();
        self.with_goal_templates(goals).await
    }

    /// Lists every flow's task items (for the mindmap load).
    pub async fn list_all_tasks(&mut self) -> Result<Vec<FlowTask>, FlowError> {
        let tasks =
            sqlx::query_as::<_, FlowTaskRow>("SELECT * FROM flow_tasks ORDER BY position ASC")
                .fetch_all(&mut *self.connection)
                .await?
                .into_iter()
                .map(FlowTask::from)
                .collect();
        self.with_task_templates(tasks).await
    }

    /// Updates a flow-goal item.
    ///
    /// **Module-private.** It reads the stored row and writes values derived from it, so it is
    /// only correct inside a transaction — and an operator wraps a bare connection, which cannot
    /// demand one in its signature. [`update_flow_goal`] is the entry point; it takes
    /// `&mut Db<Transactional>` and is this method's only caller.
    async fn update_goal(
        &mut self,
        id: i64,
        request: UpdateFlowItemRequest,
    ) -> Result<FlowGoal, FlowError> {
        Self::refuse_foreign_fields(FlowItemType::FlowGoal, &request)?;
        let goal = sqlx::query_as::<_, FlowGoalRow>("SELECT * FROM flow_goals WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut *self.connection)
            .await?
            .map(FlowGoal::from)
            .ok_or(FlowError::NotFound(id))?;
        let title = request.title.unwrap_or(goal.title);
        let moved = request
            .parent_type
            .as_ref()
            .is_some_and(|parent| *parent != goal.parent_type);
        let parent_type = request.parent_type.unwrap_or(goal.parent_type);
        let parent_id = request.parent_id.unwrap_or(goal.parent_id);
        if moved {
            let instance_type = self.get(FlowId(goal.flow_id)).await?.instance_type;
            rules::items::require_placement(FlowItemType::FlowGoal, &parent_type, &instance_type)?;
        }
        let position = request.position.unwrap_or(goal.position);
        let is_private = request.is_private.unwrap_or(goal.is_private);
        sqlx::query(
            "UPDATE flow_goals SET title=?, parent_type=?, parent_id=?, position=?, is_private=?
             WHERE id=?",
        )
        .bind(&title)
        .bind(&parent_type)
        .bind(parent_id)
        .bind(position)
        .bind(is_private)
        .bind(id)
        .execute(&mut *self.connection)
        .await?;
        sqlx::query_as::<_, FlowGoalRow>("SELECT * FROM flow_goals WHERE id = ?")
            .bind(id)
            .fetch_one(&mut *self.connection)
            .await
            .map(FlowGoal::from)
            .map_err(FlowError::from)
    }

    /// Updates a flow-task item.
    ///
    /// **Module-private.** It reads the stored row and writes values derived from it, so it is
    /// only correct inside a transaction — and an operator wraps a bare connection, which cannot
    /// demand one in its signature. [`update_flow_task`] is the entry point; it takes
    /// `&mut Db<Transactional>` and is this method's only caller.
    async fn update_task(
        &mut self,
        id: i64,
        request: UpdateFlowItemRequest,
    ) -> Result<FlowTask, FlowError> {
        Self::refuse_foreign_fields(FlowItemType::FlowTask, &request)?;
        let task = sqlx::query_as::<_, FlowTaskRow>("SELECT * FROM flow_tasks WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut *self.connection)
            .await?
            .map(FlowTask::from)
            .ok_or(FlowError::NotFound(id))?;
        let title = request.title.unwrap_or(task.title);
        let moved = request
            .parent_type
            .as_ref()
            .is_some_and(|parent| *parent != task.parent_type);
        let parent_type = request.parent_type.unwrap_or(task.parent_type);
        let parent_id = request.parent_id.unwrap_or(task.parent_id);
        if moved {
            let instance_type = self.get(FlowId(task.flow_id)).await?.instance_type;
            rules::items::require_placement(FlowItemType::FlowTask, &parent_type, &instance_type)?;
        }
        let position = request.position.unwrap_or(task.position);
        let is_private = request.is_private.unwrap_or(task.is_private);
        sqlx::query(
            "UPDATE flow_tasks SET title=?, parent_type=?, parent_id=?, position=?, is_private=?
             WHERE id=?",
        )
        .bind(&title)
        .bind(&parent_type)
        .bind(parent_id)
        .bind(position)
        .bind(is_private)
        .bind(id)
        .execute(&mut *self.connection)
        .await?;
        sqlx::query_as::<_, FlowTaskRow>("SELECT * FROM flow_tasks WHERE id = ?")
            .bind(id)
            .fetch_one(&mut *self.connection)
            .await
            .map(FlowTask::from)
            .map_err(FlowError::from)
    }

    /// Moves, retitles or reorders one item of `kind`, refusing a parent the table does not
    /// allow — the part of an item update every kind shares.
    async fn update_item_place(
        &mut self,
        kind: FlowItemType,
        id: i64,
        request: &UpdateFlowItemRequest,
    ) -> Result<(), FlowError> {
        let table = kind.table();
        let (flow_id, title, parent_type, parent_id, position, is_private): (
            i64,
            String,
            String,
            i64,
            i64,
            bool,
        ) = sqlx::query_as(&format!(
            "SELECT flow_id, title, parent_type, parent_id, position, is_private
             FROM {table} WHERE id = ?"
        ))
        .bind(id)
        .fetch_optional(&mut *self.connection)
        .await?
        .ok_or(FlowError::NotFound(id))?;
        let moved = request
            .parent_type
            .as_ref()
            .is_some_and(|parent| *parent != parent_type);
        let parent_type = request.parent_type.clone().unwrap_or(parent_type);
        if moved {
            let instance_type = self.get(FlowId(flow_id)).await?.instance_type;
            rules::items::require_placement(kind, &parent_type, &instance_type)?;
        }
        sqlx::query(&format!(
            "UPDATE {table} SET title=?, parent_type=?, parent_id=?, position=?, is_private=?
             WHERE id=?"
        ))
        .bind(request.title.clone().unwrap_or(title))
        .bind(&parent_type)
        .bind(request.parent_id.unwrap_or(parent_id))
        .bind(request.position.unwrap_or(position))
        .bind(request.is_private.unwrap_or(is_private))
        .bind(id)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Refuses an item update naming a field its kind does not have, by name.
    fn refuse_foreign_fields(
        kind: FlowItemType,
        request: &UpdateFlowItemRequest,
    ) -> Result<(), FlowError> {
        if request.verdict_window.is_some() && kind != FlowItemType::FlowCommitment {
            return Err(FlowError::Invalid(
                "only a commitment item has a Verdict Window".to_string(),
            ));
        }
        let wait_fields = request.check_every.is_some() || request.first_check.is_some();
        if wait_fields && kind != FlowItemType::FlowExpectation {
            return Err(FlowError::Invalid(
                "only a wait item has a Check every and a first check".to_string(),
            ));
        }
        Ok(())
    }

    /// Updates a Commitment item: its place, title, privacy and Verdict Window.
    ///
    /// **Module-private**, for the reason [`Self::update_goal`] gives; [`update_flow_commitment`]
    /// is the entry point.
    async fn update_commitment_item(
        &mut self,
        id: i64,
        request: UpdateFlowItemRequest,
    ) -> Result<FlowCommitment, FlowError> {
        Self::refuse_foreign_fields(FlowItemType::FlowCommitment, &request)?;
        self.update_item_place(FlowItemType::FlowCommitment, id, &request)
            .await?;
        if let Some(window) = &request.verdict_window {
            let (n, kind) = duration_columns(window.as_ref());
            sqlx::query(
                "UPDATE flow_commitments SET verdict_window_n = ?, verdict_window_kind = ?
                 WHERE id = ?",
            )
            .bind(n)
            .bind(kind)
            .bind(id)
            .execute(&mut *self.connection)
            .await?;
        }
        self.commitment_item(id).await
    }

    /// Updates a wait item: its place, title, privacy, Check every and first check.
    ///
    /// **Module-private**, for the reason [`Self::update_goal`] gives; [`update_flow_expectation`]
    /// is the entry point.
    async fn update_expectation_item(
        &mut self,
        id: i64,
        request: UpdateFlowItemRequest,
    ) -> Result<FlowExpectation, FlowError> {
        Self::refuse_foreign_fields(FlowItemType::FlowExpectation, &request)?;
        self.update_item_place(FlowItemType::FlowExpectation, id, &request)
            .await?;
        if let Some(every) = &request.check_every {
            let (n, kind) = duration_columns(every.as_ref());
            sqlx::query(
                "UPDATE flow_expectations SET check_every_n = ?, check_every_kind = ? WHERE id = ?",
            )
            .bind(n)
            .bind(kind)
            .bind(id)
            .execute(&mut *self.connection)
            .await?;
        }
        if let Some(first) = &request.first_check {
            if let Some(first) = first {
                rules::items::require_first_check(first)?;
            }
            sqlx::query(
                "UPDATE flow_expectations SET first_check_kind = ?, first_check_index = ?
                 WHERE id = ?",
            )
            .bind(first.as_ref().map(|first| first.kind.clone()))
            .bind(first.as_ref().map(|first| first.index))
            .bind(id)
            .execute(&mut *self.connection)
            .await?;
        }
        self.expectation_item(id).await
    }

    /// Deletes a flow item and its cycles and dependency links.
    ///
    /// Three statements — the item's cycle pairs, its dependency edges, then the row — and so
    /// **not atomic on its own**. It opens no transaction: per ADR-0004 only the outermost caller
    /// decides the boundary, and a method that began its own could never join one. It reads
    /// nothing first, which is why it stays on the operator rather than becoming a free function.
    ///
    /// ```no_run
    /// # use arlesh_lib::database::session::SessionFactory;
    /// # use arlesh_lib::flows::{error::FlowError, model::FlowItemType};
    /// # async fn remove(factory: &SessionFactory) -> Result<(), FlowError> {
    /// let mut db = factory.begin().await?;
    /// db.flows().delete_item(FlowItemType::FlowTask, 1).await?;
    /// db.commit().await?;
    /// # Ok(())
    /// # }
    /// ```
    pub async fn delete_item(&mut self, item_type: FlowItemType, id: i64) -> Result<(), FlowError> {
        let table = item_type.table();
        self.clear_item_links(item_type, id).await?;
        self.templates()
            .forget(TemplateTable::of_item(item_type), id)
            .await?;
        // Its occurrences go with it, and so does everything recorded against them.
        OverlayOperator::new(&mut *self.connection)
            .clear_item(item_type.as_str(), id)
            .await?;
        sqlx::query(&format!("DELETE FROM {table} WHERE id = ?"))
            .bind(id)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Removes an item's cycle pairs and any dependency it participates in.
    async fn clear_item_links(
        &mut self,
        item_type: FlowItemType,
        id: i64,
    ) -> Result<(), FlowError> {
        sqlx::query("DELETE FROM flow_item_cycles WHERE item_type = ? AND item_id = ?")
            .bind(item_type.as_str())
            .bind(id)
            .execute(&mut *self.connection)
            .await?;
        sqlx::query(
            "DELETE FROM flow_dependencies
             WHERE (dependent_type = ?1 AND dependent_id = ?2)
                OR (depends_on_type = ?1 AND depends_on_id = ?2)",
        )
        .bind(item_type.as_str())
        .bind(id)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Makes a flow item's (Cycle Scope, Cycle Plan) pairs read `cycles`, **keeping the id of
    /// every pair that survives**.
    ///
    /// A pair's id is part of every occurrence's value key — its overlay, its relations and the
    /// nodes hung on it are all keyed on it — so replacing the pairs wholesale, as this used to,
    /// orphaned every one of them on any save of the item, a title-only one included. The pairs
    /// are diffed instead ([`cycles::diff_cycles`]): a pair whose Cycle Scope is still asked for
    /// keeps its row, updated in place only if its Cycle Plan or position moved; only pairs that
    /// really went are deleted and only new ones inserted. An unchanged set writes nothing.
    ///
    /// It reads the stored pairs first and writes from them, and opens no transaction — per
    /// ADR-0004 the outermost caller decides the boundary, and every caller runs inside one.
    pub async fn set_cycles(
        &mut self,
        flow_id: i64,
        item_type: FlowItemType,
        item_id: i64,
        cycles: &[FlowCycleInput],
    ) -> Result<(), FlowError> {
        let existing = self.item_cycles(item_type, item_id).await?;
        let diff = cycles::diff_cycles(&existing, cycles);
        for id in &diff.removed {
            sqlx::query("DELETE FROM flow_item_cycles WHERE id = ?")
                .bind(id)
                .execute(&mut *self.connection)
                .await?;
        }
        for kept in &diff.kept {
            let (Some(stored), Some(wanted)) = (
                existing.iter().find(|pair| pair.id == kept.id),
                cycles.get(kept.position),
            ) else {
                continue;
            };
            let position = i64::try_from(kept.position).unwrap_or(i64::MAX);
            let unchanged = stored.plan_kind == wanted.plan_kind
                && stored.plan_start == wanted.plan_start
                && stored.plan_end == wanted.plan_end
                && stored.position == position;
            if unchanged {
                continue;
            }
            sqlx::query(
                "UPDATE flow_item_cycles SET plan_kind = ?, plan_start = ?, plan_end = ?, position = ?
                 WHERE id = ?",
            )
            .bind(&wanted.plan_kind)
            .bind(wanted.plan_start)
            .bind(wanted.plan_end)
            .bind(position)
            .bind(kept.id)
            .execute(&mut *self.connection)
            .await?;
        }
        for position in &diff.added {
            let Some(cycle) = cycles.get(*position) else {
                continue;
            };
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
            .bind(i64::try_from(*position).unwrap_or(i64::MAX))
            .execute(&mut *self.connection)
            .await?;
        }
        Ok(())
    }

    /// One item's cycle pairs, in position order.
    pub async fn item_cycles(
        &mut self,
        item_type: FlowItemType,
        item_id: i64,
    ) -> Result<Vec<FlowItemCycle>, FlowError> {
        Ok(sqlx::query_as::<_, FlowItemCycleRow>(
            "SELECT * FROM flow_item_cycles WHERE item_type = ? AND item_id = ?
             ORDER BY position, id",
        )
        .bind(item_type.as_str())
        .bind(item_id)
        .fetch_all(&mut *self.connection)
        .await?
        .into_iter()
        .map(FlowItemCycle::from)
        .collect())
    }

    /// How many iterations hold something recorded against an occurrence of this item drawn by
    /// one of `cycle_ids`: an overlay, a relation, or a node hung on it.
    pub async fn iterations_keyed_on(
        &mut self,
        item_type: FlowItemType,
        item_id: i64,
        cycle_ids: &[i64],
    ) -> Result<i64, FlowError> {
        let mut iterations: std::collections::HashSet<ScopeKey> = std::collections::HashSet::new();
        let related: Vec<String> = sqlx::query_scalar(
            "SELECT parent_key FROM derived_children
             UNION SELECT node_key FROM derived_tags
             UNION SELECT node_key FROM derived_block_reasons
             UNION SELECT dependent_key FROM derived_dependencies WHERE dependent_key IS NOT NULL
             UNION SELECT target_key FROM derived_dependencies WHERE target_key IS NOT NULL
             UNION SELECT node_key FROM occurrence_async_templates
             UNION SELECT node_key FROM occurrence_spawned_waits
             UNION SELECT occurrence_key FROM expectation_overlays
                 WHERE occurrence_key IS NOT NULL",
        )
        .fetch_all(&mut *self.connection)
        .await?;
        for cycle in cycle_ids {
            let overlaid: Vec<DbScopeKey> = sqlx::query_scalar(
                "SELECT iteration_scope FROM task_overlays
                 WHERE item_type = ?1 AND item_id = ?2 AND cycle_id = ?3
                 UNION SELECT iteration_scope FROM goal_overlays
                 WHERE item_type = ?1 AND item_id = ?2 AND cycle_id = ?3
                 UNION SELECT iteration_scope FROM commitment_overlays
                 WHERE item_type = ?1 AND item_id = ?2 AND cycle_id = ?3",
            )
            .bind(item_type.as_str())
            .bind(item_id)
            .bind(cycle)
            .fetch_all(&mut *self.connection)
            .await?;
            iterations.extend(overlaid.into_iter().map(ScopeKey::from));
            for key in related.iter().filter_map(|key| OccurrenceKey::parse(key)) {
                if key.item.item_type.as_str() == item_type.as_str()
                    && key.item.item_id == item_id
                    && key.cycle == *cycle
                {
                    iterations.insert(key.iteration);
                }
            }
        }
        Ok(i64::try_from(iterations.len()).unwrap_or(i64::MAX))
    }

    /// Lists every flow's cycle pairs (for the mindmap load).
    pub async fn list_all_cycles(&mut self) -> Result<Vec<FlowItemCycle>, FlowError> {
        Ok(sqlx::query_as::<_, FlowItemCycleRow>(
            "SELECT * FROM flow_item_cycles ORDER BY item_type, item_id, position ASC",
        )
        .fetch_all(&mut *self.connection)
        .await?
        .into_iter()
        .map(FlowItemCycle::from)
        .collect())
    }

    /// Adds an intra-flow dependency (`dependent` waits on `depends_on`); a no-op if it exists.
    pub async fn add_dependency(
        &mut self,
        flow_id: i64,
        dependent_type: FlowItemType,
        dependent_id: i64,
        depends_on_type: FlowItemType,
        depends_on_id: i64,
    ) -> Result<(), FlowError> {
        if !rules::items::may_depend(dependent_type, depends_on_type) {
            return Err(FlowError::Invalid(
                "only a task item waits, and on a task, goal or wait item — never a commitment"
                    .to_string(),
            ));
        }
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
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Removes an intra-flow dependency.
    pub async fn remove_dependency(
        &mut self,
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
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Lists every flow's dependencies (for the mindmap load).
    pub async fn list_all_dependencies(&mut self) -> Result<Vec<FlowDependency>, FlowError> {
        Ok(
            sqlx::query_as::<_, FlowDependencyRow>("SELECT * FROM flow_dependencies")
                .fetch_all(&mut *self.connection)
                .await?
                .into_iter()
                .map(FlowDependency::from)
                .collect(),
        )
    }

    /// Records a materialised node against a flow instance. Each `(type, id)` pair identifies the
    /// real node, the flow item it came from, and the parent it was created under.
    async fn record_node(
        &mut self,
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
        .bind(instance_id)
        .bind(node.0)
        .bind(node.1)
        .bind(source.0)
        .bind(source.1)
        .bind(parent.0)
        .bind(parent.1)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Sets (creates or replaces) a flow's Recurrence, making it a Habit. A **Window** clock needs
    /// a scoped flow and a miss policy, and its Gap kind no finer than the habit scope; an
    /// **Interval** clock takes no miss policy, and its flow may be Unscoped. A commitment Habit's
    /// clock is fixed to Window + Owed.
    ///
    /// **Module-private.** It reads the stored row and writes values derived from it, so it is
    /// only correct inside a transaction — and an operator wraps a bare connection, which cannot
    /// demand one in its signature. [`set_flow_recurrence`] is the entry point; it takes
    /// `&mut Db<Transactional>` and is this method's only caller.
    async fn set_recurrence(
        &mut self,
        flow_id: FlowId,
        request: SetRecurrenceRequest,
    ) -> Result<FlowRecurrence, FlowError> {
        let flow = self.get(flow_id).await?;
        let habit_kind = flow.flow_duration_kind.as_deref();
        if request.clock == ClockKind::Window && habit_kind.is_none() {
            return Err(FlowError::Invalid(
                "a window habit requires a scoped flow — only an interval habit may be unscoped"
                    .to_string(),
            ));
        }
        if (request.clock == ClockKind::Window) != request.miss_policy.is_some() {
            return Err(FlowError::Invalid(
                "a miss policy is set exactly when the clock is window".to_string(),
            ));
        }
        check_cooldown(&flow, &request)?;

        match (request.gap_n, request.gap_kind.as_deref()) {
            (Some(n), Some(kind)) => {
                if n < 1 {
                    return Err(FlowError::Invalid("gap must be at least 1".to_string()));
                }
                let finer = match habit_kind {
                    Some(habit_kind) => scope_kind_rank(kind)? < scope_kind_rank(habit_kind)?,
                    None => scope_kind_rank(kind)? < scope_kind_rank("day")?,
                };
                if finer {
                    return Err(FlowError::Invalid(
                        "gap kind must be no finer than the habit scope".to_string(),
                    ));
                }
            }
            (None, None) => {}
            _ => {
                return Err(FlowError::Invalid(
                    "gap magnitude and kind must be set together".to_string(),
                ))
            }
        }

        // A commitment Habit's clock is fixed, and this is where that becomes true rather than
        // merely written down. Under Archive a past iteration classifies Lapsed, which is a derived
        // "this went unfinished" — a conclusion the kind forbids, since an unanswered commitment
        // may well have been kept. Under Overdue an unanswered night would be folded into the
        // next, and an Interval has nothing to complete. Window + Owed is the only shape that
        // leaves an unanswered iteration alone, and the Verdict Window is what bounds it instead.
        if flow.instance_type == "commitment"
            && request.clock == ClockKind::Window
            && request.miss_policy != Some(MissPolicy::Owed)
        {
            return Err(FlowError::Invalid(
                "a commitment habit's clock is window + owed or interval".to_string(),
            ));
        }

        sqlx::query(
            "INSERT INTO flow_recurrences
                (flow_id, start_scope_id, gap_n, gap_kind, end_scope_id, clock, miss_policy,
                 cooldown_n, cooldown_kind)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(flow_id) DO UPDATE SET
                start_scope_id = excluded.start_scope_id, gap_n = excluded.gap_n,
                gap_kind = excluded.gap_kind, end_scope_id = excluded.end_scope_id,
                clock = excluded.clock, miss_policy = excluded.miss_policy,
                cooldown_n = excluded.cooldown_n, cooldown_kind = excluded.cooldown_kind",
        )
        .bind(flow_id.0)
        .bind(DbScopeKey(request.start_scope_id))
        .bind(request.gap_n)
        .bind(&request.gap_kind)
        .bind(request.end_scope_id.map(DbScopeKey))
        .bind(request.clock.as_str())
        .bind(request.miss_policy.map(|policy| policy.as_str()))
        .bind(request.cooldown_n)
        .bind(&request.cooldown_kind)
        .execute(&mut *self.connection)
        .await?;

        self.get_recurrence(flow_id)
            .await?
            .ok_or(FlowError::NotFound(flow_id.0))
    }

    /// Fetches a flow's Recurrence, or `None` if the flow is a plain (non-habit) flow.
    pub async fn get_recurrence(
        &mut self,
        flow_id: FlowId,
    ) -> Result<Option<FlowRecurrence>, FlowError> {
        let recurrence = sqlx::query_as::<_, FlowRecurrenceRow>(
            "SELECT flow_id, start_scope_id, gap_n, gap_kind, end_scope_id, clock, miss_policy,
                    cooldown_n, cooldown_kind
             FROM flow_recurrences WHERE flow_id = ?",
        )
        .bind(flow_id.0)
        .fetch_optional(&mut *self.connection)
        .await?;
        Ok(recurrence.map(FlowRecurrence::from))
    }

    /// Moves a Habit's Recurrence end to `end_scope_id`, leaving the rest of the Recurrence as it
    /// was. [`archive_and_fork`] is its only caller.
    async fn set_recurrence_end(
        &mut self,
        flow_id: FlowId,
        end_scope_id: ScopeKey,
    ) -> Result<(), FlowError> {
        sqlx::query("UPDATE flow_recurrences SET end_scope_id = ? WHERE flow_id = ?")
            .bind(DbScopeKey(end_scope_id))
            .bind(flow_id.0)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Deletes a flow's Recurrence, demoting the Habit back to a plain flow.
    pub async fn delete_recurrence(&mut self, flow_id: FlowId) -> Result<(), FlowError> {
        sqlx::query("DELETE FROM flow_recurrences WHERE flow_id = ?")
            .bind(flow_id.0)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// The value key a scope-anchored instance reference names: the template item, the
    /// iteration's scope key and the cycle pair, which is what an overlay row is keyed by.
    pub async fn occurrence_key(
        &mut self,
        instance: &HabitInstanceRef,
    ) -> Result<OccurrenceKey, FlowError> {
        let item_type = TemplateKind::from_db(&instance.item_type).ok_or_else(|| {
            FlowError::Invalid(format!("unknown instance type {}", instance.item_type))
        })?;
        Ok(OccurrenceKey {
            item: nodes::key::TemplateItem {
                item_type,
                item_id: instance.item_id,
            },
            iteration: instance.iteration_scope_id,
            cycle: instance.cycle_id,
        })
    }

    /// What an occurrence of `item` renders as: a flow goal's is a Goal, a flow task's a Task, and
    /// the root's whatever the flow's Instance Type says.
    pub async fn occurrence_kind(
        &mut self,
        flow_id: FlowId,
        item: TemplateKind,
    ) -> Result<&'static str, FlowError> {
        Ok(match item {
            TemplateKind::FlowGoal => "goal",
            TemplateKind::FlowTask => "task",
            TemplateKind::FlowCommitment => "commitment",
            TemplateKind::FlowExpectation => "expectation",
            TemplateKind::FlowRoot => match self.get(flow_id).await?.instance_type.as_str() {
                "goal" => "goal",
                "commitment" => "commitment",
                _ => "task",
            },
        })
    }

    /// Writes one occurrence's **status** into its kind's overlay, leaving every other overlay
    /// column alone. `None` clears it back to the kind's default.
    ///
    /// The status arrives in whichever vocabulary its caller speaks and lands in the kind's own:
    /// a Goal's `done` is `achieved`; a Commitment keeps only a `kept`/`broken` verdict, and
    /// anything else clears it (a stale `done` is not a verdict). Completing records
    /// `resolved_at_ms`, which an Interval clock places its next instance by, and any status write lifts a tombstone —
    /// marking an archived occurrence done brings it back.
    pub async fn set_occurrence_status(
        &mut self,
        flow_id: FlowId,
        key: &OccurrenceKey,
        status: Option<&str>,
        resolved_at_ms: i64,
    ) -> Result<(), FlowError> {
        let kind = self.occurrence_kind(flow_id, key.item.item_type).await?;
        let mut overlays = OverlayOperator::new(&mut *self.connection);
        match kind {
            "goal" => {
                let mut overlay = overlays.goal(key).await?;
                overlay.status = match status {
                    Some("done" | "achieved") => Some("achieved".to_string()),
                    Some(other @ ("frozen" | "archived")) => Some(other.to_string()),
                    _ => None,
                };
                overlay.resolved_at =
                    (overlay.status.as_deref() == Some("achieved")).then_some(resolved_at_ms);
                overlay.tombstone = None;
                overlays.put_goal(flow_id.0, key, &overlay).await?;
            }
            "commitment" => {
                let mut overlay = overlays.commitment(key).await?;
                overlay.verdict = match status {
                    Some(verdict @ ("kept" | "broken")) => Some(verdict.to_string()),
                    _ => None,
                };
                overlay.resolved_at = overlay.verdict.as_ref().map(|_| resolved_at_ms);
                overlay.tombstone = None;
                overlays.put_commitment(flow_id.0, key, &overlay).await?;
            }
            "expectation" => {
                // A wait is settled by being released; `done` says the same of a wait.
                let node_key = key.node_key();
                let mut overlay = overlays.expectation(&node_key).await?;
                let released = matches!(status, Some("released" | "done"));
                overlay.status = released.then(|| "released".to_string());
                overlay.released_at = released.then(|| {
                    let at = chrono::DateTime::from_timestamp_millis(resolved_at_ms)
                        .map_or_else(|| chrono::NaiveDateTime::MIN, |at| at.naive_utc());
                    crate::tasks::waits::instant_column(at)
                });
                if overlay.archival.as_deref() == Some("archived") {
                    overlay.archival = None;
                }
                let home = crate::nodes::wait_overlay::WaitHome {
                    flow_id: Some(flow_id.0),
                    occurrence_key: Some(node_key.clone()),
                };
                overlays.put_expectation(&node_key, &home, &overlay).await?;
            }
            _ => {
                let mut overlay = overlays.task(key).await?;
                // Either model's spelling is kept as given, a To Do cleared: which model the
                // occurrence holds is settled by `tasks::agentic::reconcile` afterwards.
                let given = status
                    .and_then(Status::from_db)
                    .filter(|given| !given.is_todo());
                overlay.status = given.and_then(|given| given.as_db()).map(str::to_string);
                overlay.resolved_at = given
                    .is_some_and(|given| given.is_done())
                    .then_some(resolved_at_ms);
                overlay.tombstone = None;
                overlays.put_task(flow_id.0, key, &overlay).await?;
            }
        }
        Ok(())
    }

    /// Resolves (or un-resolves) a whole Habit iteration: marks **every** instance at that
    /// iteration done — the flow root plus every occurrence of every flow item — or clears the
    /// completions it holds. `resolved_at_ms` is the completion instant recorded on each, so
    /// an Interval Habit's next instance falls where it did. Individual instances are moved with
    /// [`Self::set_item_status`].
    ///
    /// **Module-private.** It reads each overlay and writes values derived from it, so it is only
    /// correct inside a transaction. [`set_iteration_done`] is the entry point.
    async fn set_iteration_done(
        &mut self,
        flow_id: FlowId,
        iteration_scope_id: ScopeKey,
        done: bool,
        resolved_at_ms: i64,
    ) -> Result<(), FlowError> {
        for (item_type, item_id, cycle_id) in self.iteration_instance_keys(flow_id).await? {
            let key = self
                .occurrence_key(&HabitInstanceRef {
                    item_type,
                    item_id,
                    iteration_scope_id,
                    cycle_id,
                })
                .await?;
            // A Commitment item's verdict is the user's to give: resolving an iteration in one
            // step records no answer on its behalf.
            if key.item.item_type == TemplateKind::FlowCommitment {
                continue;
            }
            if done {
                self.set_occurrence_status(flow_id, &key, Some("done"), resolved_at_ms)
                    .await?;
                continue;
            }
            // Un-resolving clears completions only: an occurrence merely in progress, or one
            // archived by hand, is left as it was.
            let completed = match self.occurrence_kind(flow_id, key.item.item_type).await? {
                "goal" => {
                    let overlay = OverlayOperator::new(&mut *self.connection)
                        .goal(&key)
                        .await?;
                    overlay.tombstone.is_none() && overlay.status.as_deref() == Some("achieved")
                }
                // A verdict is the user's answer, never a completion to take back; a wait item's
                // release is taken back as a completion is.
                "commitment" => false,
                "expectation" => {
                    let overlay = OverlayOperator::new(&mut *self.connection)
                        .expectation(&key.node_key())
                        .await?;
                    overlay.status.as_deref() == Some("released")
                }
                _ => {
                    let overlay = OverlayOperator::new(&mut *self.connection)
                        .task(&key)
                        .await?;
                    overlay.tombstone.is_none()
                        && overlay
                            .status
                            .as_deref()
                            .and_then(Status::from_db)
                            .is_some_and(|status| status.is_done())
                }
            };
            if completed {
                self.set_occurrence_status(flow_id, &key, None, resolved_at_ms)
                    .await?;
            }
        }
        Ok(())
    }

    /// Every instance one iteration of this Habit holds, as `(item_type, item_id, cycle_id)`: the
    /// flow root, then each item once per cycle pair it declares (once with [`NO_CYCLE`] when it
    /// declares none).
    ///
    /// This is the same count SPEC means by "an iteration is resolved when every one of its
    /// instances is done" — and since a flow item with N pairs draws N nodes, N of them.
    async fn iteration_instance_keys(
        &mut self,
        flow_id: FlowId,
    ) -> Result<Vec<(String, i64, i64)>, FlowError> {
        let items = self.instance_items(flow_id).await?;
        let cycles = self.cycles_by_item(flow_id).await?;
        let mut keys = vec![(ROOT_INSTANCE_TYPE.to_string(), flow_id.0, NO_CYCLE)];
        for (item_type, item_id) in items {
            match cycles.get(&(item_type.clone(), item_id)) {
                Some(pairs) if !pairs.is_empty() => keys.extend(
                    pairs
                        .iter()
                        .map(|pair| (item_type.clone(), item_id, pair.id)),
                ),
                _ => keys.push((item_type, item_id, NO_CYCLE)),
            }
        }
        Ok(keys)
    }

    /// Every occurrence of this Habit with a recorded (non-tombstoned) status, and the iteration
    /// scope it applies to — occurrences with none sit at their kind's default.
    ///
    /// Statuses read in the vocabulary Modifications always spoke: a Goal occurrence's
    /// `achieved` reads `done`, and a Commitment's verdict reads as itself.
    pub async fn list_item_statuses(
        &mut self,
        flow_id: FlowId,
    ) -> Result<Vec<HabitItemStatus>, FlowError> {
        Ok(sqlx::query_as::<_, HabitItemStatusRow>(
            "SELECT item_type, item_id, iteration_scope AS iteration_scope_id, cycle_id, status
             FROM task_overlays
             WHERE flow_id = ?1 AND status IS NOT NULL AND tombstone IS NULL
             UNION ALL
             SELECT item_type, item_id, iteration_scope, cycle_id,
                    CASE status WHEN 'achieved' THEN 'done' ELSE status END FROM goal_overlays
             WHERE flow_id = ?1 AND status IS NOT NULL AND tombstone IS NULL
             UNION ALL
             SELECT item_type, item_id, iteration_scope, cycle_id, verdict FROM commitment_overlays
             WHERE flow_id = ?1 AND verdict IS NOT NULL AND tombstone IS NULL",
        )
        .bind(flow_id.0)
        .fetch_all(&mut *self.connection)
        .await?
        .into_iter()
        .map(HabitItemStatus::from)
        .collect())
    }

    /// Sets a **single** instance's status at one iteration scope. `status` `None` clears it (back
    /// to the base status); `Some(s)` records it (e.g. `in_progress`, `done`). `resolved_at_ms` is
    /// recorded only for a completion (the instant an Interval clock places its next instance by).
    /// Unlike `set_iteration_done` (every instance at once), this toggles one — so a Habit
    /// iteration can be advanced instance by instance.
    ///
    /// `instance` names the occurrence down to its cycle pair, because an item with several pairs
    /// draws one node per pair in the same iteration: completing the morning one leaves the
    /// evening one to do. [`NO_CYCLE`] is the occurrence of an item that declares no pairs, and
    /// the flow root's.
    pub async fn set_item_status(
        &mut self,
        flow_id: FlowId,
        instance: &HabitInstanceRef,
        status: Option<&str>,
        resolved_at_ms: i64,
    ) -> Result<(), FlowError> {
        let key = self.occurrence_key(instance).await?;
        self.set_occurrence_status(flow_id, &key, status, resolved_at_ms)
            .await
    }

    /// Number of **divergent** iterations of a Habit — the probe the edit-habit reconciliation
    /// prompt fires on.
    ///
    /// An iteration diverges when anything was recorded against it: an overlay on any of its
    /// occurrences (a completion, an edit, an archive) or a node hung on one of them. All of it is
    /// work the user did against that iteration specifically, and delete-and-regenerate destroys
    /// it, so all of it has to raise the prompt that says so. Counted over the union of iteration
    /// scopes, so an iteration that is completed *and* carries an added child counts once.
    pub async fn habit_completion_count(&mut self, flow_id: FlowId) -> Result<i64, FlowError> {
        let mut iterations: std::collections::HashSet<ScopeKey> =
            OverlayOperator::new(&mut *self.connection)
                .touched_iterations(flow_id.0)
                .await?
                .into_iter()
                .collect();
        for key in self.related_keys(flow_id).await? {
            if let Some(key) = OccurrenceKey::parse(&key) {
                iterations.insert(key.iteration);
            }
        }
        Ok(i64::try_from(iterations.len()).unwrap_or(i64::MAX))
    }

    /// Clears everything recorded against a Habit's occurrences — overlays, relations and the
    /// nodes hung on them — the delete-and-regenerate arm of edit-habit reconciliation.
    ///
    /// The added children go with it, rows and attachments alike: the occurrences they hung off
    /// are about to stop existing, and a child left behind would be a node attached to an
    /// occurrence no longer generated. The prompt this arm sits behind is what keeps that from
    /// being a surprise.
    pub async fn clear_habit_modifications(&mut self, flow_id: FlowId) -> Result<(), FlowError> {
        self.delete_instance_children(flow_id).await?;
        OverlayOperator::new(&mut *self.connection)
            .clear_habit(flow_id.0)
            .await?;
        Ok(())
    }

    /// One cycle pair by id, or `None` when the id names none — including [`NO_CYCLE`], the
    /// sentinel an occurrence with no pair of its own carries.
    pub async fn cycle(&mut self, cycle_id: i64) -> Result<Option<FlowItemCycle>, FlowError> {
        Ok(
            sqlx::query_as::<_, FlowItemCycleRow>("SELECT * FROM flow_item_cycles WHERE id = ?")
                .bind(cycle_id)
                .fetch_optional(&mut *self.connection)
                .await?
                .map(FlowItemCycle::from),
        )
    }

    /// The Habit an occurrence belongs to: the root's key names the flow itself, an item's names
    /// the item, whose row says which flow owns it.
    pub async fn occurrence_flow_id(&mut self, key: &OccurrenceKey) -> Result<FlowId, FlowError> {
        let kind = match key.item.item_type {
            TemplateKind::FlowRoot => return Ok(FlowId(key.item.item_id)),
            TemplateKind::FlowGoal => FlowItemType::FlowGoal,
            TemplateKind::FlowTask => FlowItemType::FlowTask,
            TemplateKind::FlowCommitment => FlowItemType::FlowCommitment,
            TemplateKind::FlowExpectation => FlowItemType::FlowExpectation,
        };
        Ok(FlowId(self.item_flow_id(kind, key.item.item_id).await?))
    }

    /// The occurrences of one Habit that carry a relation of their own — a node hung on them, a
    /// tag, a block-reason list or a dependency — by canonical key.
    pub async fn related_keys(&mut self, flow_id: FlowId) -> Result<Vec<String>, FlowError> {
        Ok(sqlx::query_scalar(
            "SELECT parent_key FROM derived_children WHERE flow_id = ?1
             UNION SELECT node_key FROM derived_tags WHERE flow_id = ?1
             UNION SELECT node_key FROM derived_block_reasons WHERE flow_id = ?1
             UNION SELECT dependent_key FROM derived_dependencies
                 WHERE flow_id = ?1 AND dependent_key IS NOT NULL
             UNION SELECT target_key FROM derived_dependencies
                 WHERE flow_id = ?1 AND target_key IS NOT NULL",
        )
        .bind(flow_id.0)
        .fetch_all(&mut *self.connection)
        .await?)
    }

    /// Every added child of every occurrence of one Habit.
    pub async fn list_instance_children(
        &mut self,
        flow_id: FlowId,
    ) -> Result<Vec<HabitInstanceChild>, FlowError> {
        Ok(sqlx::query_as::<_, HabitInstanceChildRow>(
            "SELECT flow_id, parent_kind, parent_key, child_type, child_id
             FROM derived_children WHERE flow_id = ? ORDER BY id",
        )
        .bind(flow_id.0)
        .fetch_all(&mut *self.connection)
        .await?
        .into_iter()
        .map(HabitInstanceChild::from)
        .collect())
    }

    /// Every stored node hung on a derived one, across the board.
    pub async fn list_all_instance_children(
        &mut self,
    ) -> Result<Vec<HabitInstanceChild>, FlowError> {
        Ok(sqlx::query_as::<_, HabitInstanceChildRow>(
            "SELECT flow_id, parent_kind, parent_key, child_type, child_id
             FROM derived_children ORDER BY id",
        )
        .fetch_all(&mut *self.connection)
        .await?
        .into_iter()
        .map(HabitInstanceChild::from)
        .collect())
    }

    /// The occurrence one node is attached to, if it is an added child of one.
    ///
    /// The window comes back resolved, as the Time Scope the attachment settled at attach time,
    /// together with the kind the occurrence renders as. That is everything the ancestry climb
    /// needs to treat the occurrence as the node's parent without resolving a Flow Window on
    /// every step of every climb.
    ///
    /// Fails as a bare [`sqlx::Error`] rather than a [`FlowError`], because its caller is the
    /// ancestry climb in `tasks` — a `FlowError` there would need `TaskError` to wrap the very
    /// enum that already wraps it.
    pub async fn child_attachment(
        &mut self,
        child_type: &str,
        child_id: i64,
    ) -> Result<Option<ChildAttachment>, sqlx::Error> {
        let row: Option<AttachmentRow> = sqlx::query_as(
            "SELECT flow_id, parent_kind, parent_key, window_start_scope_id, window_end_scope_id
             FROM derived_children WHERE child_type = ? AND child_id = ?",
        )
        .bind(child_type)
        .bind(child_id)
        .fetch_optional(&mut *self.connection)
        .await?;
        Ok(row.map(AttachmentRow::attachment))
    }

    /// Every added child's attachment, with the child it attaches — what
    /// [`Self::child_attachment`] reads one child at a time, for a whole board.
    pub async fn child_attachments(
        &mut self,
    ) -> Result<Vec<(String, i64, ChildAttachment)>, sqlx::Error> {
        let rows: Vec<ChildAttachmentRow> = sqlx::query_as(
            "SELECT child_type, child_id, flow_id, parent_kind, parent_key, window_start_scope_id,
                    window_end_scope_id
             FROM derived_children",
        )
        .fetch_all(&mut *self.connection)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| (row.child_type, row.child_id, row.attachment.attachment()))
            .collect())
    }

    /// Attaches an already-created row to one occurrence. `window` is the occurrence's, resolved
    /// by the caller inside the same transaction.
    ///
    /// **Crate-private**: the row and its attachment are one gesture, and a row written without
    /// its attachment is a node loose on the board.
    pub(crate) async fn attach_instance_child(
        &mut self,
        flow_id: FlowId,
        parent_kind: &str,
        parent: &OccurrenceKey,
        window: Option<&TimeScope>,
        child_type: &str,
        child_id: i64,
    ) -> Result<(), FlowError> {
        sqlx::query(
            "INSERT INTO derived_children
                (flow_id, parent_kind, parent_key, window_start_scope_id, window_end_scope_id,
                 child_type, child_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(flow_id.0)
        .bind(parent_kind)
        .bind(parent.node_key())
        .bind(window.map(|window| DbScopeKey(window.start_id)))
        .bind(window.map(|window| DbScopeKey(window.end_id)))
        .bind(child_type)
        .bind(child_id)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Forgets that a node was an occurrence's child, without touching the node.
    ///
    /// Called when the node itself is deleted, or moved to a parent of its own. SQLite recycles
    /// rowids, so an attachment left pointing at a deleted row is not merely litter — a later node
    /// minted with the same id would inherit it, and appear under an occurrence nobody put it on.
    pub async fn detach_instance_child(
        &mut self,
        child_type: &str,
        child_id: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM derived_children WHERE child_type = ? AND child_id = ?")
            .bind(child_type)
            .bind(child_id)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Deletes every added child of a Habit — the child rows themselves and their attachments.
    ///
    /// Private: it destroys real nodes, so it is reachable only through
    /// [`Self::clear_habit_modifications`], which is the arm of the reconciliation prompt that
    /// says out loud that it will.
    async fn delete_instance_children(&mut self, flow_id: FlowId) -> Result<(), FlowError> {
        for kind in model::CHILD_KINDS {
            let table = match kind {
                "task" => "tasks",
                "goal" => "goals",
                "commitment" => "commitments",
                "expectation" => "expectations",
                _ => "infos",
            };
            // The table name is one of five literals chosen here, never caller text.
            sqlx::query(&format!(
                "DELETE FROM {table} WHERE id IN (
                     SELECT child_id FROM derived_children
                     WHERE flow_id = ? AND child_type = ?
                 )"
            ))
            .bind(flow_id.0)
            .bind(kind)
            .execute(&mut *self.connection)
            .await?;
        }
        sqlx::query("DELETE FROM derived_children WHERE flow_id = ?")
            .bind(flow_id.0)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Deep-clones a flow's **template** — the flow row, its items, cycle pairs, and intra-flow
    /// dependencies (remapped to the clone) — into a brand-new flow, landing it per `placement`.
    ///
    /// The template and **only** the template. The Recurrence, the privacy flag, the completion
    /// Modifications and the started instances are all left behind, and each caller adds back
    /// whatever its own operation means to carry: [`fork_flow`] adds nothing (the habit editor's
    /// archive-and-new is *about* dropping the schedule), [`duplicate_flow`] adds the Recurrence
    /// and the privacy flag. Keeping those out of here is what lets the two callers differ without
    /// a policy flag deciding it from the inside.
    ///
    /// **Module-private.** It reads the stored row and writes values derived from it, so it is
    /// only correct inside a transaction — and an operator wraps a bare connection, which cannot
    /// demand one in its signature. [`fork_flow`] and [`duplicate_flow`] are the entry points;
    /// they take `&mut Db<Transactional>`.
    async fn clone_template(
        &mut self,
        flow_id: FlowId,
        placement: Option<ClonePlacement>,
    ) -> Result<TemplateClone, FlowError> {
        let flow = self.get(flow_id).await?;
        // A fork stands in for the flow it was forked from, so with no placement the clone keeps
        // the original's parent and takes the head of the list. A paste names both.
        let (parent_type, parent_id, position) = match placement {
            Some(landing) => (landing.parent_type, landing.parent_id, landing.position),
            None => (flow.parent_type.clone(), flow.parent_id, now_position()),
        };
        let new_id = sqlx::query(
            "INSERT INTO flows
                (title, instance_type, parent_type, parent_id, target_type, target_id,
                 flow_duration_n, flow_duration_kind,
                 flow_window_part, flow_window_time_start, flow_window_time_end,
                 root_plan_kind, root_plan_start, root_plan_end,
                 verdict_window_n, verdict_window_kind, position)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&flow.title)
        .bind(&flow.instance_type)
        .bind(&parent_type)
        .bind(parent_id)
        // The Target Node is bound **as stored**, NULL included. A NULL target means "my parent"
        // and is resolved on read (migration 0025), so a clone of a flow that never named a target
        // resolves to wherever *it* was put — and a clone of one that did keeps pointing there.
        // Resolving the target here would pin every copy to the original's parent for ever.
        .bind(&flow.target_type)
        .bind(flow.target_id)
        .bind(flow.flow_duration_n)
        .bind(&flow.flow_duration_kind)
        .bind(&flow.flow_window_part)
        .bind(&flow.flow_window_time_start)
        .bind(&flow.flow_window_time_end)
        .bind(&flow.root_plan_kind)
        .bind(flow.root_plan_start)
        .bind(flow.root_plan_end)
        .bind(flow.verdict_window_n)
        .bind(&flow.verdict_window_kind)
        .bind(position)
        .execute(&mut *self.connection)
        .await?
        .last_insert_rowid();

        // Pass 1: clone every item under the new flow (temporary parent), recording old->new ids.
        let mut placed: Vec<(FlowItemType, i64, String, i64)> = Vec::new();
        let mut items: HashMap<(FlowItemType, i64), i64> = HashMap::new();
        for kind in FlowItemType::ALL {
            let table = kind.table();
            let rows: Vec<(i64, String, i64)> = sqlx::query_as(&format!(
                "SELECT id, parent_type, parent_id FROM {table} WHERE flow_id = ? ORDER BY position"
            ))
            .bind(flow_id.0)
            .fetch_all(&mut *self.connection)
            .await?;
            for (id, parent_type, parent_id) in rows {
                let clone = self
                    .clone_item_row(
                        kind,
                        id,
                        ItemLanding {
                            flow_id: Some(new_id),
                            parent: ("flow", new_id),
                            position: None,
                            privacy: false,
                        },
                    )
                    .await?;
                items.insert((kind, id), clone);
                placed.push((kind, id, parent_type, parent_id));
            }
        }
        // Item-id remap for parent/cycle/dependency references.
        let map_item = |item_type: &str, item_id: i64| -> Result<i64, FlowError> {
            FlowItemType::from_db(item_type)
                .and_then(|kind| items.get(&(kind, item_id)).copied())
                .ok_or_else(|| {
                    FlowError::Invalid("dangling flow-item reference in fork".to_string())
                })
        };
        // Pass 2: repoint each clone's parent now that all new ids exist.
        for (kind, id, parent_type, parent_id) in &placed {
            let (pt, pid) = match parent_type.as_str() {
                "flow" => ("flow".to_string(), new_id),
                other => (other.to_string(), map_item(other, *parent_id)?),
            };
            let table = kind.table();
            sqlx::query(&format!(
                "UPDATE {table} SET parent_type = ?, parent_id = ? WHERE id = ?"
            ))
            .bind(&pt)
            .bind(pid)
            .bind(map_item(kind.as_str(), *id)?)
            .execute(&mut *self.connection)
            .await?;
        }
        // Clone cycle pairs and dependencies, remapped to the new items. Each pair is a new row
        // with a new id, and a Habit occurrence's completion is keyed on its pair id (migration
        // 0029) — so the clone's occurrences cannot inherit the original's ticks by construction,
        // whatever a caller does about history.
        for c in self
            .list_all_cycles()
            .await?
            .iter()
            .filter(|c| c.flow_id == flow_id.0)
        {
            sqlx::query(
                "INSERT INTO flow_item_cycles
                    (flow_id, item_type, item_id, scope_kind, scope_index, plan_kind, plan_start, plan_end, position)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(new_id).bind(&c.item_type).bind(map_item(&c.item_type, c.item_id)?)
            .bind(&c.scope_kind).bind(c.scope_index).bind(&c.plan_kind).bind(c.plan_start).bind(c.plan_end).bind(c.position)
            .execute(&mut *self.connection).await?;
        }
        for d in self
            .list_all_dependencies()
            .await?
            .iter()
            .filter(|d| d.flow_id == flow_id.0)
        {
            sqlx::query(
                "INSERT INTO flow_dependencies (flow_id, dependent_type, dependent_id, depends_on_type, depends_on_id) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(new_id).bind(&d.dependent_type).bind(map_item(&d.dependent_type, d.dependent_id)?)
            .bind(&d.depends_on_type).bind(map_item(&d.depends_on_type, d.depends_on_id)?)
            .execute(&mut *self.connection).await?;
        }
        // What each template says about its occurrences travels with it, as its title does.
        self.templates()
            .copy(TemplateTable::Flow, flow_id.0, new_id)
            .await?;
        for ((kind, old), new) in &items {
            self.templates()
                .copy(TemplateTable::of_item(*kind), *old, *new)
                .await?;
        }
        let cloned = self.get(FlowId(new_id)).await?;
        Ok(TemplateClone {
            flow: cloned,
            items,
        })
    }

    /// Deep-clones a flow's template in place, dropping its Recurrence — the edit-habit
    /// "archive & new" reconciliation, which applies the edited schedule to the clone and leaves
    /// the original habit (and its history) untouched.
    ///
    /// **Module-private**, for the reason [`Self::clone_template`] gives; [`fork_flow`] is the
    /// entry point and this method's only caller.
    async fn fork_flow(&mut self, flow_id: FlowId) -> Result<Flow, FlowError> {
        Ok(self.clone_template(flow_id, None).await?.flow)
    }

    /// Copies one template item's privacy flag onto its clone.
    ///
    /// [`Self::clone_template`] writes the bare template and leaves privacy to its callers, and a
    /// Flow *copy* must not quietly publish a private template — see [`duplicate_flow`]. One
    /// statement per item rather than a read and a write, so the flag is never in Rust's hands.
    async fn copy_item_privacy(
        &mut self,
        item_type: FlowItemType,
        from: i64,
        to: i64,
    ) -> Result<(), FlowError> {
        let table = item_type.table();
        sqlx::query(&format!(
            "UPDATE {table} SET is_private = (SELECT is_private FROM {table} WHERE id = ?)
             WHERE id = ?"
        ))
        .bind(from)
        .bind(to)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Copies a flow's Recurrence onto another flow, leaving `to` a plain flow when `from` is one.
    ///
    /// A straight row copy rather than a [`Self::set_recurrence`] call: the source row already
    /// satisfies every Gap and clock rule that validation exists to enforce, including a
    /// commitment Habit's fixed Window + Owed, so re-deriving a request from it only
    /// adds a way for the two spellings to disagree.
    async fn copy_recurrence(&mut self, from: FlowId, to: FlowId) -> Result<(), FlowError> {
        sqlx::query(
            "INSERT INTO flow_recurrences
                (flow_id, start_scope_id, gap_n, gap_kind, end_scope_id, clock, miss_policy,
                 cooldown_n, cooldown_kind)
             SELECT ?, start_scope_id, gap_n, gap_kind, end_scope_id, clock, miss_policy,
                    cooldown_n, cooldown_kind
             FROM flow_recurrences WHERE flow_id = ?",
        )
        .bind(to.0)
        .bind(from.0)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// The flow a template item belongs to, or [`FlowError::NotFound`] if there is no such item.
    pub async fn item_flow_id(
        &mut self,
        item_type: FlowItemType,
        item_id: i64,
    ) -> Result<i64, FlowError> {
        let table = item_type.table();
        sqlx::query_scalar::<_, i64>(&format!("SELECT flow_id FROM {table} WHERE id = ?"))
            .bind(item_id)
            .fetch_optional(&mut *self.connection)
            .await?
            .ok_or(FlowError::NotFound(item_id))
    }

    /// Deep-clones one template item and everything nested under it, landing the copy on
    /// `(parent_type, parent_id)` at `position` — **within the same flow**, which the caller has
    /// already established. Returns the new root item's id.
    ///
    /// Cycle pairs travel with each copied item, because a Cycle Scope is an offset into the flow
    /// window and the window is the same one. Dependency edges *out of* the copied set are copied
    /// as they stand; an edge between two copied items is remapped onto the copies, so a copied
    /// block waits on itself rather than reaching back into the original. That is the same rule
    /// [`Self::clone_template`] applies, and the opposite of `duplicate::duplicate_subtree`'s for
    /// real nodes — a flow's dependencies are its own internal wiring, and a copy of the wiring
    /// that points at the original is a copy of nothing.
    ///
    /// **Module-private**, for the reason [`Self::clone_template`] gives; [`duplicate_flow_item`]
    /// is the entry point.
    async fn clone_item_subtree(
        &mut self,
        item_type: FlowItemType,
        item_id: i64,
        parent_type: &str,
        parent_id: i64,
        position: i64,
    ) -> Result<i64, FlowError> {
        let flow_id = self.item_flow_id(item_type, item_id).await?;
        let new_root = self
            .clone_item_row(
                item_type,
                item_id,
                ItemLanding {
                    flow_id: None,
                    parent: (parent_type, parent_id),
                    position: Some(position),
                    privacy: true,
                },
            )
            .await?;

        // Breadth-first, like `duplicate::duplicate_subtree`: a child is cloned only once its own
        // parent's new id exists, so every copy is attached from the start rather than repointed.
        let mut copied: Vec<(FlowItemType, i64, i64)> = vec![(item_type, item_id, new_root)];
        let mut queue: VecDeque<(FlowItemType, i64, i64)> = VecDeque::new();
        queue.push_back((item_type, item_id, new_root));
        while let Some((kind, old_id, new_id)) = queue.pop_front() {
            for (child_kind, child_id) in self.item_children(kind, old_id).await? {
                let new_child = self
                    .clone_item_row(
                        child_kind,
                        child_id,
                        ItemLanding {
                            flow_id: None,
                            parent: (kind.as_str(), new_id),
                            position: None,
                            privacy: true,
                        },
                    )
                    .await?;
                copied.push((child_kind, child_id, new_child));
                queue.push_back((child_kind, child_id, new_child));
            }
        }

        // Cycles and dependencies only once every copy exists, so an edge inside the copied set
        // has a copy on both ends to be remapped onto.
        let items = item_id_maps(&copied);
        for (kind, old_id, new_id) in &copied {
            self.templates()
                .copy(TemplateTable::of_item(*kind), *old_id, *new_id)
                .await?;
            self.copy_item_cycles(flow_id, *kind, *old_id, *new_id)
                .await?;
            self.copy_item_dependencies(flow_id, *kind, *old_id, *new_id, &items)
                .await?;
        }
        Ok(new_root)
    }

    /// Clones one template item row — title, its kind's own columns and (when `landing` says)
    /// privacy — onto `landing`, keeping the original's flow and sort position unless the landing
    /// overrides them.
    async fn clone_item_row(
        &mut self,
        item_type: FlowItemType,
        item_id: i64,
        landing: ItemLanding<'_>,
    ) -> Result<i64, FlowError> {
        let table = item_type.table();
        // A Commitment's and a wait's own fields live on the row; a Task's travel through
        // `TemplateOperator::copy`.
        let own = match item_type {
            FlowItemType::FlowCommitment => ", verdict_window_n, verdict_window_kind",
            FlowItemType::FlowExpectation => {
                ", check_every_n, check_every_kind, first_check_kind, first_check_index"
            }
            FlowItemType::FlowGoal | FlowItemType::FlowTask => "",
        };
        // One INSERT ... SELECT so every column the source row carries is read and written in the
        // same statement, and a column added later cannot be silently dropped by the copy.
        let new_id = sqlx::query(&format!(
            "INSERT INTO {table} (flow_id, title, parent_type, parent_id, position, is_private{own})
             SELECT COALESCE(?, flow_id), title, ?, ?, COALESCE(?, position),
                    CASE WHEN ? THEN is_private ELSE 0 END{own}
             FROM {table} WHERE id = ?"
        ))
        .bind(landing.flow_id)
        .bind(landing.parent.0)
        .bind(landing.parent.1)
        .bind(landing.position)
        .bind(landing.privacy)
        .bind(item_id)
        .execute(&mut *self.connection)
        .await?
        .last_insert_rowid();
        Ok(new_id)
    }

    /// The template items parented directly on `(item_type, item_id)` — goal, task, Commitment
    /// then wait items, each in position order.
    async fn item_children(
        &mut self,
        item_type: FlowItemType,
        item_id: i64,
    ) -> Result<Vec<(FlowItemType, i64)>, FlowError> {
        let mut children = Vec::new();
        for kind in FlowItemType::ALL {
            let table = kind.table();
            let ids = sqlx::query_scalar::<_, i64>(&format!(
                "SELECT id FROM {table} WHERE parent_type = ? AND parent_id = ? ORDER BY position ASC"
            ))
            .bind(item_type.as_str())
            .bind(item_id)
            .fetch_all(&mut *self.connection)
            .await?;
            children.extend(ids.into_iter().map(|id| (kind, id)));
        }
        Ok(children)
    }

    /// Copies an item's (Cycle Scope, Cycle Plan) pairs onto its clone, in the same order.
    async fn copy_item_cycles(
        &mut self,
        flow_id: i64,
        item_type: FlowItemType,
        old_id: i64,
        new_id: i64,
    ) -> Result<(), FlowError> {
        sqlx::query(
            "INSERT INTO flow_item_cycles
                (flow_id, item_type, item_id, scope_kind, scope_index,
                 plan_kind, plan_start, plan_end, position)
             SELECT ?, item_type, ?, scope_kind, scope_index,
                    plan_kind, plan_start, plan_end, position
             FROM flow_item_cycles WHERE item_type = ? AND item_id = ?",
        )
        .bind(flow_id)
        .bind(new_id)
        .bind(item_type.as_str())
        .bind(old_id)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Copies the dependency edges *out of* one copied item onto its clone, remapping any that
    /// land inside the copied set. Iterating outgoing edges alone still covers every edge internal
    /// to the set, because each of those is outgoing for exactly one of its two ends.
    async fn copy_item_dependencies(
        &mut self,
        flow_id: i64,
        item_type: FlowItemType,
        old_id: i64,
        new_id: i64,
        items: &HashMap<(FlowItemType, i64), i64>,
    ) -> Result<(), FlowError> {
        let edges: Vec<(String, i64)> = sqlx::query_as(
            "SELECT depends_on_type, depends_on_id FROM flow_dependencies
             WHERE dependent_type = ? AND dependent_id = ?",
        )
        .bind(item_type.as_str())
        .bind(old_id)
        .fetch_all(&mut *self.connection)
        .await?;
        for (blocker_type, blocker_id) in edges {
            let target = FlowItemType::from_db(&blocker_type)
                .and_then(|kind| items.get(&(kind, blocker_id)).copied())
                .unwrap_or(blocker_id);
            sqlx::query(
                "INSERT INTO flow_dependencies
                    (flow_id, dependent_type, dependent_id, depends_on_type, depends_on_id)
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(flow_id)
            .bind(item_type.as_str())
            .bind(new_id)
            .bind(&blocker_type)
            .bind(target)
            .execute(&mut *self.connection)
            .await?;
        }
        Ok(())
    }

    /// What decides whether one of this Habit's iterations is complete: every instance an
    /// iteration holds — the flow root plus every occurrence of every flow item; an item-less flow
    /// still has one, its root — where each nests, and what their overlays record.
    async fn completion_inputs(
        &mut self,
        flow_id: FlowId,
    ) -> Result<occurrences::CompletionInputs, FlowError> {
        let keys: Vec<(nodes::key::TemplateItem, i64)> = self
            .iteration_instance_keys(flow_id)
            .await?
            .into_iter()
            .filter_map(|(item_type, item_id, cycle)| {
                TemplateKind::from_db(&item_type)
                    .map(|item_type| (nodes::key::TemplateItem { item_type, item_id }, cycle))
            })
            .collect();
        let overlays = OverlayOperator::new(&mut *self.connection)
            .for_habit(flow_id.0)
            .await?;
        let tasks = self.list_tasks(flow_id).await?;
        let flow = self.get(flow_id).await?;
        let compound = occurrences::compound_items(&flow, &tasks);
        let template = rules::occurrences::Template {
            goals: self
                .list_goals(flow_id)
                .await?
                .into_iter()
                .map(|goal| (goal.id, goal))
                .collect(),
            tasks: tasks.into_iter().map(|task| (task.id, task)).collect(),
            commitments: self
                .list_commitment_items(Some(flow_id))
                .await?
                .into_iter()
                .map(|item| (item.id, item))
                .collect(),
            expectations: self
                .list_expectation_items(Some(flow_id))
                .await?
                .into_iter()
                .map(|item| (item.id, item))
                .collect(),
            cycles: self.cycles_by_item(flow_id).await?,
        };
        let parents = occurrences::occurrence_parents_of(flow_id, &template, &keys);
        let by_verdict = flow.instance_type == "commitment";
        Ok(occurrences::CompletionInputs {
            keys,
            overlays,
            parents,
            compound,
            // Filled by `occurrences::completion_inputs`, which can derive them.
            readings: compound_readings::Readings::new(),
            by_verdict,
        })
    }

    /// For each of `nodes` that was materialised from a flow, returns its originating flow title
    /// (nodes with no flow origin, or whose flow was since deleted, are omitted). Drives the
    /// scope-clamp prompt's "from flow X" annotation.
    pub async fn origins(&mut self, nodes: Vec<TargetRef>) -> Result<Vec<FlowOrigin>, FlowError> {
        let mut origins = Vec::new();
        for node in nodes {
            let title: Option<String> = sqlx::query_scalar(
                "SELECT f.title FROM flow_instance_nodes n \
                 JOIN flow_instances i ON i.id = n.flow_instance_id \
                 JOIN flows f ON f.id = i.flow_id \
                 WHERE n.node_type = ? AND n.node_id = ? LIMIT 1",
            )
            .bind(&node.node_type)
            .bind(node.node_id)
            .fetch_optional(&mut *self.connection)
            .await?;
            if let Some(flow_title) = title {
                origins.push(FlowOrigin {
                    node_type: node.node_type,
                    node_id: node.node_id,
                    flow_title,
                });
            }
        }
        Ok(origins)
    }

    /// Every real node materialised by a started flow, as `(node_type, node_id)` refs. Lets the
    /// mindmap flag flow-originated Goals/Tasks (e.g. with a flow-instance badge) without a
    /// per-node origin lookup.
    pub async fn list_instance_node_refs(&mut self) -> Result<Vec<TargetRef>, FlowError> {
        sqlx::query_as::<_, TargetRefRow>("SELECT node_type, node_id FROM flow_instance_nodes")
            .fetch_all(&mut *self.connection)
            .await
            .map(|rows| rows.into_iter().map(TargetRef::from).collect())
            .map_err(Into::into)
    }
}

/// The children of a **real** node that a Flow template can hold, as `(kind, id)` pairs — tasks,
/// goals, Commitments, then waits.
///
/// Reads several resources, so it takes the session rather than one operator. It writes nothing,
/// so it serves a pooled and a transactional session alike.
async fn template_children<M: SessionMode>(
    db: &mut Db<M>,
    parent_type: &str,
    parent_id: i64,
) -> Result<Vec<(String, i64)>, FlowError> {
    let mut children = Vec::new();
    let tasks = db.tasks().child_ids(parent_type, parent_id).await?;
    children.extend(tasks.into_iter().map(|id| ("task".to_string(), id)));
    let goals = db.goals().child_ids(parent_type, parent_id).await?;
    children.extend(goals.into_iter().map(|id| ("goal".to_string(), id)));
    let commitments = db.commitments().child_ids(parent_type, parent_id).await?;
    children.extend(commitments.into_iter().map(|id| ("commitment".to_string(), id)));
    let waits = db.expectations().child_ids(parent_type, parent_id).await?;
    children.extend(waits.into_iter().map(|id| ("expectation".to_string(), id)));
    Ok(children)
}

/// What one real node of a converted subtree carries into its flow item beyond its title and
/// window: a Commitment's Verdict Window, a wait's Check every and when it is first checked.
enum ConvertedFields {
    /// A Task or a Goal: nothing beyond title and window.
    Plain,
    /// A Commitment's Verdict Window.
    Commitment(Option<crate::tasks::model::DurationSpec>),
    /// A wait's Check every, and its Starting.
    Wait(
        Option<crate::tasks::model::DurationSpec>,
        Option<NaiveDateTime>,
    ),
}

/// The item kind a converted node becomes, and its title, window and own fields.
async fn converted_node(
    db: &mut Db<Transactional>,
    kind: &str,
    id: i64,
) -> Result<(FlowItemType, String, Option<TimeScope>, ConvertedFields), FlowError> {
    Ok(match kind {
        "goal" => {
            let goal = db.goals().get(GoalId(id)).await?;
            (FlowItemType::FlowGoal, goal.title, goal.time_scope, ConvertedFields::Plain)
        }
        "commitment" => {
            let commitment = db.commitments().get(CommitmentId(id)).await?;
            (
                FlowItemType::FlowCommitment,
                commitment.title,
                commitment.time_scope,
                ConvertedFields::Commitment(commitment.verdict_window),
            )
        }
        "expectation" => {
            let wait = db
                .expectations()
                .get(crate::tasks::model::ExpectationId(id))
                .await?;
            (
                FlowItemType::FlowExpectation,
                wait.title,
                wait.time_scope,
                ConvertedFields::Wait(wait.check_every, wait.check_starting),
            )
        }
        _ => {
            let task = db.tasks().get(TaskId(id)).await?;
            (FlowItemType::FlowTask, task.title, task.time_scope, ConvertedFields::Plain)
        }
    })
}

/// Writes a converted Commitment's or wait's own fields onto its new item. A wait's Starting
/// becomes its first check, counted in days from its window's start, when its window maps to the
/// template's (`window_start`); otherwise its first check is its window's start.
async fn write_converted_fields(
    db: &mut Db<Transactional>,
    item: (FlowItemType, i64),
    fields: ConvertedFields,
    window_start: Option<NaiveDate>,
) -> Result<(), FlowError> {
    let request = match fields {
        ConvertedFields::Plain => return Ok(()),
        ConvertedFields::Commitment(window) => UpdateFlowItemRequest {
            verdict_window: Some(window),
            ..Default::default()
        },
        ConvertedFields::Wait(every, starting) => {
            let first_check = starting.zip(window_start).and_then(|(starting, start)| {
                let offset = (crate::tasks::rules::waits::day_of(starting) - start).num_days();
                (offset >= 0).then(|| model::FirstCheck {
                    kind: "day".to_string(),
                    index: offset + 1,
                })
            });
            UpdateFlowItemRequest {
                first_check: Some(first_check.filter(|_| every.is_some())),
                check_every: Some(every),
                ..Default::default()
            }
        }
    };
    match item.0 {
        FlowItemType::FlowCommitment => {
            db.flows().update_commitment_item(item.1, request).await?;
        }
        _ => {
            db.flows().update_expectation_item(item.1, request).await?;
        }
    }
    Ok(())
}

/// Updates a flow.
///
/// Transactional because the write is a **merge over the stored row**: the `UPDATE` binds values
/// read a moment earlier, so two concurrent updates on a pooled session would lose one of them.
/// That read-then-write is why this is a free function rather than a `FlowOperator` method — an
/// operator wraps a bare connection and cannot demand a transaction in its signature.
#[tracing::instrument(skip(db))]
pub async fn update_flow(
    db: &mut Db<Transactional>,
    id: FlowId,
    request: UpdateFlowRequest,
) -> Result<Flow, FlowError> {
    let template = request.template.clone();
    let flow = db.flows().update(id, request).await?;
    let is_task = InstanceType::from_db(&flow.instance_type) == InstanceType::Task;
    db.flows()
        .templates()
        .write(TemplateTable::Flow, is_task, id.0, &template)
        .await?;
    // The root's Agentic flag, or the host it renders under, decides what its occurrences read
    // as, and so the status model each holds.
    crate::tasks::agentic::reconcile(db, vec![crate::tasks::agentic::Reach::Habit(id.0)]).await?;
    db.flows().get(id).await
}

/// Deletes a flow (and, by cascade, its items, cycles, dependencies and recurrence).
///
/// Transactional: the delete is guarded by an existence read taken just before it.
#[tracing::instrument(skip(db))]
pub async fn delete_flow(db: &mut Db<Transactional>, id: FlowId) -> Result<(), FlowError> {
    db.flows().delete(id).await
}

/// Updates a flow-goal item. Transactional for the same reason as [`update_flow`].
#[tracing::instrument(skip(db))]
pub async fn update_flow_goal(
    db: &mut Db<Transactional>,
    id: i64,
    request: UpdateFlowItemRequest,
) -> Result<FlowGoal, FlowError> {
    let template = request.template.clone();
    let mut goal = db.flows().update_goal(id, request).await?;
    db.flows()
        .templates()
        .write(TemplateTable::FlowGoal, false, id, &template)
        .await?;
    goal.template = db
        .flows()
        .templates()
        .one(TemplateTable::FlowGoal, id)
        .await?;
    Ok(goal)
}

/// Updates a flow-task item. Transactional for the same reason as [`update_flow`].
#[tracing::instrument(skip(db))]
pub async fn update_flow_task(
    db: &mut Db<Transactional>,
    id: i64,
    request: UpdateFlowItemRequest,
) -> Result<FlowTask, FlowError> {
    let template = request.template.clone();
    let mut task = db.flows().update_task(id, request).await?;
    db.flows()
        .templates()
        .write(TemplateTable::FlowTask, true, id, &template)
        .await?;
    if template.agentic.is_some() {
        crate::tasks::agentic::reconcile(
            db,
            vec![crate::tasks::agentic::Reach::Habit(task.flow_id)],
        )
        .await?;
    }
    task.template = db
        .flows()
        .templates()
        .one(TemplateTable::FlowTask, id)
        .await?;
    Ok(task)
}

/// Updates a flow **Commitment** item — its place, title, privacy, Verdict Window and tags.
/// Transactional for the same reason as [`update_flow`].
#[tracing::instrument(skip(db))]
pub async fn update_flow_commitment(
    db: &mut Db<Transactional>,
    id: i64,
    request: UpdateFlowItemRequest,
) -> Result<FlowCommitment, FlowError> {
    let template = request.template.clone();
    db.flows().update_commitment_item(id, request).await?;
    db.flows()
        .templates()
        .write(TemplateTable::FlowCommitment, false, id, &template)
        .await?;
    db.flows().commitment_item(id).await
}

/// Updates a flow **wait** item — its place, title, privacy, Check every, first check and tags.
/// Transactional for the same reason as [`update_flow`].
#[tracing::instrument(skip(db))]
pub async fn update_flow_expectation(
    db: &mut Db<Transactional>,
    id: i64,
    request: UpdateFlowItemRequest,
) -> Result<FlowExpectation, FlowError> {
    let template = request.template.clone();
    db.flows().update_expectation_item(id, request).await?;
    db.flows()
        .templates()
        .write(TemplateTable::FlowExpectation, false, id, &template)
        .await?;
    db.flows().expectation_item(id).await
}

/// Sets (creates or replaces) a flow's Recurrence, making it a Habit.
///
/// Transactional: the Gap and clock rules are checked against the flow row read first, so
/// the write depends on that read.
#[tracing::instrument(skip(db))]
pub async fn set_flow_recurrence(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    request: SetRecurrenceRequest,
) -> Result<FlowRecurrence, FlowError> {
    db.flows().set_recurrence(flow_id, request).await
}

/// Resolves (or un-resolves) a whole Habit iteration by writing/clearing a `done` **Modification**
/// for **every** instance at that scope — the flow root plus every flow item.
///
/// Transactional: the set of instances is read first and one row is written per instance, so a
/// half-applied run would leave the iteration neither done nor undone.
///
/// Exposed as the `set_habit_iteration_done` Tauri command (registered in `lib.rs`); the frontend
/// does not call it yet. It is the whole-iteration
/// counterpart of `set_habit_item_status`: SPEC defines an iteration as resolved when every one of
/// its non-tombstoned instances is done, and this is the operation that says so in one step.
#[tracing::instrument(skip(db))]
pub async fn set_iteration_done(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    iteration_scope_id: ScopeKey,
    done: bool,
    resolved_at_ms: i64,
) -> Result<(), FlowError> {
    db.flows()
        .set_iteration_done(flow_id, iteration_scope_id, done, resolved_at_ms)
        .await?;
    // Done is written in the ordinary spelling; an occurrence that reads as Agentic holds its
    // own model's, which the reconciliation converts it to.
    crate::tasks::agentic::reconcile(db, vec![crate::tasks::agentic::Reach::Habit(flow_id.0)])
        .await?;
    Ok(())
}

/// The window one occurrence of a Habit runs over, resolved against its own iteration.
///
/// The iteration's window first, from the scope anchoring it; then, for an occurrence drawn by a
/// **cycle pair**, that pair's Cycle Scope resolved against the iteration's start — the same
/// arithmetic the occurrences are derived with, so the window an added child is held to and
/// the window its occurrence renders with are one answer and not two. A pair naming no Cycle Scope
/// falls back to the iteration's, exactly as an occurrence with no pair does.
///
/// `None` for an occurrence of an **Unscoped** Interval Habit, which has no window at all.
pub(crate) async fn occurrence_window<M: SessionMode>(
    db: &mut Db<M>,
    flow: &Flow,
    key: &OccurrenceKey,
) -> Result<Option<TimeScope>, FlowError> {
    let Some((iteration, window_start)) = iteration_window(flow, key.iteration)? else {
        return Ok(None);
    };
    if key.cycle == NO_CYCLE {
        return Ok(Some(iteration));
    }
    let pair = db.flows().cycle(key.cycle).await?;
    let resolved = resolve_cycle(pair.as_ref(), Some(window_start))?;
    Ok(Some(
        resolved.map_or(iteration, |resolved| resolved.time_scope),
    ))
}

/// Creates one real node and attaches it to one virtual Habit occurrence, as a single gesture.
///
/// Both halves or neither: a row written without its attachment is a node loose on the board under
/// the occurrence's host, which is precisely the "unrelated sibling Task" this feature exists to
/// stop people from having to make.
///
/// The row's own `parent_type`/`parent_id` name the occurrence's **host** — the flow's Target Node
/// — because a virtual instance has no id for them to point at. What makes the occurrence the
/// child's parent is the attachment, which the ancestry climb reads: containment, inheritance and
/// Archival all follow the occurrence from that moment on, not the host.
///
/// A **Commitment** child is the one kind created carrying the occurrence's window as its own,
/// because a Commitment with no effective window has nothing it could ever be kept or broken over
/// and the model refuses it. The other three are created unscoped and inherit the occurrence's.
#[tracing::instrument(skip(db))]
pub async fn create_instance_child(
    db: &mut Db<Transactional>,
    parent: &OccurrenceKey,
    child_type: &str,
    title: String,
) -> Result<TargetRef, FlowError> {
    if !model::CHILD_KINDS.contains(&child_type) {
        return Err(FlowError::Invalid(format!(
            "a habit occurrence holds tasks, goals, commitments, expectations and notes — not a \
             {child_type}"
        )));
    }
    let host = occurrence_edit::host_of(db, parent).await?;
    let parent_type = host.host_type.clone();
    let parent_id = NodeId::Stored(host.host_id);
    let child_id = match child_type {
        "task" => create_task(
            db,
            CreateTaskRequest {
                title,
                parent_type,
                parent_id,
                ..Default::default()
            },
        )
        .await?
        .id
        .require_stored()?,
        "goal" => create_goal(
            db,
            CreateGoalRequest {
                title,
                parent_type,
                parent_id,
                ..Default::default()
            },
        )
        .await?
        .id
        .require_stored()?,
        "commitment" => create_commitment(
            db,
            CreateCommitmentRequest {
                title,
                parent_type,
                parent_id,
                time_scope: host.window.clone(),
                ..Default::default()
            },
        )
        .await?
        .id
        .require_stored()?,
        "expectation" => crate::tasks::create_expectation(
            db,
            crate::tasks::model::CreateExpectationRequest {
                title,
                parent_type,
                parent_id,
                ..Default::default()
            },
        )
        .await?
        .id
        .require_stored()?,
        _ => {
            db.infos()
                .create(CreateInfoRequest {
                    body: title,
                    details: None,
                    parent_type,
                    parent_id,
                    position: 0,
                })
                .await?
                .id
        }
    };
    occurrence_edit::attach(db, &host, parent, child_type, child_id).await?;
    Ok(TargetRef {
        node_type: child_type.to_string(),
        node_id: child_id,
    })
}

/// The added children of one occurrence that are not finished, titles and all.
///
/// Only that occurrence's own children, not their descendants. The guard exists to stop a closing
/// occurrence from silently carrying off what was written *on* it; a step nested under one of
/// those children is that child's business, and that child's own status already says so.
pub async fn unfinished_instance_children(
    db: &mut Db<Transactional>,
    parent: &OccurrenceKey,
) -> Result<Vec<UnfinishedChild>, FlowError> {
    let flow_id = db.flows().occurrence_flow_id(parent).await?;
    let parent_key = parent.node_key();
    unfinished_children(db, flow_id, |child| child.parent_key == parent_key).await
}

/// The unfinished added children on **any** occurrence of one iteration — the guard for closing
/// the iteration as a unit.
pub async fn unfinished_iteration_children(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    iteration: ScopeKey,
) -> Result<Vec<UnfinishedChild>, FlowError> {
    unfinished_children(db, flow_id, |child| {
        OccurrenceKey::parse(&child.parent_key).is_some_and(|key| key.iteration == iteration)
    })
    .await
}

/// The unfinished added children of a Habit that `matches` selects.
///
/// What "finished" means is each kind's own answer and not a fifth one invented here: a Task is
/// finished when it is `done`, a Goal when it is `achieved` (or archived outright), a Commitment
/// once a verdict has been recorded — kept **or** broken, since either is an answer given. An
/// **Info** is never unfinished: a note is not work, and one left on an occurrence is no reason to
/// stop and ask before closing it.
async fn unfinished_children(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    matches: impl Fn(&HabitInstanceChild) -> bool,
) -> Result<Vec<UnfinishedChild>, FlowError> {
    let mut unfinished = Vec::new();
    for child in db.flows().list_instance_children(flow_id).await? {
        if !matches(&child) {
            continue;
        }
        let open: Option<String> = match child.child_type.as_str() {
            "task" => {
                let task = db.tasks().get(TaskId(child.child_id)).await?;
                (!task.status.is_done()).then_some(task.title)
            }
            "goal" => {
                let goal = db.goals().get(GoalId(child.child_id)).await?;
                (goal.status != "achieved" && goal.status != "archived").then_some(goal.title)
            }
            "commitment" => {
                let commitment = db.commitments().get(CommitmentId(child.child_id)).await?;
                (commitment.verdict == Verdict::Unresolved).then_some(commitment.title)
            }
            // A note has nothing to finish.
            _ => None,
        };
        if let Some(title) = open {
            unfinished.push(UnfinishedChild {
                child_type: child.child_type,
                child_id: child.child_id,
                title,
            });
        }
    }
    Ok(unfinished)
}

/// Deep-clones a flow's **template** — the flow row, its items, cycle pairs, and intra-flow
/// dependencies (remapped to the clone), but **not** its Recurrence or completion Modifications —
/// into a brand-new flow.
///
/// Transactional: a fork is dozens of inserts whose parent/cycle/dependency remaps only make sense
/// together, and every id it remaps comes from a read taken inside the same run.
#[tracing::instrument(skip(db))]
pub async fn fork_flow(db: &mut Db<Transactional>, flow_id: FlowId) -> Result<Flow, FlowError> {
    db.flows().fork_flow(flow_id).await
}

/// The habit editor's **Archive & new**: forks the flow's template (see [`fork_flow`]) and archives
/// the original Habit, in one transaction.
///
/// Archiving a Habit means it **stops recurring**, and nothing else: its Recurrence is ended on the
/// Day holding `now` (by the 02:00 day boundary), so an iteration that has already begun — today's,
/// or this week's for a weekly Habit — still stands with its history, and no later one is ever
/// generated. An end that is already on or before that Day is left alone rather than pushed later.
/// A flow with no Recurrence is only forked.
///
/// One transaction, and so, called from one command, one Gesture: a single `Ctrl+Z` takes back the
/// clone and the archive together.
#[tracing::instrument(skip(db))]
pub async fn archive_and_fork(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    now: NaiveDateTime,
) -> Result<Flow, FlowError> {
    let clone = db.flows().fork_flow(flow_id).await?;
    stop_recurring(db, flow_id, now).await?;
    Ok(clone)
}

/// Archives a Habit: it **stops recurring** after the Day holding `now` (by the 02:00 day
/// boundary), so an iteration that has already begun still stands with its history and no later
/// one is generated. An end already on or before that Day is left alone rather than pushed later,
/// and a flow with no Recurrence has nothing to stop.
pub(crate) async fn stop_recurring(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    now: NaiveDateTime,
) -> Result<(), FlowError> {
    let Some(recurrence) = db.flows().get_recurrence(flow_id).await? else {
        return Ok(());
    };
    let today = if now < day_boundary(now.date()) {
        now.date() - Duration::days(1)
    } else {
        now.date()
    };
    if let Some(end) = recurrence.end_scope_id {
        if end.start_date() <= today {
            return Ok(());
        }
    }
    db.flows()
        .set_recurrence_end(flow_id, ScopeKey::day(today))
        .await?;
    Ok(())
}

/// Copies a Flow under `(parent_type, parent_id)` at `position` — the Mindmap's Copy+Paste of a
/// Flow node, and the operation a copied Domain or Goal will call for each Flow beneath it.
///
/// **A copy of a Habit is a Habit.** It carries the whole template (items, cycle pairs, intra-flow
/// dependencies remapped onto the copy), the Recurrence entire — Start anchor, Gap, end and the
/// clock — and the privacy flag. The Start anchor is *not* moved to today: the copy
/// exists to be edited within the minute, and a rule that quietly re-anchored it would trade one
/// surprise for another. A copy of a daily Habit started in July therefore renders every iteration
/// since July until it is given a schedule of its own; that is chosen, not overlooked.
///
/// What it deliberately leaves behind:
///
/// - **Completion history.** The `habit_instance_modifications` and per-iteration dependency
///   divergences belong to the original: this copy has not been done. It is also true by
///   construction — a Modification is keyed on its item *and its cycle pair* (migration 0029), and
///   the copy's pairs are new rows with new ids, so there is nothing for it to inherit.
/// - **Started instances.** `flow_instances` rows and the nodes they materialised are real Goals
///   and Tasks standing somewhere on the board; copying a template does not copy finished work.
///
/// The **Target Node** is inherited exactly as stored, NULL included. A flow that never named a
/// target has a NULL one meaning "my parent" (migration 0025), so the copy's instances land
/// wherever the paste put it; a flow deliberately pointed elsewhere keeps pointing there.
///
/// Transactional, for the reason [`fork_flow`] is: dozens of inserts whose remaps only make sense
/// together.
#[tracing::instrument(skip(db))]
pub async fn duplicate_flow(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    parent_type: &str,
    parent_id: i64,
    position: i64,
) -> Result<Flow, FlowError> {
    let source = db.flows().get(flow_id).await?;
    let placement = ClonePlacement {
        parent_type: parent_type.to_string(),
        parent_id,
        position,
    };
    let clone = db.flows().clone_template(flow_id, Some(placement)).await?;
    let new_id = FlowId(clone.flow.id);
    db.flows().copy_recurrence(flow_id, new_id).await?;
    // Privacy travels with the copy. Dropping it would publish a private template the moment it
    // was duplicated, which is the one way a copy can be worse than no copy at all.
    for ((kind, old_id), cloned_id) in &clone.items {
        db.flows()
            .copy_item_privacy(*kind, *old_id, *cloned_id)
            .await?;
    }
    if source.is_private {
        db.flows()
            .update(
                new_id,
                UpdateFlowRequest {
                    is_private: Some(true),
                    ..Default::default()
                },
            )
            .await?;
    }
    db.flows().get(new_id).await
}

/// Copies a template item — and everything nested under it — onto `(parent_type, parent_id)` at
/// `position`, **within its own flow**. Returns the new item's id.
///
/// Its cycle pairs come with it: a Cycle Scope is an offset into the flow window, and pasted back
/// into the same template it is the same window, so the offset still means what it meant.
///
/// Pasting into a *different* flow is refused rather than resolved. The offset would have to be
/// re-read against another window or dropped, which is the anchor-resolution problem `start`
/// already solves once and is not worth solving twice on a paste.
///
/// Transactional: the copy is one insert per nested item plus its pairs and edges, and the
/// dependency remap names ids written earlier in the same run.
#[tracing::instrument(skip(db))]
pub async fn duplicate_flow_item(
    db: &mut Db<Transactional>,
    item_type: FlowItemType,
    item_id: i64,
    parent_type: &str,
    parent_id: i64,
    position: i64,
) -> Result<i64, FlowError> {
    let flow_id = db.flows().item_flow_id(item_type, item_id).await?;
    if destination_flow_id(db, parent_type, parent_id).await? != flow_id {
        return Err(FlowError::Invalid(
            "a flow item is copied only within its own template — its Cycle Scope is an offset \
             into this flow's window, which another flow's window does not share"
                .to_string(),
        ));
    }
    // The nesting rule, said by name. The item tables' `parent_type` CHECKs would refuse this
    // anyway, as a constraint violation with nothing in it for the user.
    let instance_type = db.flows().get(FlowId(flow_id)).await?.instance_type;
    rules::items::require_placement(item_type, parent_type, &instance_type)?;
    db.flows()
        .clone_item_subtree(item_type, item_id, parent_type, parent_id, position)
        .await
}

/// The flow a paste destination belongs to: a `flow` parent **is** the flow, an item parent names
/// one, and anything else cannot hold a flow item at all.
async fn destination_flow_id(
    db: &mut Db<Transactional>,
    parent_type: &str,
    parent_id: i64,
) -> Result<i64, FlowError> {
    match parent_type {
        "flow" => Ok(db.flows().get(FlowId(parent_id)).await?.id),
        other => match FlowItemType::from_db(other) {
            Some(kind) => db.flows().item_flow_id(kind, parent_id).await,
            None => Err(FlowError::Invalid(format!(
                "a {other} cannot hold a flow item"
            ))),
        },
    }
}

/// Derives a Habit's iterations at `now` (local wall-clock): the ordered schedule of started
/// iterations, each classified by its clock (`flows::habits`). Future iterations are omitted (an
/// ellipsis stands in for them). Errors if the flow is not a Habit.
///
/// A read: every iteration window is derived from its value key, so nothing is written (ADR 0009),
/// and any session will do.
#[tracing::instrument(skip(db))]
pub async fn generate_habit_iterations<M: SessionMode>(
    db: &mut Db<M>,
    flow_id: FlowId,
    now: NaiveDateTime,
) -> Result<Vec<HabitIteration>, FlowError> {
    let recurrence = db
        .flows()
        .get_recurrence(flow_id)
        .await?
        .ok_or_else(|| FlowError::Invalid("flow is not a habit".to_string()))?;
    let flow = db.flows().get(flow_id).await?;
    let clock = parse_clock(&recurrence)?;
    let completions = occurrences::completion_inputs(db, &flow, now).await?;
    let slots = clock_slots(&flow, &recurrence, clock, now, |slot| {
        completions.completed_at(slot)
    })?;
    let resolved = completions.resolutions(&slots);
    let iterations = classify_iterations(&slots, clock, &resolved, now);
    let iterations = expire_unanswered(iterations, &verdict_deadlines(&flow, clock, &slots), now);

    // Each iteration's occurrences: the same items, resolved against that iteration's own window.
    let items = db.flows().instance_items(flow_id).await?;
    let cycles = db.flows().cycles_by_item(flow_id).await?;
    let shape = HabitShape {
        items: &items,
        cycles: &cycles,
        clock,
        scoped: flow.flow_duration_kind.is_some(),
    };
    let by_index: HashMap<i64, &SlotWindow> = slots.iter().map(|slot| (slot.index, slot)).collect();
    let mut resolved_iterations = Vec::with_capacity(iterations.len());
    for iteration in iterations {
        // Every classified iteration came from a slot, so the lookup always hits; an iteration
        // that somehow had no slot would simply render no occurrences rather than fail the load.
        let instances = match by_index.get(&iteration.index) {
            Some(slot) => resolve_iteration_instances(&shape, slot, iteration.status, now)?,
            None => Vec::new(),
        };
        resolved_iterations.push(HabitIteration {
            instances,
            ..iteration
        });
    }
    Ok(resolved_iterations)
}

/// Filters `candidates` to the targets a flow of the given `duration` may materialise under.
///
/// A target must be able to hold the Flow's instances ([`rules::targets::holds_instances`]),
/// whatever its window. One that can is valid when its effective Time Scope window (its own, or
/// the nearest scoped ancestor's) wholly contains the flow window; a target with no scoped
/// ancestor — and any Unscoped flow (`duration` = `None`) — is always valid. With a concrete `anchor`, the window
/// is resolved and containment is exact; without one (template edit, before the anchor is
/// known), a coarse necessary check keeps only targets at least as long as the flow's shortest
/// possible window. The backend [`start`] still hard-rejects anything that slips through.
///
/// Reads tasks and goals, so it takes the session; resolving the window itself is pure. A read,
/// so any session will do.
#[tracing::instrument(skip(db))]
pub async fn valid_targets<M: SessionMode>(
    db: &mut Db<M>,
    duration: Option<(i64, String)>,
    anchor: Option<NaiveDate>,
    candidates: Vec<TargetRef>,
) -> Result<Vec<TargetRef>, FlowError> {
    // Only a node that can hold the Flow's instances is a target at all, scoped Flow or not.
    let candidates: Vec<TargetRef> = candidates
        .into_iter()
        .filter(|candidate| rules::targets::holds_instances(&candidate.node_type))
        .collect();
    let Some((n, kind)) = duration else {
        return Ok(candidates); // Unscoped flow: no window, no further constraint.
    };
    // A Phase window can't be resolved from `(n, kind)` alone (its band/time isn't carried here),
    // so it always uses the coarse filter — where `min_period_days` is 0, i.e. every target
    // passes and the exact check is deferred to `start`.
    let concrete = match anchor {
        Some(date) if !matches!(kind.as_str(), "part" | "exact") => {
            let (window, _) = resolve_window(n, &kind, date)?;
            Some(window.window())
        }
        _ => None,
    };
    let min_days = n * min_period_days(&kind)?;

    let mut valid = Vec::new();
    for candidate in candidates {
        let effective =
            nearest_scoped_ancestor_window(db, &candidate.node_type, candidate.node_id).await?;
        let fits = match (concrete, effective) {
            (_, None) => true, // Unconstrained target.
            (Some(window), Some(target)) => interval_contains(target, window),
            (None, Some(target)) => (target.1 - target.0).num_days() >= min_days,
        };
        if fits {
            valid.push(candidate);
        }
    }
    Ok(valid)
}

/// Converts a real Task/Goal subtree into a **Flow** template of the same Instance Type: the root
/// becomes the flow, every descendant Goal, Task, Commitment and wait becomes a flow item of its
/// kind mirroring the hierarchy — a Commitment keeping its Verdict Window, a wait its Check every
/// and, as a first check, its Starting (ruled by the user, 2026-10-03) — and the original subtree
/// is deleted. When `keep_dependencies`, intra-subtree task dependencies — on a task, goal or
/// wait — are remapped to flow dependencies. When `map_scopes`, the root's Time Scope becomes the flow Window
/// and each descendant's Time Scope becomes a relative Cycle Scope (offset within the window;
/// canonical kinds only — part/exact and Plans are dropped). Errors if the root's parent can't
/// hold a flow (i.e. it is a task).
///
/// Reads and writes flows, tasks, goals and scopes, and **deletes the original subtree after
/// ~150 lines of inserts** — the operation ADR-0004 was written for. Its signature demands a
/// transactional session so that a failure part-way cannot leave both a partial template and a
/// half-deleted subtree.
#[tracing::instrument(skip(db))]
pub async fn convert_to_flow(
    db: &mut Db<Transactional>,
    root_type: &str,
    root_id: i64,
    keep_dependencies: bool,
    map_scopes: bool,
) -> Result<Flow, FlowError> {
    // Read the root, and reject placements a flow can't occupy.
    let (title, parent_type, parent_id, root_ts) = match root_type {
        "goal" => {
            let g = db.goals().get(GoalId(root_id)).await?;
            (
                g.title,
                g.parent_type,
                g.parent_id.require_stored()?,
                g.time_scope,
            )
        }
        "task" => {
            let t = db.tasks().get(TaskId(root_id)).await?;
            (
                t.title,
                t.parent_type,
                t.parent_id.require_stored()?,
                t.time_scope,
            )
        }
        _ => {
            return Err(FlowError::Invalid(
                "only a task or goal can convert to a flow".to_string(),
            ))
        }
    };
    // Where a Flow may hang is the one parenting table's answer.
    let parent_holds_a_flow =
        crate::nodes::rules::parenting::kind_of(&parent_type).is_some_and(|parent| {
            crate::nodes::rules::parenting::may_parent(
                crate::filters::model::NodeKind::Flow,
                parent,
            )
        });
    if !parent_holds_a_flow {
        return Err(FlowError::Invalid(format!(
            "a flow cannot be parented under a {parent_type}"
        )));
    }

    // Map the root's Time Scope to the flow Window (Span / Phase) and note the window start date.
    let mut win_n: Option<i64> = None;
    let mut win_kind: Option<String> = None;
    let mut win_part: Option<String> = None;
    let mut win_time_start: Option<String> = None;
    let mut win_time_end: Option<String> = None;
    let mut window_start: Option<NaiveDate> = None;
    if map_scopes {
        if let Some(ts) = &root_ts {
            let start = ts.start_id.scope();
            if let Some(dur) = &ts.duration {
                win_n = Some(dur.n);
                win_kind = Some(dur.kind.clone());
                window_start = Some(ts.start_id.start_date());
            } else {
                match start.kind.as_str() {
                    "day" | "week" | "month" | "season" => {
                        win_n = Some(1);
                        win_kind = Some(start.kind.clone());
                        window_start = Some(ts.start_id.start_date());
                    }
                    "part_of_day" => {
                        win_n = Some(1);
                        win_kind = Some("part".to_string());
                        win_part = start.part.clone();
                        window_start = Some(ts.start_id.start_date());
                    }
                    "exact" => {
                        if let Some(sdt) = &start.start_datetime {
                            let dt = NaiveDateTime::parse_from_str(sdt, "%Y-%m-%dT%H:%M:%S")
                                .map_err(|e| FlowError::Invalid(e.to_string()))?;
                            win_n = Some(1);
                            win_kind = Some("exact".to_string());
                            win_time_start = Some(dt.format("%H:%M").to_string());
                            win_time_end = start
                                .end_datetime
                                .as_deref()
                                .and_then(|e| {
                                    NaiveDateTime::parse_from_str(e, "%Y-%m-%dT%H:%M:%S").ok()
                                })
                                .map(|e| e.format("%H:%M").to_string());
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    // Create the flow with **no** Target Node: a null target means "my parent", resolved when the
    // instances are placed, so the flow lands on the root's former parent without freezing that
    // parent into a second column that a later move would leave behind.
    let flow_id = db
        .flows()
        .create(CreateFlowRequest {
            title: title.clone(),
            instance_type: Some(if root_type == "goal" {
                InstanceType::Goal
            } else {
                InstanceType::Task
            }),
            parent_type: parent_type.clone(),
            parent_id,
            flow_duration_n: win_n,
            flow_duration_kind: win_kind.clone(),
            flow_window_part: win_part.clone(),
            flow_window_time_start: win_time_start.clone(),
            flow_window_time_end: win_time_end.clone(),
            ..Default::default()
        })
        .await?
        .id;

    // BFS the subtree (parents before children), tracking each node's real parent.
    let root_key = (root_type.to_string(), root_id);
    let mut order: Vec<(String, i64)> = template_children(db, root_type, root_id).await?;
    let mut parent_of: HashMap<(String, i64), (String, i64)> = HashMap::new();
    for child in &order {
        parent_of.insert(child.clone(), root_key.clone());
    }
    let mut i = 0;
    while i < order.len() {
        let (kind, id) = order[i].clone();
        // A wait holds only notes, which a template does not carry.
        let children = if kind == "expectation" {
            Vec::new()
        } else {
            template_children(db, &kind, id).await?
        };
        for child in children {
            parent_of.insert(child.clone(), (kind.clone(), id));
            order.push(child);
        }
        i += 1;
    }

    // Create a flow item per subtree node, mirroring the hierarchy.
    let mut item_map: HashMap<(String, i64), (FlowItemType, i64)> = HashMap::new();
    for (kind, id) in &order {
        let (item_type, item_title, node_ts, own_fields) = converted_node(db, kind, *id).await?;
        let (parent_item_type, parent_item_id) = {
            let parent = &parent_of[&(kind.clone(), *id)];
            if parent == &root_key {
                ("flow".to_string(), flow_id)
            } else {
                let (pit, pid) = &item_map[parent];
                (pit.as_str().to_string(), *pid)
            }
        };
        let item_request = CreateFlowItemRequest {
            flow_id,
            title: item_title,
            parent_type: parent_item_type,
            parent_id: parent_item_id,
        };
        let new_id = match item_type {
            FlowItemType::FlowGoal => db.flows().create_goal(item_request).await?.id,
            FlowItemType::FlowTask => db.flows().create_task(item_request).await?.id,
            FlowItemType::FlowCommitment => {
                db.flows()
                    .create_commitment_item(item_request)
                    .await?
                    .id
            }
            FlowItemType::FlowExpectation => {
                db.flows()
                    .create_expectation_item(item_request)
                    .await?
                    .id
            }
        };
        item_map.insert((kind.clone(), *id), (item_type, new_id));
        // A wait's first check is counted from the start of the window it maps to: its own, or
        // the template's.
        let wait_window = if map_scopes {
            node_ts
                .as_ref()
                .map(|scope| scope.start_id.start_date())
                .or(window_start)
        } else {
            None
        };
        write_converted_fields(db, (item_type, new_id), own_fields, wait_window).await?;

        // Map the descendant's Time Scope to a relative Cycle Scope (canonical kinds only).
        if map_scopes {
            if let (Some(ws), Some(ts)) = (window_start, &node_ts) {
                let ds = ts.start_id.scope();
                if matches!(ds.kind.as_str(), "day" | "week" | "month" | "season") {
                    if let Some(offset) = periods_between(ws, ts.start_id.start_date(), &ds.kind) {
                        db.flows()
                            .set_cycles(
                                flow_id,
                                item_type,
                                new_id,
                                &[FlowCycleInput {
                                    scope_kind: Some(ds.kind.clone()),
                                    scope_index: Some(offset + 1),
                                    plan_kind: None,
                                    plan_start: None,
                                    plan_end: None,
                                }],
                            )
                            .await?;
                    }
                }
            }
        }
    }

    // Remap intra-subtree task dependencies to flow dependencies.
    if keep_dependencies {
        for (kind, id) in std::iter::once(&root_key).chain(order.iter()) {
            if kind.as_str() != "task" {
                continue;
            }
            let dependent = match item_map.get(&(kind.clone(), *id)) {
                Some(m) => *m,
                None => continue, // the root is not a flow item
            };
            let dependencies = db.tasks().list_dependencies(TaskId(*id)).await?;
            for dep in dependencies {
                let dep_key = match dep {
                    Dependency::Task { id } => ("task".to_string(), id.require_stored()?),
                    Dependency::Goal { id } => ("goal".to_string(), id.require_stored()?),
                    // A wait in the subtree became a wait item, which a Task item may wait on.
                    Dependency::Expectation { id } => ("expectation".to_string(), id),
                };
                if let Some((on_type, on_id)) = item_map.get(&dep_key).copied() {
                    db.flows()
                        .add_dependency(flow_id, dependent.0, dependent.1, on_type, on_id)
                        .await?;
                }
            }
        }
    }

    // Delete the original subtree. The task/goal cascade walks the descendants itself (and takes
    // their infos and block reasons with them), so the root is all it needs.
    if root_type == "goal" {
        delete_goal(db, GoalId(root_id)).await?;
    } else {
        delete_task(db, TaskId(root_id)).await?;
    }

    db.flows().get(FlowId(flow_id)).await
}

/// Loads a flow's template — items (goals then tasks, each in position order), cycle pairs and
/// dependencies — filtered to that one flow.
///
/// All four reads happen **before** the first write. That is safe, and load-bearing for the split:
/// [`start`] writes goals, tasks, scopes, `flow_instances`, `flow_instance_nodes` and
/// `task_dependencies`, and never touches a flow-template table, so nothing it does can change
/// what these reads return.
#[tracing::instrument(skip(db))]
async fn load_template<M: SessionMode>(
    db: &mut Db<M>,
    flow_id: FlowId,
) -> Result<FlowTemplate, FlowError> {
    let goals = db.flows().list_goals(flow_id).await?;
    let tasks = db.flows().list_tasks(flow_id).await?;
    let commitments = db.flows().list_commitment_items(Some(flow_id)).await?;
    let waits = db.flows().list_expectation_items(Some(flow_id)).await?;
    let cycles = db.flows().list_all_cycles().await?;
    let dependencies = db.flows().list_all_dependencies().await?;

    let item = |kind: FlowItemType,
                (id, title, parent_type, parent_id, position, is_private): (
        i64,
        &String,
        &String,
        i64,
        i64,
        bool,
    )| TemplateItem {
        kind,
        id,
        title: title.clone(),
        parent_type: parent_type.clone(),
        parent_id,
        position,
        is_private,
    };
    let mut items: Vec<TemplateItem> =
        Vec::with_capacity(goals.len() + tasks.len() + commitments.len() + waits.len());
    for goal in &goals {
        items.push(item(
            FlowItemType::FlowGoal,
            (
                goal.id,
                &goal.title,
                &goal.parent_type,
                goal.parent_id,
                goal.position,
                goal.is_private,
            ),
        ));
    }
    for task in &tasks {
        items.push(item(
            FlowItemType::FlowTask,
            (
                task.id,
                &task.title,
                &task.parent_type,
                task.parent_id,
                task.position,
                task.is_private,
            ),
        ));
    }
    for commitment in &commitments {
        items.push(item(
            FlowItemType::FlowCommitment,
            (
                commitment.id,
                &commitment.title,
                &commitment.parent_type,
                commitment.parent_id,
                commitment.position,
                commitment.is_private,
            ),
        ));
    }
    for wait in &waits {
        items.push(item(
            FlowItemType::FlowExpectation,
            (
                wait.id,
                &wait.title,
                &wait.parent_type,
                wait.parent_id,
                wait.position,
                wait.is_private,
            ),
        ));
    }

    Ok(FlowTemplate {
        items,
        cycles: cycles
            .into_iter()
            .filter(|c| c.flow_id == flow_id.0)
            .collect(),
        dependencies: dependencies
            .into_iter()
            .filter(|d| d.flow_id == flow_id.0)
            .collect(),
    })
}

/// Writes a [`RenderedPlan`]: create each node under its already-written parent, record it against
/// the flow instance, then add the dependency edges once every node has a real id.
///
/// The plan lists nodes in creation order with every parent ahead of its children, so one pass
/// suffices. Node 0 is the root: it is the only node whose parent is the start target rather than
/// another node, and it is the one the `flow_instances` row is opened on — between its creation
/// and its `flow_instance_nodes` row, as it always has been.
#[tracing::instrument(skip(db, plan))]
async fn write_plan(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    request: &StartFlowRequest,
    plan: &RenderedPlan,
    fields: &HashMap<(String, i64), TemplateFields>,
) -> Result<MaterializedFlow, FlowError> {
    let dangling = || FlowError::Invalid("rendered plan references an unwritten node".to_string());
    let mut written: Vec<(String, i64)> = Vec::with_capacity(plan.nodes.len());
    let mut opened: Option<i64> = None;

    for node in &plan.nodes {
        // The root's two parent spellings differ: `create_*` takes the kind-mapped target type,
        // `record_node` the raw one. For every other node both are the parent node's own type.
        let (create_parent, record_parent) = match node.parent {
            None => (
                (target_parent_type(&request.target_type), request.target_id),
                (request.target_type.clone(), request.target_id),
            ),
            Some(NodeRef(index)) => {
                let parent = written.get(index).ok_or_else(dangling)?.clone();
                (parent.clone(), parent)
            }
        };

        let created = match node.kind {
            render::PlannedKind::Goal => {
                let goal = create_goal(
                    db,
                    CreateGoalRequest {
                        title: node.title.clone(),
                        parent_type: create_parent.0,
                        parent_id: create_parent.1.into(),
                        status: None,
                        time_scope: node.time_scope.clone(),
                        on_scope_exit: None,
                    },
                )
                .await?;
                ("goal".to_string(), goal.id.require_stored()?)
            }
            render::PlannedKind::Task => {
                let task = create_task(
                    db,
                    CreateTaskRequest {
                        title: node.title.clone(),
                        parent_type: create_parent.0,
                        parent_id: create_parent.1.into(),
                        status: None,
                        time_scope: node.time_scope.clone(),
                        plan: node.plan.clone(),
                        // A flow item carries no due of its own; the instance takes the default.
                        due_scope: None,
                        on_scope_exit: None,
                        // A materialized instance always arrives in play. Nothing enters the
                        // backlog without the user putting it there.
                        archival: None,
                        // Likewise it arrives inheriting: a flow item has no Agentic column of
                        // its own, so the instance reads whatever the branch it lands in says.
                        agentic: None,
                        // And it arrives not asynchronous: a flow item has no column of its own,
                        async_template: None,
                        agentic_brief: None,
                        // and nothing infers that doing a materialized instance starts a wait.
                        asynchronous: None,
                        compound: None,
                    },
                )
                .await?;
                ("task".to_string(), task.id.require_stored()?)
            }
            render::PlannedKind::Expectation => {
                let wait_item = match node.source {
                    PlannedSource::Item(_, id) => Some(db.flows().expectation_item(id).await?),
                    PlannedSource::Root => None,
                };
                let check_every = wait_item.as_ref().and_then(|item| item.check_every.clone());
                // Its first check falls where its item says within its window — the flow
                // window's start, for one with none of its own (ruled by the user, 2026-10-03).
                let opens = node.time_scope.as_ref().map_or_else(
                    || day_boundary(request.anchor_date),
                    |scope| scope.window().0,
                );
                let check_starting = match (&check_every, &wait_item) {
                    (Some(_), Some(item)) => Some(rules::items::first_check_at(
                        opens,
                        item.first_check.as_ref(),
                    )?),
                    _ => None,
                };
                let wait = crate::tasks::create_expectation(
                    db,
                    crate::tasks::model::CreateExpectationRequest {
                        title: node.title.clone(),
                        parent_type: create_parent.0,
                        parent_id: create_parent.1.into(),
                        check_every,
                        check_starting,
                        time_scope: node.time_scope.clone(),
                        ..Default::default()
                    },
                )
                .await?;
                ("expectation".to_string(), wait.id.require_stored()?)
            }
            render::PlannedKind::Commitment => {
                // A commitment Habit's root. Its window comes from the iteration the same way a
                // task's does; it arrives Unresolved, because a materialised instance is
                // something nobody has judged yet, and the whole point of the kind is that
                // nothing infers a verdict on the user's behalf.
                //
                // `node.plan` is ignored rather than dropped silently: a Commitment has no Plan
                // column, and a commitment flow has no Cycle Plan to set one from.
                // A Commitment item copies its Verdict Window onto the Commitment it becomes.
                let verdict_window = match node.source {
                    PlannedSource::Item(FlowItemType::FlowCommitment, id) => {
                        db.flows().commitment_item(id).await?.verdict_window
                    }
                    _ => None,
                };
                let commitment = create_commitment(
                    db,
                    CreateCommitmentRequest {
                        title: node.title.clone(),
                        parent_type: create_parent.0,
                        parent_id: create_parent.1.into(),
                        verdict: None,
                        time_scope: node.time_scope.clone(),
                        verdict_window,
                    },
                )
                .await?;
                ("commitment".to_string(), commitment.id.require_stored()?)
            }
        };

        let instance_id = match opened {
            Some(id) => id,
            None => {
                let id = db
                    .flows()
                    .open_instance(flow_id, &created.0, created.1)
                    .await?;
                opened = Some(id);
                id
            }
        };
        let source = match node.source {
            PlannedSource::Root => ("flow", flow_id.0),
            PlannedSource::Item(kind, id) => (kind.as_str(), id),
        };
        db.flows()
            .record_node(
                instance_id,
                (&created.0, created.1),
                source,
                (&record_parent.0, record_parent.1),
            )
            .await?;
        if node.is_private {
            set_node_private(db, &created.0, created.1).await?;
        }
        if let Some(fields) = fields.get(&(source.0.to_string(), source.1)) {
            apply_template_fields(db, &created.0, created.1, fields).await?;
        }
        written.push(created);
    }

    for edge in &plan.edges {
        let dependent = written.get(edge.dependent.0).ok_or_else(dangling)?.1;
        let (blocker_type, blocker_id) = written.get(edge.blocker.0).ok_or_else(dangling)?.clone();
        let dependency = match blocker_type.as_str() {
            "goal" => Dependency::Goal {
                id: blocker_id.into(),
            },
            "expectation" => Dependency::Expectation {
                id: blocker_id.into(),
            },
            _ => Dependency::Task {
                id: blocker_id.into(),
            },
        };
        add_task_dependency(db, TaskId(dependent), dependency).await?;
    }

    let (root_type, root_id) = written.into_iter().next().ok_or_else(dangling)?;
    Ok(MaterializedFlow { root_type, root_id })
}

/// Starts a flow: materialises its template into a real, independent Goal/Task subtree under
/// the target, resolving every cycle pair and remapping intra-flow dependencies by fan-in.
///
/// Three steps, in order: **resolve** every scope the flow needs ([`resolve_scopes`], pure),
/// **render** the subtree as a plan of placeholder nodes and edges ([`render`], pure), then
/// **write** it ([`write_plan`], which decides nothing). Everything that decides the *shape* of a
/// materialisation is therefore testable without a database.
///
/// Reads and writes flows, scopes, goals and tasks — the operation ADR-0004 was written for. Its
/// signature demands a transactional session so that a failure part-way through materialisation
/// cannot leave a half-built subtree behind, and so that calling it non-atomically is a compile
/// error rather than a silent correctness bug.
#[tracing::instrument(skip(db))]
pub async fn start(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    request: StartFlowRequest,
) -> Result<MaterializedFlow, FlowError> {
    let flow = db.flows().get(flow_id).await?;
    let template = load_template(db, flow_id).await?;
    let cycles = template.planned_cycles(flow_id.0);
    let scopes = resolve_scopes(&flow, request.anchor_date, &cycles)?;
    let plan = render(&flow, &request.title, &template, &scopes);
    let mut fields: HashMap<(String, i64), TemplateFields> = HashMap::new();
    fields.insert(("flow".to_string(), flow_id.0), flow.template.clone());
    for goal in db.flows().list_goals(flow_id).await? {
        fields.insert(("flow_goal".to_string(), goal.id), goal.template);
    }
    for task in db.flows().list_tasks(flow_id).await? {
        fields.insert(("flow_task".to_string(), task.id), task.template);
    }
    for item in db.flows().list_commitment_items(Some(flow_id)).await? {
        fields.insert(("flow_commitment".to_string(), item.id), item.template);
    }
    for item in db.flows().list_expectation_items(Some(flow_id)).await? {
        fields.insert(("flow_expectation".to_string(), item.id), item.template);
    }
    write_plan(db, flow_id, &request, &plan, &fields).await
}

/// Copies what a template says about the rows it draws onto one row a start just made: a Task's
/// delegate, Agentic, Asynchronous and Compound flags, wait template and Backlog, and every kind's
/// tags and block reasons — so a started flow's copy is the template, not merely its title. The
/// copy is the Task's own: a later edit to the template changes nothing started.
async fn apply_template_fields(
    db: &mut Db<Transactional>,
    node_type: &str,
    node_id: i64,
    fields: &TemplateFields,
) -> Result<(), FlowError> {
    match node_type {
        "task" => {
            if *fields != TemplateFields::default() {
                crate::tasks::update_task(
                    db,
                    TaskId(node_id),
                    crate::tasks::model::UpdateTaskRequest {
                        delegate_to: Some(fields.delegate_to),
                        agentic: Some(crate::tasks::model::TaskAgentic::from_column(
                            fields.agentic,
                        )),
                        asynchronous: Some(fields.asynchronous),
                        archival: Some(fields.archival),
                        // A started Flow's Task carries its template's brief as its own.
                        agentic_brief: Some(fields.agentic_brief.clone()),
                        // And a flow Task item's Compound flag and wait template (Task 611).
                        compound: Some(fields.compound),
                        async_template: Some(fields.async_template.clone()),
                        ..Default::default()
                    },
                )
                .await?;
            }
            for tag_id in &fields.tag_ids {
                db.tasks().add_tag(TaskId(node_id), *tag_id).await?;
            }
        }
        "goal" => {
            for tag_id in &fields.tag_ids {
                db.goals().add_tag(GoalId(node_id), *tag_id).await?;
            }
        }
        "expectation" => {
            for tag_id in &fields.tag_ids {
                db.expectations()
                    .add_tag(crate::tasks::model::ExpectationId(node_id), *tag_id)
                    .await?;
            }
        }
        _ => {
            for tag_id in &fields.tag_ids {
                db.commitments()
                    .add_tag(CommitmentId(node_id), *tag_id)
                    .await?;
            }
        }
    }
    let takes_reasons = matches!(node_type, "task" | "goal");
    if !fields.block_reasons.is_empty() && takes_reasons {
        db.block_reasons()
            .set(node_type, node_id, &fields.block_reasons)
            .await?;
    }
    Ok(())
}

/// Marks a freshly materialised node private, propagating a flow's (or flow item's) privacy onto
/// the real Goal/Task it became.
async fn set_node_private(
    db: &mut Db<Transactional>,
    node_type: &str,
    node_id: i64,
) -> Result<(), FlowError> {
    match node_type {
        "goal" => db.goals().set_private(GoalId(node_id), true).await?,
        "commitment" => {
            db.commitments()
                .set_private(CommitmentId(node_id), true)
                .await?
        }
        "expectation" => {
            crate::tasks::update_expectation(
                db,
                crate::tasks::model::ExpectationId(node_id),
                crate::tasks::model::UpdateExpectationRequest {
                    is_private: Some(true),
                    ..Default::default()
                },
            )
            .await?;
        }
        _ => db.tasks().set_private(TaskId(node_id), true).await?,
    }
    Ok(())
}
