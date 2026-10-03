//! A Habit's occurrences, where they touch the database: reading a Habit's template, overlays
//! and relations ([`load_habit`]) and deriving its rows from them ([`derive_habit`]).
//!
//! What the rows *are* — which iterations exist, how each occurrence is built from its template
//! and overlay, its lifecycle and its blocks — is pure and lives in
//! [`crate::flows::rules::occurrences`]. Its names are re-exported here, so callers did not change
//! when it moved (ADR 0010).

use std::collections::{HashMap, HashSet};

use chrono::NaiveDateTime;

use super::{
    clock_slots,
    compound_readings::Readings,
    cooldown,
    error::FlowError,
    habit_cooldown,
    habits::{classify_iterations, expire_unanswered, SlotWindow},
    iteration_window,
    model::{Flow, FlowGoal, FlowId, FlowRecurrence, HabitIteration, IterationStatus, MissPolicy},
    parse_clock, resolve_root_plan, target_parent_type, verdict_deadlines,
};
use crate::{
    database::session::{Db, SessionMode},
    nodes::{
        key::{OccurrenceKey, TemplateItem, TemplateKind, NO_CYCLE},
        overlay::HabitOverlays,
    },
    scopes::key::ScopeKey,
    tasks::model::TimeScope,
};

use super::rules::occurrences::*;
pub(super) use super::rules::occurrences::{
    compound_items, occurrence_parents_of, CompletionInputs, LoadedHabit,
};
pub(crate) use super::rules::occurrences::{default_due, effective_tags};
pub use super::rules::occurrences::{DerivedRows, Horizon};

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

/// Each occurrence's parent occurrence within its iteration — where it nests, as the rows draw it:
/// under its parent item's **first** occurrence, or under the root. The root has none.
pub(super) async fn occurrence_parents<M: SessionMode>(
    db: &mut Db<M>,
    flow_id: FlowId,
    keys: &[InstanceKey],
) -> Result<HashMap<InstanceKey, InstanceKey>, FlowError> {
    let goals = db.flows().list_goals(flow_id).await?;
    let template = load_template(db, flow_id, goals).await?;
    Ok(template.occurrence_parents(flow_id, keys))
}

/// Reads what one Habit's rows are drawn from, or `None` when there is nothing to draw: a flow
/// with no Recurrence, or a commitment flow holding goal items — a Commitment cannot parent a
/// Goal, so such a template has no valid materialisation.
pub(super) async fn load_habit<M: SessionMode>(
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
    let (host_type, host_id) = match (&flow.target_type, flow.target_id) {
        (Some(kind), Some(id)) => (target_parent_type(kind), id),
        _ => (target_parent_type(&flow.parent_type), flow.parent_id),
    };
    let host_agentic = crate::tasks::agentic::reads_agentic(db, &host_type, host_id).await?;
    Ok(Some(LoadedHabit {
        clock: parse_clock(&recurrence)?,
        recurrence,
        template,
        overlays,
        relations,
        touched,
        host_agentic,
    }))
}

/// Every occurrence of one Habit within `horizon`, as rows, at `now`.
///
/// A flow with no Recurrence derives nothing. So does a commitment flow holding goal items: a
/// Commitment cannot parent a Goal, so such a template has no valid materialisation, and the load
/// names the flow rather than drawing a subtree the model forbids.
///
/// **This writes**: resolving iteration and cycle windows mints the scope rows they land on.
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
    let LoadedHabit {
        recurrence,
        template,
        overlays,
        relations,
        touched,
        host_agentic,
        ..
    } = &habit;
    let host_agentic = *host_agentic;

    let Schedule {
        iterations,
        slots,
        clock,
        holds,
    } = schedule(
        db,
        flow,
        recurrence,
        (overlays, &readings),
        touched,
        now,
        horizon,
    )
    .await?;
    let by_index: HashMap<i64, &SlotWindow> = slots.iter().map(|slot| (slot.index, slot)).collect();

    let mut rows = DerivedRows::default();
    for iteration in &iterations {
        let Some(slot) = by_index.get(&iteration.index) else {
            continue;
        };
        let window = iteration_window(flow, slot.scope_id)?;
        let window_start = window.as_ref().map(|(_, start)| *start);
        let window = window.map(|(window, _)| window);
        // What a Window + Overdue iteration carries: the first missed window's, which its
        // relevance reaches back to and its due is.
        let missed = iteration.missed_from.and_then(|index| by_index.get(&index));
        let carried = match missed {
            Some(missed) => iteration_window(flow, missed.scope_id)?.map(|(window, _)| window),
            None => None,
        };
        let relevance = match (&window, &carried) {
            (Some(own), Some(first)) => Some(TimeScope {
                start_id: first.start_id,
                end_id: own.end_id,
                duration: None,
            }),
            _ => window.clone(),
        };
        let due = default_due(
            clock,
            carried.as_ref().or(window.as_ref()).map(TimeScope::window),
        );
        let context = Iteration {
            iteration,
            slot,
            relevance,
            due,
            window_start,
            missed_from: missed.map(|missed| missed.start.date()),
            root_plan: resolve_root_plan(flow, window_start)?,
            cooling_until: holds.get(&slot.index).copied(),
            host_agentic,
            readings: &readings,
            provisional: false,
        };
        let built = build_iteration(flow, template, (overlays, relations), &context, clock, now)?;
        rows.extend(built);
    }
    Ok(rows)
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

