//! The flow tables' rows: what a query decodes, before it becomes a domain value.
//!
//! The domain types in [`super::model`] know nothing of the database (ADR 0010, decision 8). Each
//! row here mirrors one, reads its scope keys through [`DbScopeKey`], and converts into it.

use crate::scopes::db::DbScopeKey;

use super::model::{
    FirstCheck, Flow, FlowCommitment, FlowDependency, FlowExpectation, FlowGoal, FlowItemCycle,
    FlowRecurrence, FlowTask, HabitInstanceChild, HabitItemStatus, TargetRef,
};
use crate::tasks::model::DurationSpec;

/// A Duration read from its two columns; absent unless both are there.
fn duration(n: Option<i64>, kind: Option<String>) -> Option<DurationSpec> {
    Some(DurationSpec { n: n?, kind: kind? })
}

/// A [`FlowCommitment`] as its table holds it.
#[derive(sqlx::FromRow)]
pub(crate) struct FlowCommitmentRow {
    id: i64,
    flow_id: i64,
    title: String,
    parent_type: String,
    parent_id: i64,
    position: i64,
    is_private: bool,
    verdict_window_n: Option<i64>,
    verdict_window_kind: Option<String>,
}

impl From<FlowCommitmentRow> for FlowCommitment {
    fn from(row: FlowCommitmentRow) -> Self {
        Self {
            id: row.id,
            flow_id: row.flow_id,
            title: row.title,
            parent_type: row.parent_type,
            parent_id: row.parent_id,
            position: row.position,
            is_private: row.is_private,
            verdict_window: duration(row.verdict_window_n, row.verdict_window_kind),
            template: Default::default(),
        }
    }
}

/// A [`FlowExpectation`] as its table holds it.
#[derive(sqlx::FromRow)]
pub(crate) struct FlowExpectationRow {
    id: i64,
    flow_id: i64,
    title: String,
    parent_type: String,
    parent_id: i64,
    position: i64,
    is_private: bool,
    check_every_n: Option<i64>,
    check_every_kind: Option<String>,
    first_check_kind: Option<String>,
    first_check_index: Option<i64>,
}

impl From<FlowExpectationRow> for FlowExpectation {
    fn from(row: FlowExpectationRow) -> Self {
        Self {
            id: row.id,
            flow_id: row.flow_id,
            title: row.title,
            parent_type: row.parent_type,
            parent_id: row.parent_id,
            position: row.position,
            is_private: row.is_private,
            check_every: duration(row.check_every_n, row.check_every_kind),
            first_check: row
                .first_check_kind
                .zip(row.first_check_index)
                .map(|(kind, index)| FirstCheck { kind, index }),
            template: Default::default(),
        }
    }
}

/// A [`FlowRecurrence`] as its table holds it.
#[derive(sqlx::FromRow)]
pub(crate) struct FlowRecurrenceRow {
    flow_id: i64,
    start_scope_id: DbScopeKey,
    gap_n: Option<i64>,
    gap_kind: Option<String>,
    end_scope_id: Option<DbScopeKey>,
    clock: String,
    miss_policy: Option<String>,
    cooldown_n: Option<i64>,
    cooldown_kind: Option<String>,
}

impl From<FlowRecurrenceRow> for FlowRecurrence {
    fn from(row: FlowRecurrenceRow) -> Self {
        Self {
            flow_id: row.flow_id,
            start_scope_id: row.start_scope_id.0,
            gap_n: row.gap_n,
            gap_kind: row.gap_kind,
            end_scope_id: row.end_scope_id.map(|key| key.0),
            clock: row.clock,
            miss_policy: row.miss_policy,
            cooldown_n: row.cooldown_n,
            cooldown_kind: row.cooldown_kind,
        }
    }
}

/// A [`HabitItemStatus`] as its table holds it.
#[derive(sqlx::FromRow)]
pub(crate) struct HabitItemStatusRow {
    item_type: String,
    item_id: i64,
    iteration_scope_id: DbScopeKey,
    cycle_id: i64,
    status: String,
}

impl From<HabitItemStatusRow> for HabitItemStatus {
    fn from(row: HabitItemStatusRow) -> Self {
        Self {
            item_type: row.item_type,
            item_id: row.item_id,
            iteration_scope_id: row.iteration_scope_id.0,
            cycle_id: row.cycle_id,
            status: row.status,
        }
    }
}

/// A [`Flow`] as its table holds it.
#[derive(sqlx::FromRow)]
pub(crate) struct FlowRow {
    id: i64,
    title: String,
    instance_type: String,
    parent_type: String,
    parent_id: i64,
    target_type: Option<String>,
    target_id: Option<i64>,
    flow_duration_n: Option<i64>,
    flow_duration_kind: Option<String>,
    flow_window_part: Option<String>,
    flow_window_time_start: Option<String>,
    flow_window_time_end: Option<String>,
    root_plan_kind: Option<String>,
    root_plan_start: Option<i64>,
    root_plan_end: Option<i64>,
    verdict_window_n: Option<i64>,
    verdict_window_kind: Option<String>,
    #[sqlx(default)]
    is_habit: bool,
    position: i64,
    is_private: bool,
}

