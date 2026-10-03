//! The flow tables' rows: what a query decodes, before it becomes a domain value.
//!
//! The domain types in [`super::model`] know nothing of the database (ADR 0010, decision 8). Each
//! row here mirrors one, reads its scope keys through [`DbScopeKey`], and converts into it.

use crate::scopes::db::DbScopeKey;

use super::model::{FlowRecurrence, HabitItemStatus};

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