/// The Habit's iterations within the horizon, each with the slot it came from, classified.
async fn schedule<M: SessionMode>(
    db: &mut Db<M>,
    flow: &Flow,
    recurrence: &FlowRecurrence,
    (overlays, readings): (&HabitOverlays, &Readings),
    touched: &HashSet<ScopeKey>,
    now: NaiveDateTime,
    horizon: Horizon,
) -> Result<Schedule, FlowError> {
    let clock = parse_clock(recurrence)?;

    // The furthest day anything asks for: now, the named window, and the latest touched date.
    let furthest = touched
        .iter()
        .map(ScopeKey::start_date)
        .chain(horizon.through)
        .max()
        .map_or(now, |date| {
            date.and_hms_opt(23, 59, 59).map_or(now, |end| end.max(now))
        });
    let template_keys = instance_keys(db, flow).await?;
    let parents = occurrence_parents(db, FlowId(flow.id), &template_keys).await?;
    let compound = compound_items(flow, &db.flows().list_tasks(FlowId(flow.id)).await?);
    let completions = Completions {
        keys: &template_keys,
        overlays,
        parents: &parents,
        compound: (&compound, readings),
        by_verdict: flow.instance_type == "commitment",
    };
    let slots = clock_slots(flow, recurrence, clock, furthest, |slot| {
        completions.completed_at(slot)
    })?;
    let (started, future): (Vec<SlotWindow>, Vec<SlotWindow>) =
        slots.iter().cloned().partition(|slot| slot.start <= now);

    let resolved = completions.resolutions(&started);
    let done = completions.finished(&started);
    // Settled: resolved, or — a commitment iteration — answered; neither is open to block.
    let mut settled = resolved.clone();
    settled.extend(done.iter().map(|(index, at)| (*index, *at)));
    let holds = cooldown::holds(
        &slots,
        (&settled, &done),
        habit_cooldown(flow, recurrence).zip(
            recurrence
                .miss_policy
                .as_deref()
                .and_then(MissPolicy::from_db),
        ),
        now,
    );
    let classified = classify_iterations(&started, clock, &resolved, now);
    let mut iterations =
        expire_unanswered(classified, &verdict_deadlines(flow, clock, &started), now);
    for slot in &future {
        let date = slot.start.date();
        let named = horizon.through.is_some_and(|through| date <= through);
        if named || touched.contains(&slot.scope_id) {
            iterations.push(HabitIteration {
                index: slot.index,
                anchor_scope_id: slot.scope_id,
                anchor_date: date.format("%Y-%m-%d").to_string(),
                window_end: slot.end.format("%Y-%m-%dT%H:%M:%S").to_string(),
                status: IterationStatus::Upcoming,
                missed_from: None,
                instances: Vec::new(),
            });
        }
    }
    Ok(Schedule {
        iterations,
        slots,
        clock,
        holds,
    })
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

/// Every instance one iteration holds, as `(template item, cycle pair)`: the root, then each item
/// once per pair it declares (once, with [`NO_CYCLE`], when it declares none).
async fn instance_keys<M: SessionMode>(
    db: &mut Db<M>,
    flow: &Flow,
) -> Result<Vec<(TemplateItem, i64)>, FlowError> {
    let flow_id = FlowId(flow.id);
    let items = db.flows().instance_items(flow_id).await?;
    let cycles = db.flows().cycles_by_item(flow_id).await?;
    let mut keys = vec![(
        TemplateItem {
            item_type: TemplateKind::FlowRoot,
            item_id: flow.id,
        },
        NO_CYCLE,
    )];
    for (item_type, item_id) in items {
        let Some(kind) = TemplateKind::from_db(&item_type) else {
            continue;
        };
        let item = TemplateItem {
            item_type: kind,
            item_id,
        };
        match cycles.get(&(item_type, item_id)) {
            Some(pairs) if !pairs.is_empty() => {
                keys.extend(pairs.iter().map(|pair| (item, pair.id)));
            }
            _ => keys.push((item, NO_CYCLE)),
        }
    }
    Ok(keys)
}