impl From<FlowRow> for Flow {
    fn from(row: FlowRow) -> Self {
        Self {
            id: row.id,
            title: row.title,
            instance_type: row.instance_type,
            parent_type: row.parent_type,
            parent_id: row.parent_id,
            target_type: row.target_type,
            target_id: row.target_id,
            flow_duration_n: row.flow_duration_n,
            flow_duration_kind: row.flow_duration_kind,
            flow_window_part: row.flow_window_part,
            flow_window_time_start: row.flow_window_time_start,
            flow_window_time_end: row.flow_window_time_end,
            root_plan_kind: row.root_plan_kind,
            root_plan_start: row.root_plan_start,
            root_plan_end: row.root_plan_end,
            verdict_window_n: row.verdict_window_n,
            verdict_window_kind: row.verdict_window_kind,
            is_habit: row.is_habit,
            position: row.position,
            is_private: row.is_private,
            template: Default::default(),
        }
    }
}

/// A [`FlowGoal`] as its table holds it.
#[derive(sqlx::FromRow)]
pub(crate) struct FlowGoalRow {
    id: i64,
    flow_id: i64,
    title: String,
    parent_type: String,
    parent_id: i64,
    position: i64,
    is_private: bool,
}

impl From<FlowGoalRow> for FlowGoal {
    fn from(row: FlowGoalRow) -> Self {
        Self {
            id: row.id,
            flow_id: row.flow_id,
            title: row.title,
            parent_type: row.parent_type,
            parent_id: row.parent_id,
            position: row.position,
            is_private: row.is_private,
            template: Default::default(),
        }
    }
}

/// A [`FlowTask`] as its table holds it.
#[derive(sqlx::FromRow)]
pub(crate) struct FlowTaskRow {
    id: i64,
    flow_id: i64,
    title: String,
    parent_type: String,
    parent_id: i64,
    position: i64,
    is_private: bool,
}

impl From<FlowTaskRow> for FlowTask {
    fn from(row: FlowTaskRow) -> Self {
        Self {
            id: row.id,
            flow_id: row.flow_id,
            title: row.title,
            parent_type: row.parent_type,
            parent_id: row.parent_id,
            position: row.position,
            is_private: row.is_private,
            template: Default::default(),
        }
    }
}

/// A [`FlowItemCycle`] as its table holds it.
#[derive(sqlx::FromRow)]
pub(crate) struct FlowItemCycleRow {
    id: i64,
    flow_id: i64,
    item_type: String,
    item_id: i64,
    scope_kind: Option<String>,
    scope_index: Option<i64>,
    plan_kind: Option<String>,
    plan_start: Option<i64>,
    plan_end: Option<i64>,
    position: i64,
}

impl From<FlowItemCycleRow> for FlowItemCycle {
    fn from(row: FlowItemCycleRow) -> Self {
        Self {
            id: row.id,
            flow_id: row.flow_id,
            item_type: row.item_type,
            item_id: row.item_id,
            scope_kind: row.scope_kind,
            scope_index: row.scope_index,
            plan_kind: row.plan_kind,
            plan_start: row.plan_start,
            plan_end: row.plan_end,
            position: row.position,
        }
    }
}

/// A [`TargetRef`] as its table holds it.
#[derive(sqlx::FromRow)]
pub(crate) struct TargetRefRow {
    node_type: String,
    node_id: i64,
}

impl From<TargetRefRow> for TargetRef {
    fn from(row: TargetRefRow) -> Self {
        Self {
            node_type: row.node_type,
            node_id: row.node_id,
        }
    }
}

/// A [`FlowDependency`] as its table holds it.
#[derive(sqlx::FromRow)]
pub(crate) struct FlowDependencyRow {
    id: i64,
    flow_id: i64,
    dependent_type: String,
    dependent_id: i64,
    depends_on_type: String,
    depends_on_id: i64,
}

impl From<FlowDependencyRow> for FlowDependency {
    fn from(row: FlowDependencyRow) -> Self {
        Self {
            id: row.id,
            flow_id: row.flow_id,
            dependent_type: row.dependent_type,
            dependent_id: row.dependent_id,
            depends_on_type: row.depends_on_type,
            depends_on_id: row.depends_on_id,
        }
    }
}

/// A [`HabitInstanceChild`] as its table holds it.
#[derive(sqlx::FromRow)]
pub(crate) struct HabitInstanceChildRow {
    flow_id: i64,
    parent_kind: String,
    parent_key: String,
    child_type: String,
    child_id: i64,
}

impl From<HabitInstanceChildRow> for HabitInstanceChild {
    fn from(row: HabitInstanceChildRow) -> Self {
        Self {
            flow_id: row.flow_id,
            parent_kind: row.parent_kind,
            parent_key: row.parent_key,
            child_type: row.child_type,
            child_id: row.child_id,
        }
    }
}
