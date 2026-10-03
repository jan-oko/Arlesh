//! A Habit's occurrences, where they touch the database: reading a Habit's template, overlays
//! and relations ([`load_habit`]) and deriving its rows from them ([`derive_habit`]).
//!
//! What the rows *are* — which iterations exist, how each occurrence is built from its template
//! and overlay, its lifecycle and its blocks — is pure and lives in
//! [`crate::flows::rules::occurrences`]. Its names are re-exported here, so callers did not change
//! when it moved (ADR 0010).

use std::collections::HashSet;

use chrono::NaiveDateTime;

use super::{
    error::FlowError,
    model::{Flow, FlowGoal, FlowId},
    parse_clock, target_parent_type,
};
use crate::{
    database::session::{Db, SessionMode},
    nodes::key::OccurrenceKey,
    scopes::key::ScopeKey,
};

use super::rules::occurrences::*;
pub(super) use super::rules::occurrences::{
    compound_items, occurrence_parents_of, CompletionInputs, LoadedHabit,
};
pub(crate) use super::rules::occurrences::{default_due, effective_tags};
pub use super::rules::occurrences::{derive_habit_from, DerivedRows, HabitSource, Horizon};

/// A Habit's template: its items, by id, and each item's cycle pairs. `goals` is passed in when the
/// caller already has them.
async fn load_template<M: SessionMode>(
    db: &mut Db<M>,
    flow_id: FlowId,
    goals: Vec<FlowGoal>,
) -> Result<Template, FlowError> {
    Ok(Template {
        goals: goals.into_iter().map(|goal| (goal.id, goal)).collect(),
        tasks: db
            .flows()
            .list_tasks(flow_id)
            .await?
            .into_iter()
            .map(|task| (task.id, task))
            .collect(),
        cycles: db.flows().cycles_by_item(flow_id).await?,
    })
}

/// Reads what one Habit's rows are drawn from, or `None` when there is nothing to draw: a flow
/// with no Recurrence, or a commitment flow holding goal items — a Commitment cannot parent a
/// Goal, so such a template has no valid materialisation.
pub(super) async fn load_habit<M: SessionMode>(
    db: &mut Db<M>,
    flow: &Flow,
) -> Result<Option<LoadedHabit>, FlowError> {
    let Some(mut habit) = read_habit(db, flow).await? else {
        return Ok(None);
    };
    habit.host_agentic =
        crate::tasks::agentic::reads_agentic(db, &habit.host.0, habit.host.1).await?;
    Ok(Some(habit))
}

/// What [`load_habit`] reads, before whether its host reads as Agentic is answered: a board's
/// gather answers that over every row at once rather than climbing per Habit.
async fn read_habit<M: SessionMode>(
    db: &mut Db<M>,
    flow: &Flow,
) -> Result<Option<LoadedHabit>, FlowError> {
    let flow_id = FlowId(flow.id);
    let Some(recurrence) = db.flows().get_recurrence(flow_id).await? else {
        return Ok(None);
    };
    let goals = db.flows().list_goals(flow_id).await?;
    if flow.instance_type == "commitment" && !goals.is_empty() {
        return Ok(None);
    }
    let template = load_template(db, flow_id, goals).await?;
    let overlays = db.overlays().for_habit(flow.id).await?;
    let relations = HabitRelations {
        tags: db.relations().tags_for_habit(flow.id).await?,
        block_reasons: db.relations().block_reasons_for_habit(flow.id).await?,
        removed_edges: db.relations().removed_template_edges().await?,
        template_edges: db
            .flows()
            .list_all_dependencies()
            .await?
            .into_iter()
            .filter(|edge| edge.flow_id == flow.id)
            .collect(),
    };
    let touched = touched_iterations(db, flow.id).await?;
    let instance_items = db.flows().instance_items(flow_id).await?;
    let (host_type, host_id) = match (&flow.target_type, flow.target_id) {
        (Some(kind), Some(id)) => (target_parent_type(kind), id),
        _ => (target_parent_type(&flow.parent_type), flow.parent_id),
    };
    Ok(Some(LoadedHabit {
        clock: parse_clock(&recurrence)?,
        recurrence,
        template,
        overlays,
        relations,
        touched,
        host: (host_type, host_id),
        host_agentic: false,
        instance_items,
    }))
}

impl HabitSource {
    /// Reads what the Habit `flow` draws its rows from.
    pub async fn read<M: SessionMode>(db: &mut Db<M>, flow: &Flow) -> Result<Self, FlowError> {
        Ok(Self {
            habit: read_habit(db, flow).await?,
        })
    }
}

/// Every occurrence of one Habit within `horizon`, as rows, at `now`.
///
/// A flow with no Recurrence derives nothing. So does a commitment flow holding goal items: a
/// Commitment cannot parent a Goal, so such a template has no valid materialisation, and the load
/// names the flow rather than drawing a subtree the model forbids.
#[tracing::instrument(skip(db, flow), fields(flow_id = flow.id))]
pub async fn derive_habit<M: SessionMode>(
    db: &mut Db<M>,
    flow: &Flow,
    now: NaiveDateTime,
    horizon: Horizon,
) -> Result<DerivedRows, FlowError> {
    let Some(habit) = load_habit(db, flow).await? else {
        return Ok(DerivedRows::default());
    };
    let readings = super::compound_readings::readings(db, flow, &habit, now).await?;
    derive_habit_in(flow, &habit, &readings, now, horizon)
}

/// The iterations of this Habit that carry an overlay, a relation or an attached child.
async fn touched_iterations<M: SessionMode>(
    db: &mut Db<M>,
    flow_id: i64,
) -> Result<HashSet<ScopeKey>, FlowError> {
    let mut touched: HashSet<ScopeKey> = db
        .overlays()
        .touched_iterations(flow_id)
        .await?
        .into_iter()
        .collect();
    for key in db.flows().related_keys(FlowId(flow_id)).await? {
        if let Some(key) = OccurrenceKey::parse(&key) {
            touched.insert(key.iteration);
        }
    }
    Ok(touched)
}

/// [`CompletionInputs`] for a Habit that has not been read whole, with what each of its compound
/// occurrences reads as ([`super::compound_readings`]).
pub(super) async fn completion_inputs<M: SessionMode>(
    db: &mut Db<M>,
    flow: &Flow,
    now: NaiveDateTime,
) -> Result<CompletionInputs, FlowError> {
    let mut inputs = db.flows().completion_inputs(FlowId(flow.id)).await?;
    if let Some(habit) = load_habit(db, flow).await? {
        inputs.readings = super::compound_readings::readings(db, flow, &habit, now).await?;
    }
    Ok(inputs)
}
