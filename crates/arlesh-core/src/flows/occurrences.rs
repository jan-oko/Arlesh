//! A Habit's occurrences, where they touch the database: reading a Habit's template, overlays
//! and relations ([`load_habit`]) and deriving its rows from them ([`derive_habit`]).
//!
//! What the rows *are* — which iterations exist, how each occurrence is built from its template
//! and overlay, its lifecycle and its blocks — is pure and lives in
//! [`crate::flows::rules::occurrences`]. Its names are re-exported here, so callers did not change
//! when it moved (ADR 0010).

use crate::nodes::id::RowId;
use std::collections::{HashMap, HashSet};

use chrono::NaiveDateTime;

use super::{
    error::FlowError,
    model::{
        Flow, FlowCommitment, FlowDependency, FlowExpectation, FlowGoal, FlowId, FlowItemCycle,
        FlowTask,
    },
    parse_clock, target_parent_type,
};
use crate::{
    database::session::{Db, SessionMode},
    nodes::key::{OccurrenceKey, TemplateKind},
    scopes::key::ScopeKey,
    tasks::waits::{CheckRecord, WaitRef},
};

pub(crate) use super::rules::occurrences::effective_tags;
use super::rules::occurrences::*;
pub(super) use super::rules::occurrences::{
    compound_items, occurrence_parents_of, CompletionInputs, LoadedHabit,
};
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
        commitments: db
            .flows()
            .list_commitment_items(Some(flow_id))
            .await?
            .into_iter()
            .map(|item| (item.id, item))
            .collect(),
        expectations: db
            .flows()
            .list_expectation_items(Some(flow_id))
            .await?
            .into_iter()
            .map(|item| (item.id, item))
            .collect(),
        cycles: db.flows().cycles_by_item(flow_id).await?,
    })
}

/// When each of a Habit's wait item occurrences was last checked on, by its node key.
fn last_checks_in(
    checks_by_wait: &HashMap<WaitRef, Vec<CheckRecord>>,
    template: &Template,
) -> HashMap<String, NaiveDateTime> {
    let mut latest = HashMap::new();
    for (wait, checks) in checks_by_wait {
        let WaitRef::Occurrence(key) = wait else {
            continue;
        };
        let Some(occurrence) = OccurrenceKey::parse(key) else {
            continue;
        };
        let ours = occurrence.item.item_type == TemplateKind::FlowExpectation
            && template.expectations.contains_key(&occurrence.item.item_id);
        if let (true, Some(last)) = (ours, checks.iter().map(|check| check.resolved_at).max()) {
            latest.insert(key.clone(), last);
        }
    }
    latest
}

/// What a board load reads of every Flow once, for every Habit's read to take its own share of:
/// the item lists, cycle pairs and template edges it already holds, and the two tables each
/// Habit's read used to read whole again — the edges occurrences removed and every wait's checks.
pub struct HabitShared<'rows> {
    goals: &'rows [FlowGoal],
    tasks: &'rows [FlowTask],
    commitments: &'rows [FlowCommitment],
    expectations: &'rows [FlowExpectation],
    cycles: &'rows [FlowItemCycle],
    dependencies: &'rows [FlowDependency],
    removed_edges: HashSet<(String, String)>,
    checks: HashMap<WaitRef, Vec<CheckRecord>>,
}

/// The Flow-wide lists a board load has read, as [`HabitShared::read`] takes them.
pub struct FlowLists<'rows> {
    /// Every Flow's goal items.
    pub goals: &'rows [FlowGoal],
    /// Every Flow's task items.
    pub tasks: &'rows [FlowTask],
    /// Every Flow's Commitment items.
    pub commitments: &'rows [FlowCommitment],
    /// Every Flow's wait items.
    pub expectations: &'rows [FlowExpectation],
    /// Every item's cycle pairs.
    pub cycles: &'rows [FlowItemCycle],
    /// Every Flow's template edges.
    pub dependencies: &'rows [FlowDependency],
}

impl<'rows> HabitShared<'rows> {
    /// Reads the two tables the lists do not carry.
    pub async fn read<M: SessionMode>(
        db: &mut Db<M>,
        lists: FlowLists<'rows>,
    ) -> Result<Self, FlowError> {
        Ok(Self {
            goals: lists.goals,
            tasks: lists.tasks,
            commitments: lists.commitments,
            expectations: lists.expectations,
            cycles: lists.cycles,
            dependencies: lists.dependencies,
            removed_edges: db.relations().removed_template_edges().await?,
            checks: db.tasks().all_wait_checks().await?,
        })
    }

    fn goals_of(&self, flow_id: RowId) -> Vec<FlowGoal> {
        of_flow(self.goals, |goal| goal.flow_id == flow_id)
    }

    fn template_of(&self, flow_id: RowId, goals: Vec<FlowGoal>) -> Template {
        let mut cycles: HashMap<(String, RowId), Vec<FlowItemCycle>> = HashMap::new();
        for cycle in self.cycles.iter().filter(|cycle| cycle.flow_id == flow_id) {
            cycles
                .entry((cycle.item_type.clone(), cycle.item_id))
                .or_default()
                .push(cycle.clone());
        }
        Template {
            goals: goals.into_iter().map(|goal| (goal.id, goal)).collect(),
            tasks: keyed(self.tasks, |task| task.flow_id == flow_id, |task| task.id),
            commitments: keyed(
                self.commitments,
                |item| item.flow_id == flow_id,
                |item| item.id,
            ),
            expectations: keyed(
                self.expectations,
                |item| item.flow_id == flow_id,
                |item| item.id,
            ),
            cycles,
        }
    }
}

fn of_flow<T: Clone>(rows: &[T], ours: impl Fn(&T) -> bool) -> Vec<T> {
    rows.iter().filter(|row| ours(row)).cloned().collect()
}

fn keyed<T: Clone>(
    rows: &[T],
    ours: impl Fn(&T) -> bool,
    id: impl Fn(&T) -> RowId,
) -> HashMap<RowId, T> {
    rows.iter()
        .filter(|row| ours(row))
        .map(|row| (id(row), row.clone()))
        .collect()
}

/// Reads what one Habit's rows are drawn from, or `None` when there is nothing to draw: a flow
/// with no Recurrence, or a commitment flow holding goal items — a Commitment cannot parent a
/// Goal, so such a template has no valid materialisation.
pub(super) async fn load_habit<M: SessionMode>(
    db: &mut Db<M>,
    flow: &Flow,
) -> Result<Option<LoadedHabit>, FlowError> {
    let Some(mut habit) = read_habit(db, flow, None).await? else {
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
    shared: Option<&HabitShared<'_>>,
) -> Result<Option<LoadedHabit>, FlowError> {
    let flow_id = FlowId(flow.id);
    let Some(recurrence) = db.flows().get_recurrence(flow_id).await? else {
        return Ok(None);
    };
    let goals = match shared {
        Some(shared) => shared.goals_of(flow.id),
        None => db.flows().list_goals(flow_id).await?,
    };
    if flow.instance_type == "commitment" && !goals.is_empty() {
        return Ok(None);
    }
    let template = match shared {
        Some(shared) => shared.template_of(flow.id, goals),
        None => load_template(db, flow_id, goals).await?,
    };
    let last_checks = match shared {
        Some(shared) => last_checks_in(&shared.checks, &template),
        None => last_checks_in(&db.tasks().all_wait_checks().await?, &template),
    };
    let overlays = db.overlays().for_habit(flow.id).await?;
    let (removed_edges, all_edges) = match shared {
        Some(shared) => (shared.removed_edges.clone(), None),
        None => (
            db.relations().removed_template_edges().await?,
            Some(db.flows().list_all_dependencies().await?),
        ),
    };
    let template_edges = match (shared, all_edges) {
        (Some(shared), _) => of_flow(shared.dependencies, |edge| edge.flow_id == flow.id),
        (None, all) => all
            .unwrap_or_default()
            .into_iter()
            .filter(|edge| edge.flow_id == flow.id)
            .collect(),
    };
    let relations = HabitRelations {
        tags: db.relations().tags_for_habit(flow.id).await?,
        block_reasons: db.relations().block_reasons_for_habit(flow.id).await?,
        removed_edges,
        template_edges,
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
        last_checks,
    }))
}

impl HabitSource {
    /// Reads what the Habit `flow` draws its rows from.
    pub async fn read<M: SessionMode>(db: &mut Db<M>, flow: &Flow) -> Result<Self, FlowError> {
        Ok(Self {
            habit: read_habit(db, flow, None).await?,
        })
    }

    /// [`Self::read`], taking what `shared` already holds of every Flow instead of reading it
    /// again for this Habit.
    pub async fn read_shared<M: SessionMode>(
        db: &mut Db<M>,
        flow: &Flow,
        shared: &HabitShared<'_>,
    ) -> Result<Self, FlowError> {
        Ok(Self {
            habit: read_habit(db, flow, Some(shared)).await?,
        })
    }
}

/// Every occurrence of one Habit within `horizon`, as rows, at `now`.
///
/// A flow with no Recurrence derives nothing. So does a commitment flow holding goal items: a
/// Commitment cannot parent a Goal, so such a template has no valid materialisation, and the load
/// names the flow rather than drawing a subtree the model forbids.
#[tracing::instrument(skip(db, flow), fields(flow_id = %flow.id))]
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
    flow_id: RowId,
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

#[cfg(test)]
mod tests;
