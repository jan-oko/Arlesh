//! A Habit's occurrences, derived as **ordinary rows of their kinds** (ADR 0008).
//!
//! An iteration's root is a Task, Goal or Commitment — the flow's Instance Type — and each flow
//! item is a Task or Goal, once per cycle pair it declares. Each is its template with its
//! overlay applied ([`crate::nodes::overlay`]), keyed by `(template item, iteration scope,
//! cycle pair)` and carrying that key's UUID as its id. Nothing here is a second kind of node: a
//! derived Task is a [`Task`] with a Habit [`Origin`], and it goes wherever a Task goes.
//!
//! The recurrence rules stay the Habit's own. Which iterations exist, which are Lapsed, Missed or
//! Expired, and when an occurrence's own window opens, is [`super::habits`]' classification, run
//! over the same slots [`super::generate_habit_iterations`] uses; this module only turns its
//! answer into rows, with lifecycles to match.
//!
//! # The horizon
//!
//! Every iteration since the Habit began is derived: resolution, Lapsed/Missed, the run of missed
//! windows an open iteration carries, and an Interval Habit's chain all read the past. Of the future, only the iteration that is open now, any later iteration that
//! carries an overlay or an attached child — so an edit made to a future occurrence is never lost
//! — and any window a caller names ([`Horizon::through`]).

use std::collections::{HashMap, HashSet};

use chrono::{NaiveDate, NaiveDateTime};

use super::{
    clock_slots,
    error::FlowError,
    habits::{classify_iterations, expire_unanswered, instance_timing, Clock, SlotWindow},
    iteration_window,
    model::{
        Flow, FlowDependency, FlowGoal, FlowId, FlowItemCycle, FlowRecurrence, FlowTask,
        HabitIteration, InstanceTiming, IterationStatus, MissPolicy,
    },
    parse_clock, resolve_cycle, resolve_root_plan, target_parent_type, verdict_deadlines,
    whole_scope_plan,
};
use crate::{
    block_reasons::model::BlockReason,
    database::session::{Db, SessionMode},
    flows::template::TemplateFields,
    nodes::{
        id::NodeId,
        key::{DerivedKey, OccurrenceKey, TemplateItem, TemplateKind, NO_CYCLE},
        origin::{HabitOrigin, IterationScope, Origin},
        overlay::{CommitmentOverlay, GoalOverlay, HabitOverlays, TaskOverlay},
        registry,
        relations::TagDifferences,
    },
    scopes::{key::ScopeKey, resolve::Bounds},
    tasks::{
        lifecycle::{
            derive_commitment_state, derive_overdue, derive_timing, Archival, ItemLifecycle,
            Resolution, Timing,
        },
        model::{
            Commitment, Delegate, DurationSpec, Goal, OnScopeExit, Status, Task, TaskArchival,
            TaskDependencyEdge, TimeScope, Verdict,
        },
    },
};

/// How far into the future a Habit's occurrences are derived, beyond the iteration open now.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Horizon {
    /// The last day a caller has explicitly asked to see — the Plan View filling next month.
    pub through: Option<NaiveDate>,
}

/// Every row a set of Habits derives, by kind, with each row's lifecycle.
#[derive(Debug, Clone, Default)]
pub struct DerivedRows {
    /// Derived Tasks.
    pub tasks: Vec<Task>,
    /// Derived Goals.
    pub goals: Vec<Goal>,
    /// Derived Commitments.
    pub commitments: Vec<Commitment>,
    /// One lifecycle per derived row.
    pub lifecycles: Vec<ItemLifecycle>,
    /// Each derived Task's and Goal's effective block reasons, in order.
    pub block_reasons: Vec<BlockReason>,
    /// The dependency edges the template's own wiring draws between one iteration's occurrences,
    /// less any an occurrence removed.
    pub dependencies: Vec<TaskDependencyEdge>,
}

impl DerivedRows {
    /// Appends `other`'s rows to these.
    pub fn extend(&mut self, other: DerivedRows) {
        self.tasks.extend(other.tasks);
        self.goals.extend(other.goals);
        self.commitments.extend(other.commitments);
        self.lifecycles.extend(other.lifecycles);
        self.block_reasons.extend(other.block_reasons);
        self.dependencies.extend(other.dependencies);
    }
}

/// What one Habit's occurrences say about their relations, as differences against the template.
struct HabitRelations {
    /// Tag differences, by node key.
    tags: TagDifferences,
    /// Own block-reason lists, by node key.
    block_reasons: HashMap<String, Vec<String>>,
    /// Template edges an occurrence removed, as `(dependent key, target key)`.
    removed_edges: HashSet<(String, String)>,
    /// The template's own dependency wiring.
    template_edges: Vec<FlowDependency>,
}

/// The template's tags with one occurrence's differences applied.
pub(crate) fn effective_tags(template: &[i64], differences: Option<&Vec<(i64, bool)>>) -> Vec<i64> {
    let mut tags: Vec<i64> = template.to_vec();
    for (tag, added) in differences.map(Vec::as_slice).unwrap_or_default() {
        tags.retain(|existing| existing != tag);
        if *added {
            tags.push(*tag);
        }
    }
    tags.sort_unstable();
    tags
}

/// A Habit's template, as the rows are built from it.
struct Template {
    goals: HashMap<i64, FlowGoal>,
    tasks: HashMap<i64, FlowTask>,
    /// Each item's pairs, in position order; an item with none is absent.
    cycles: HashMap<(String, i64), Vec<FlowItemCycle>>,
}

impl Template {
    /// The cycle pair an item's **first** occurrence in an iteration is drawn by — where its
    /// children nest, as they do when the flow is started.
    fn first_cycle(&self, item_type: TemplateKind, item_id: i64) -> i64 {
        self.cycles
            .get(&(item_type.as_str().to_string(), item_id))
            .and_then(|pairs| pairs.first())
            .map_or(NO_CYCLE, |pair| pair.id)
    }

    /// The template row an item's occurrences nest under, or `None` for the root.
    fn parent_of(&self, item: TemplateItem) -> Option<TemplateItem> {
        let (parent_type, parent_id) = match item.item_type {
            TemplateKind::FlowGoal => self
                .goals
                .get(&item.item_id)
                .map(|goal| (&goal.parent_type, goal.parent_id))?,
            TemplateKind::FlowTask => self
                .tasks
                .get(&item.item_id)
                .map(|task| (&task.parent_type, task.parent_id))?,
            TemplateKind::FlowRoot => return None,
        };
        let parent = TemplateKind::from_db(parent_type)?;
        // An item naming a parent not in this template hangs on the root, the last resort the
        // renderer always gave it.
        let known = match parent {
            TemplateKind::FlowGoal => self.goals.contains_key(&parent_id),
            TemplateKind::FlowTask => self.tasks.contains_key(&parent_id),
            TemplateKind::FlowRoot => false,
        };
        known.then_some(TemplateItem {
            item_type: parent,
            item_id: parent_id,
        })
    }
}

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

/// A template as read: its goal and task items, and each item's cycle pairs in position order.
pub(super) type TemplateParts = (
    Vec<FlowGoal>,
    Vec<FlowTask>,
    HashMap<(String, i64), Vec<FlowItemCycle>>,
);

/// One occurrence within an iteration, as its template item and cycle pair.
pub(super) type InstanceKey = (TemplateItem, i64);

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

/// [`occurrence_parents`] from a template already read: its goal and task items, and each item's
/// cycle pairs in position order.
pub(super) fn occurrence_parents_of(
    flow_id: FlowId,
    (goals, tasks, cycles): TemplateParts,
    keys: &[InstanceKey],
) -> HashMap<InstanceKey, InstanceKey> {
    Template {
        goals: goals.into_iter().map(|goal| (goal.id, goal)).collect(),
        tasks: tasks.into_iter().map(|task| (task.id, task)).collect(),
        cycles,
    }
    .occurrence_parents(flow_id, keys)
}

impl Template {
    fn occurrence_parents(
        &self,
        flow_id: FlowId,
        keys: &[InstanceKey],
    ) -> HashMap<InstanceKey, InstanceKey> {
        let root = (
            TemplateItem {
                item_type: TemplateKind::FlowRoot,
                item_id: flow_id.0,
            },
            NO_CYCLE,
        );
        keys.iter()
            .filter(|(item, _)| item.item_type != TemplateKind::FlowRoot)
            .map(|&key| {
                let parent = self.parent_of(key.0).map_or(root, |parent| {
                    (parent, self.first_cycle(parent.item_type, parent.item_id))
                });
                (key, parent)
            })
            .collect()
    }
}

/// The occurrences of one iteration **set aside** by an archive: every one archived by hand, and
/// every one it holds, however deep — an archived root sets aside the whole iteration, and an
/// archived occurrence the children nested under it. Set aside, an occurrence reads as archived
/// and no longer has to be done for its iteration to resolve, as archiving any node takes its
/// subtree with it. Nothing is written to what it holds, and nothing is taken from the template.
pub fn set_aside(
    keys: &[InstanceKey],
    archived: &HashSet<InstanceKey>,
    parents: &HashMap<InstanceKey, InstanceKey>,
) -> HashSet<InstanceKey> {
    keys.iter()
        .filter(|key| {
            let mut current = Some(**key);
            // Bounded by the key count: a malformed hierarchy cannot loop.
            for _ in 0..=keys.len() {
                let Some(step) = current else {
                    return false;
                };
                if archived.contains(&step) {
                    return true;
                }
                current = parents.get(&step).copied();
            }
            false
        })
        .copied()
        .collect()
}

/// What a Habit's rows are built from, per iteration, beside the template.
struct Iteration<'a> {
    iteration: &'a HabitIteration,
    slot: &'a SlotWindow,
    /// The root's relevance: the iteration's window as a Time Scope — reaching back to the first
    /// missed window when it carries a run of Missed ones (Window + Overdue) — or `None` for an
    /// Unscoped Interval Habit's, which has no window.
    relevance: Option<TimeScope>,
    /// When the root, and every occurrence that shares its window, is due by its Habit's clock —
    /// before any explicit due in an overlay (see [`default_due`]).
    due: Option<Bounds>,
    /// The first day of the iteration's own window, which Cycle Scopes are offsets into; `None`
    /// when the Habit is Unscoped.
    window_start: Option<NaiveDate>,
    /// The first day of the first missed window this iteration carries, under Window + Overdue.
    missed_from: Option<NaiveDate>,
    /// The root's Cycle Plan resolved in this iteration, when the flow carries one.
    root_plan: Option<TimeScope>,
    /// Whether the Habit's host reads as Agentic — what an occurrence with no flag of its own, or
    /// above it in the template tree, reads as.
    host_agentic: bool,
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
    let flow_id = FlowId(flow.id);
    let Some(recurrence) = db.flows().get_recurrence(flow_id).await? else {
        return Ok(DerivedRows::default());
    };
    let goals = db.flows().list_goals(flow_id).await?;
    if flow.instance_type == "commitment" && !goals.is_empty() {
        return Ok(DerivedRows::default());
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

    let (iterations, slots, clock) =
        schedule(db, flow, &recurrence, &overlays, &touched, now, horizon).await?;
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
            host_agentic,
        };
        let built = build_iteration(
            flow,
            &template,
            (&overlays, &relations),
            &context,
            clock,
            now,
        )?;
        rows.extend(built);
    }
    Ok(rows)
}

/// When an occurrence whose window is `window` is due by its Habit's clock, before any explicit
/// due in its overlay (ruled by the user, 2026-09-30):
///
/// - **Window + Archive**: never — a missed occurrence lapses and archives instead.
/// - **Window + Owed**: its own window.
/// - **Window + Overdue**: its own window, or — for the iteration carrying a run of Missed ones,
///   and every occurrence sharing its window — the first missed window, which the caller passes.
/// - **Interval**: its window; none when the Habit is Unscoped, since there is none.
pub(crate) fn default_due(clock: Clock, window: Option<Bounds>) -> Option<Bounds> {
    match clock {
        Clock::Window(MissPolicy::Archive) => None,
        Clock::Window(MissPolicy::Owed | MissPolicy::Overdue) | Clock::Interval => window,
    }
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
    overlays: &HabitOverlays,
    touched: &HashSet<ScopeKey>,
    now: NaiveDateTime,
    horizon: Horizon,
) -> Result<(Vec<HabitIteration>, Vec<SlotWindow>, Clock), FlowError> {
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
    let completions = Completions {
        keys: &template_keys,
        overlays,
        parents: &parents,
    };
    let slots = clock_slots(flow, recurrence, clock, furthest, |slot| {
        completions.completed_at(slot)
    })?;
    let (started, future): (Vec<SlotWindow>, Vec<SlotWindow>) =
        slots.iter().cloned().partition(|slot| slot.start <= now);

    let resolved = completions.resolutions(&started);
    let classified = classify_iterations(&started, clock, &resolved, now);
    let mut iterations = expire_unanswered(classified, &verdict_deadlines(flow, &started), now);
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
    Ok((iterations, slots, clock))
}

/// What decides whether one of a Habit's iterations is complete, read once and asked of each
/// iteration: every instance an iteration holds, where each nests, and what their overlays record.
pub(super) struct Completions<'a> {
    /// Every instance one iteration holds.
    pub(super) keys: &'a [InstanceKey],
    /// The Habit's overlays.
    pub(super) overlays: &'a HabitOverlays,
    /// Each instance's parent instance.
    pub(super) parents: &'a HashMap<InstanceKey, InstanceKey>,
}

impl Completions<'_> {
    /// Each of `slots` that is complete, with the instant it was — see [`resolutions`].
    pub(super) fn resolutions(&self, slots: &[SlotWindow]) -> HashMap<i64, NaiveDateTime> {
        resolutions(slots, self.keys, self.overlays, self.parents)
    }

    /// The instant the iteration in `slot` was completed, or `None` while it is not.
    pub(super) fn completed_at(&self, slot: &SlotWindow) -> Option<NaiveDateTime> {
        self.resolutions(std::slice::from_ref(slot))
            .get(&slot.index)
            .copied()
    }
}

/// [`Completions`]' inputs, owned — what [`super::FlowOperator`] reads for a Habit that has not
/// been read whole.
pub(super) struct CompletionInputs {
    /// Every instance one iteration holds.
    pub(super) keys: Vec<InstanceKey>,
    /// The Habit's overlays.
    pub(super) overlays: HabitOverlays,
    /// Each instance's parent instance.
    pub(super) parents: HashMap<InstanceKey, InstanceKey>,
}

impl CompletionInputs {
    /// Borrows these as [`Completions`].
    fn completions(&self) -> Completions<'_> {
        Completions {
            keys: &self.keys,
            overlays: &self.overlays,
            parents: &self.parents,
        }
    }

    /// Each of `slots` that is complete, with the instant it was.
    pub(super) fn resolutions(&self, slots: &[SlotWindow]) -> HashMap<i64, NaiveDateTime> {
        self.completions().resolutions(slots)
    }

    /// The instant the iteration in `slot` was completed, or `None` while it is not.
    pub(super) fn completed_at(&self, slot: &SlotWindow) -> Option<NaiveDateTime> {
        self.completions().completed_at(slot)
    }
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

/// Maps each started slot to the instant its iteration was completed — present only when every
/// one of its instances is done and none is tombstoned. A root Commitment is never *done*: a
/// verdict is an answer, not a completion.
pub(super) fn resolutions(
    slots: &[SlotWindow],
    keys: &[InstanceKey],
    overlays: &HabitOverlays,
    parents: &HashMap<InstanceKey, InstanceKey>,
) -> HashMap<i64, NaiveDateTime> {
    let mut resolved = HashMap::new();
    for slot in slots {
        let iteration = slot.scope_id;
        let mut latest: Option<i64> = None;
        let mut every = true;
        // What an archive set aside no longer has to be done.
        let archived: HashSet<InstanceKey> = keys
            .iter()
            .filter(|(item, cycle)| {
                let node_key = OccurrenceKey {
                    item: *item,
                    iteration,
                    cycle: *cycle,
                }
                .node_key();
                archived_by_hand(overlays, &node_key)
            })
            .copied()
            .collect();
        let aside = set_aside(keys, &archived, parents);
        for (item, cycle) in keys.iter().filter(|key| !aside.contains(*key)) {
            let node_key = OccurrenceKey {
                item: *item,
                iteration,
                cycle: *cycle,
            }
            .node_key();
            let done_at = overlays
                .tasks
                .get(&node_key)
                .filter(|overlay| {
                    overlay.tombstone.is_none()
                        && overlay
                            .status
                            .as_deref()
                            .and_then(Status::from_db)
                            .is_some_and(|status| status.is_done())
                })
                .map(|overlay| overlay.resolved_at)
                .or_else(|| {
                    overlays
                        .goals
                        .get(&node_key)
                        .filter(|overlay| {
                            overlay.tombstone.is_none()
                                && overlay.status.as_deref() == Some("achieved")
                        })
                        .map(|overlay| overlay.resolved_at)
                });
            match done_at {
                Some(at) => latest = latest.max(at),
                None => {
                    every = false;
                    break;
                }
            }
        }
        if every {
            // `resolved_at` is epoch-ms, read as a UTC-naive instant for classification.
            let instant = latest
                .and_then(chrono::DateTime::from_timestamp_millis)
                .map_or(slot.end, |instant| instant.naive_utc());
            resolved.insert(slot.index, instant);
        }
    }
    resolved
}

/// Whether the occurrence under `node_key` was archived by hand, whichever kind it draws.
fn archived_by_hand(overlays: &HabitOverlays, node_key: &str) -> bool {
    let archived = |tombstone: &Option<String>| tombstone.as_deref() == Some("archived");
    overlays
        .tasks
        .get(node_key)
        .is_some_and(|overlay| archived(&overlay.tombstone))
        || overlays
            .goals
            .get(node_key)
            .is_some_and(|overlay| archived(&overlay.tombstone))
        || overlays
            .commitments
            .get(node_key)
            .is_some_and(|overlay| archived(&overlay.tombstone))
}

/// The kind a template item's occurrences are, for the flow's Instance Type.
fn occurrence_kind(flow: &Flow, item: TemplateKind) -> &'static str {
    match item {
        TemplateKind::FlowGoal => "goal",
        TemplateKind::FlowTask => "task",
        TemplateKind::FlowRoot => match flow.instance_type.as_str() {
            "goal" => "goal",
            "commitment" => "commitment",
            _ => "task",
        },
    }
}

/// What one occurrence is, before it is turned into a row of its kind.
struct Occurrence {
    key: OccurrenceKey,
    kind: &'static str,
    parent_type: String,
    parent_id: NodeId,
    title: String,
    position: i64,
    is_private: bool,
    time_scope: Option<TimeScope>,
    plan: Option<TimeScope>,
    /// When it is due by its Habit's clock, before any explicit due in its overlay.
    due: Option<Bounds>,
    timing: InstanceTiming,
    /// Whether being done finishes it for good: its own window has passed, and no verdict is still
    /// owed over it. See [`settled_timing`].
    closes_when_done: bool,
    origin: Origin,
    /// The occurrence it hangs under within the iteration; `None` for the iteration's root, which
    /// hangs on the Habit's host.
    parent_key: Option<OccurrenceKey>,
    /// What the template says beyond its title and place.
    fields: TemplateFields,
}

/// Every row one iteration derives: its root, then each item's occurrences.
fn build_iteration(
    flow: &Flow,
    template: &Template,
    (overlays, relations): (&HabitOverlays, &HabitRelations),
    context: &Iteration<'_>,
    clock: Clock,
    now: NaiveDateTime,
) -> Result<DerivedRows, FlowError> {
    let date = context.slot.start.date();
    let iteration = context.slot.scope_id;
    let iteration_scope = IterationScope {
        index: context.iteration.index,
        start_date: date,
        window_end: context.slot.end,
        scope_id: context.slot.scope_id,
        kind: flow
            .flow_window_part
            .as_ref()
            .map(|_| "part".to_string())
            .or_else(|| flow.flow_duration_kind.clone()),
        status: context.iteration.status,
        missed_from: context.missed_from,
        owed: owed(flow, clock, context, now),
    };
    let origin_of = |item: TemplateItem, cycle: i64| {
        Origin::Habit(HabitOrigin {
            habit_id: flow.id,
            iteration_scope: iteration_scope.clone(),
            item_type: item.item_type,
            item_id: item.item_id,
            cycle_id: cycle,
        })
    };

    let root_item = TemplateItem {
        item_type: TemplateKind::FlowRoot,
        item_id: flow.id,
    };
    let root_key = OccurrenceKey {
        item: root_item,
        iteration,
        cycle: NO_CYCLE,
    };
    let (host_type, host_id) = match (&flow.target_type, flow.target_id) {
        (Some(kind), Some(id)) => (target_parent_type(kind), id),
        _ => (target_parent_type(&flow.parent_type), flow.parent_id),
    };
    let root_timing = match context.iteration.status {
        IterationStatus::Upcoming => InstanceTiming::Pending,
        IterationStatus::Lapsed | IterationStatus::Missed => InstanceTiming::Lapsed,
        _ => InstanceTiming::Active,
    };
    // A commitment Habit's work is answered for by the verdict, which its Verdict Window bounds;
    // nothing it generates is finished by its window passing.
    let verdict_owed = flow.instance_type == "commitment";
    // An Unscoped Interval Habit's instances have no window to pass: a done one is finished once
    // its iteration is — by then the next instance has taken its place.
    let iteration_done = context.iteration.status == IterationStatus::Done;
    let unscoped = context.window_start.is_none();
    let window_passed =
        |end: NaiveDateTime| !verdict_owed && if unscoped { iteration_done } else { end <= now };
    let mut occurrences = vec![Occurrence {
        key: root_key,
        kind: occurrence_kind(flow, TemplateKind::FlowRoot),
        parent_type: host_type,
        parent_id: NodeId::Stored(host_id),
        title: flow.title.clone(),
        position: context.iteration.index,
        is_private: flow.is_private,
        time_scope: context.relevance.clone(),
        plan: context.root_plan.clone(),
        due: context.due,
        timing: root_timing,
        // The root closes with its iteration: only a Done iteration's root is finished, so a root
        // ticked off above work still open keeps that work company.
        closes_when_done: iteration_done && window_passed(context.slot.end),
        origin: origin_of(root_item, NO_CYCLE),
        parent_key: None,
        fields: flow.template.clone(),
    }];

    // Each item, once per cycle pair, resolved against this iteration's window start.
    let no_pairs: Vec<FlowItemCycle> = Vec::new();
    let items = template
        .goals
        .values()
        .map(|goal| {
            (
                TemplateKind::FlowGoal,
                goal.id,
                &goal.title,
                goal.position,
                goal.is_private,
                &goal.template,
            )
        })
        .chain(template.tasks.values().map(|task| {
            (
                TemplateKind::FlowTask,
                task.id,
                &task.title,
                task.position,
                task.is_private,
                &task.template,
            )
        }));
    let mut items: Vec<_> = items.collect();
    items.sort_by_key(|(kind, id, _, position, _, _)| (*position, *kind, *id));
    for (item_type, item_id, title, position, is_private, fields) in items {
        let item = TemplateItem { item_type, item_id };
        let parent = match template.parent_of(item) {
            Some(parent) => OccurrenceKey {
                item: parent,
                iteration,
                cycle: template.first_cycle(parent.item_type, parent.item_id),
            },
            None => root_key,
        };
        let parent_kind = occurrence_kind(flow, parent.item.item_type);
        let pairs = template
            .cycles
            .get(&(item_type.as_str().to_string(), item_id))
            .unwrap_or(&no_pairs);
        let mut draws: Vec<Option<&FlowItemCycle>> = pairs.iter().map(Some).collect();
        if draws.is_empty() {
            draws.push(None);
        }
        for pair in draws {
            let resolved = resolve_cycle(pair, context.window_start)?;
            // A pair with a Cycle Scope of its own is due by that window; one with none shares
            // the root's window, and its due with it.
            let (time_scope, plan, window, due) = match resolved {
                Some(resolved) => {
                    let bounds = resolved.scope.bounds();
                    let due = default_due(clock, Some(bounds));
                    (Some(resolved.time_scope), resolved.plan, bounds, due)
                }
                None => (
                    None,
                    whole_scope_plan(pair, context.window_start)?,
                    (context.slot.start, context.slot.end),
                    context.due,
                ),
            };
            let cycle = pair.map_or(NO_CYCLE, |pair| pair.id);
            occurrences.push(Occurrence {
                key: OccurrenceKey {
                    item,
                    iteration,
                    cycle,
                },
                kind: occurrence_kind(flow, item_type),
                parent_type: parent_kind.to_string(),
                parent_id: NodeId::Derived(parent.id()),
                title: title.clone(),
                position,
                is_private,
                time_scope,
                plan,
                due,
                timing: instance_timing(clock, context.iteration.status, window, now),
                closes_when_done: window_passed(window.1),
                origin: origin_of(item, cycle),
                parent_key: Some(parent),
                fields: fields.clone(),
            });
        }
    }

    let mut rows = DerivedRows {
        dependencies: template_edges(flow, &occurrences, relations),
        ..DerivedRows::default()
    };
    let expired = context.iteration.status == IterationStatus::Expired;
    let aside = held_by_an_archive(&occurrences, overlays);
    let kinds = occurrence_kinds(&occurrences, overlays, context.host_agentic);
    for occurrence in occurrences {
        registry::remember(&DerivedKey::Occurrence(occurrence.key));
        let node_key = occurrence.key.node_key();
        let tag_ids = effective_tags(&occurrence.fields.tag_ids, relations.tags.get(&node_key));
        let own_reasons = relations
            .block_reasons
            .get(&node_key)
            .cloned()
            .unwrap_or_default();
        let template_reasons = occurrence.fields.block_reasons.clone();
        let reasons_of = |own: bool| {
            if own {
                own_reasons.clone()
            } else {
                template_reasons.clone()
            }
        };
        match occurrence.kind {
            "goal" => {
                let overlay = overlays.goals.get(&node_key).cloned().unwrap_or_default();
                let reasons = reasons_of(overlay.block_reasons_set);
                let due = occurrence.due;
                let (mut goal, mut lifecycle) = goal_row(occurrence, overlay, clock, expired);
                archive_if_held(&mut lifecycle, &aside, &node_key);
                let achieved = goal.status == "achieved" || goal.status == "archived";
                lifecycle.overdue = derive_overdue(due, achieved, lifecycle.archival, now);
                goal.tag_ids = tag_ids;
                push_reasons(&mut rows.block_reasons, "goal", &goal.id, reasons);
                rows.goals.push(goal);
                rows.lifecycles.push(lifecycle);
            }
            "commitment" => {
                let overlay = overlays
                    .commitments
                    .get(&node_key)
                    .cloned()
                    .unwrap_or_default();
                let window = (context.slot.start, context.slot.end);
                let (mut commitment, mut lifecycle) =
                    commitment_row(flow, occurrence, overlay, window, now);
                archive_if_held(&mut lifecycle, &aside, &node_key);
                commitment.tag_ids = tag_ids;
                rows.commitments.push(commitment);
                rows.lifecycles.push(lifecycle);
            }
            _ => {
                let overlay = overlays.tasks.get(&node_key).cloned().unwrap_or_default();
                let reasons = reasons_of(overlay.block_reasons_set);
                let default = occurrence.due;
                let agentic = kinds.get(&node_key).copied().unwrap_or(false);
                let (mut task, mut lifecycle) =
                    task_row(occurrence, overlay, clock, expired, agentic);
                archive_if_held(&mut lifecycle, &aside, &node_key);
                let due = occurrence_due(&task, default);
                lifecycle.overdue =
                    derive_overdue(due, task.status.is_done(), lifecycle.archival, now);
                // Its own Expectation template, kept only while it is Asynchronous.
                if task.asynchronous {
                    task.async_template = overlays.async_templates.get(&node_key).cloned();
                }
                if let Some(plan) = &task.plan {
                    lifecycle.plan_timing = Some(derive_timing(Some(plan.window()), now));
                }
                task.tag_ids = tag_ids;
                push_reasons(&mut rows.block_reasons, "task", &task.id, reasons);
                rows.tasks.push(task);
                rows.lifecycles.push(lifecycle);
            }
        }
    }
    Ok(rows)
}

/// Whether an iteration is **owed** work: under Window + Owed, its window has passed and it is
/// still open (unfinished, so Active). The board draws it outside the Habit's folded history
/// (ruled by the user, 2026-10-01). Not a commitment Habit's: an unanswered night is a verdict
/// still owed, which its Verdict Window already bounds, not open work.
fn owed(flow: &Flow, clock: Clock, context: &Iteration<'_>, now: NaiveDateTime) -> bool {
    clock == Clock::Window(MissPolicy::Owed)
        && flow.instance_type != "commitment"
        && context.iteration.status == IterationStatus::Active
        && context.slot.end <= now
}

/// The node keys of one iteration's occurrences an archive holds: each one archived by hand, and
/// everything nested under it — see [`set_aside`].
fn held_by_an_archive(occurrences: &[Occurrence], overlays: &HabitOverlays) -> HashSet<String> {
    let by_id: HashMap<NodeId, InstanceKey> = occurrences
        .iter()
        .map(|occurrence| {
            (
                NodeId::Derived(occurrence.key.id()),
                (occurrence.key.item, occurrence.key.cycle),
            )
        })
        .collect();
    let keys: Vec<InstanceKey> = by_id.values().copied().collect();
    let parents: HashMap<InstanceKey, InstanceKey> = occurrences
        .iter()
        .filter_map(|occurrence| {
            let parent = by_id.get(&occurrence.parent_id)?;
            Some(((occurrence.key.item, occurrence.key.cycle), *parent))
        })
        .collect();
    let archived: HashSet<InstanceKey> = occurrences
        .iter()
        .filter(|occurrence| archived_by_hand(overlays, &occurrence.key.node_key()))
        .map(|occurrence| (occurrence.key.item, occurrence.key.cycle))
        .collect();
    let aside = set_aside(&keys, &archived, &parents);
    occurrences
        .iter()
        .filter(|occurrence| aside.contains(&(occurrence.key.item, occurrence.key.cycle)))
        .map(|occurrence| occurrence.key.node_key())
        .collect()
}

/// Reads an occurrence an archive holds as archived, as a stored node under an archived one is.
fn archive_if_held(lifecycle: &mut ItemLifecycle, aside: &HashSet<String>, node_key: &str) {
    if aside.contains(node_key) {
        lifecycle.archival = Archival::Archived;
    }
}

/// Appends one derived row's block reasons, in order, as the rows the load carries.
fn push_reasons(out: &mut Vec<BlockReason>, kind: &str, id: &NodeId, reasons: Vec<String>) {
    for (position, reason) in reasons.into_iter().enumerate() {
        out.push(BlockReason {
            owner_type: kind.to_string(),
            owner_id: id.clone(),
            reason,
            position: i64::try_from(position).unwrap_or(i64::MAX),
            derived: None,
        });
    }
}

/// The dependency edges a template's own wiring draws between one iteration's occurrences: every
/// occurrence of a dependent task item waits on every occurrence of the item it depends on — the
/// fan-in a started flow is wired with — unless the occurrence removed that edge.
fn template_edges(
    flow: &Flow,
    occurrences: &[Occurrence],
    relations: &HabitRelations,
) -> Vec<TaskDependencyEdge> {
    let of_item = |item_type: &str, item_id: i64| {
        occurrences
            .iter()
            .filter(move |occurrence| {
                occurrence.key.item.item_type.as_str() == item_type
                    && occurrence.key.item.item_id == item_id
            })
            .collect::<Vec<_>>()
    };
    let mut edges = Vec::new();
    for edge in &relations.template_edges {
        if edge.dependent_type != "flow_task" {
            continue;
        }
        let blockers = of_item(&edge.depends_on_type, edge.depends_on_id);
        for dependent in of_item(&edge.dependent_type, edge.dependent_id) {
            for blocker in &blockers {
                let removed = relations
                    .removed_edges
                    .contains(&(dependent.key.node_key(), blocker.key.node_key()));
                if removed {
                    continue;
                }
                edges.push(TaskDependencyEdge {
                    task_id: NodeId::Derived(dependent.key.id()),
                    dependency_type: occurrence_kind(flow, blocker.key.item.item_type).to_string(),
                    dependency_id: NodeId::Derived(blocker.key.id()),
                });
            }
        }
    }
    edges
}

/// The On-exit behaviour an occurrence with a window of its own reads: Archive under Window +
/// Archive, Keep Overdue under every other clock.
fn on_exit(clock: Clock, time_scope: &Option<TimeScope>) -> Option<OnScopeExit> {
    time_scope.as_ref().map(|_| {
        if clock.lapses_on_exit() {
            OnScopeExit::Archive
        } else {
            OnScopeExit::Keep
        }
    })
}

/// An occurrence's timing once whether it is done is known.
///
/// [`instance_timing`] places an occurrence by its window and its Habit's clock alone, and under
/// every clock but Window + Archive a passed window leaves it Active — which is right for
/// *unfinished* work, which stays open and comes due. Done work does not pile up: a done
/// occurrence whose window has passed is Lapsed whatever the clock, so it resolves Completed and archives, exactly as a
/// stored Task or Goal does (`docs/spec/time-scopes.md`, On-exit behavior).
fn settled_timing(timing: InstanceTiming, done: bool, closes_when_done: bool) -> InstanceTiming {
    if done && closes_when_done {
        return InstanceTiming::Lapsed;
    }
    timing
}

/// The due a Task occurrence is judged **Overdue** against: an explicit due in its overlay wins;
/// otherwise the default its Habit's clock gives it ([`default_due`]) — unless it is backlogged,
/// since work deliberately set aside is not late, exactly as for a stored Task.
fn occurrence_due(task: &Task, default: Option<Bounds>) -> Option<Bounds> {
    crate::tasks::lifecycle::effective_due(
        task.due_scope.as_ref().map(TimeScope::window),
        default.map(|window| (window, OnScopeExit::Keep)),
        task.archival == TaskArchival::Backlog,
    )
}

/// A Task or Goal occurrence's lifecycle, by the Habit's rules: pending until its window opens,
/// active while it is open, and once past — Lapsed under Window + Archive, with its iteration Lapsed or
/// Missed, or done (see [`settled_timing`]) — archived as a unit, Completed if it was done and
/// Missed if not. An iteration whose Verdict Window ran out (a commitment Habit's supporting
/// steps) is archived with no Resolution at all. A tombstone archives it by hand; a Backlog shows
/// while it is live. The Overdue flag is the caller's, once everything that can archive the
/// occurrence has had its say.
fn work_lifecycle(
    kind: &str,
    id: NodeId,
    timing: InstanceTiming,
    done: bool,
    expired: bool,
    tombstoned: bool,
    backlogged: bool,
) -> ItemLifecycle {
    let (timing, resolution, archived) = if expired {
        (Timing::Lapsed, None, true)
    } else {
        match timing {
            InstanceTiming::Pending => (Timing::Pending, None, false),
            InstanceTiming::Active => (Timing::Active, None, false),
            InstanceTiming::Lapsed => (
                Timing::Lapsed,
                Some(if done {
                    Resolution::Completed
                } else {
                    Resolution::Missed
                }),
                true,
            ),
        }
    };
    let archival = if archived || tombstoned {
        Archival::Archived
    } else if backlogged {
        Archival::Backlog
    } else {
        Archival::Live
    };
    ItemLifecycle {
        node_type: kind.to_string(),
        node_id: id,
        timing,
        resolution,
        overdue: false,
        verdict: None,
        archival,
        archival_conflict: archived && backlogged,
        plan_timing: None,
    }
}

/// What each occurrence of one iteration reads as for Agentic, by node key — the tree the app
/// draws, as `tasks::agentic` climbs it: its own value (its overlay's, else its template's), else
/// the occurrence it hangs under, else — for the iteration's root — the Habit's host.
///
/// It decides which status model a Task occurrence holds.
fn occurrence_kinds(
    occurrences: &[Occurrence],
    overlays: &HabitOverlays,
    host_agentic: bool,
) -> HashMap<String, bool> {
    let by_key: HashMap<String, &Occurrence> = occurrences
        .iter()
        .map(|occurrence| (occurrence.key.node_key(), occurrence))
        .collect();
    let own = |occurrence: &Occurrence| -> Option<bool> {
        match overlays.tasks.get(&occurrence.key.node_key()) {
            Some(overlay) if overlay.agentic_set => overlay.agentic,
            _ => occurrence.fields.agentic,
        }
    };
    let mut kinds: HashMap<String, bool> = HashMap::new();
    for occurrence in occurrences {
        let mut chain: Vec<String> = Vec::new();
        let mut cursor = Some(occurrence);
        let mut reads = host_agentic;
        while let Some(at) = cursor {
            let key = at.key.node_key();
            if let Some(known) = kinds.get(&key) {
                reads = *known;
                break;
            }
            if chain.contains(&key) {
                break;
            }
            chain.push(key);
            if let Some(flag) = own(at) {
                reads = flag;
                break;
            }
            cursor = at
                .parent_key
                .and_then(|parent| by_key.get(&parent.node_key()).copied());
        }
        for key in chain {
            kinds.insert(key, reads);
        }
    }
    kinds
}

/// The status a Task occurrence's overlay holds, in the model it reads as: none is the To Do of
/// that model.
fn occurrence_status(overlay: &TaskOverlay, agentic: bool) -> Status {
    match overlay.status.as_deref() {
        None => Status::todo(agentic),
        Some(stored) => Status::from_db(stored).unwrap_or_else(|| {
            tracing::warn!(
                status = stored,
                "an occurrence overlay holds an unknown status"
            );
            Status::todo(agentic)
        }),
    }
}

/// A Task occurrence: its template overlaid. `agentic` is what it reads as, which decides the
/// model its status is in.
fn task_row(
    occurrence: Occurrence,
    overlay: TaskOverlay,
    clock: Clock,
    expired: bool,
    agentic: bool,
) -> (Task, ItemLifecycle) {
    let id = NodeId::Derived(occurrence.key.id());
    let status = occurrence_status(&overlay, agentic);
    let archival = overlay
        .archival
        .as_deref()
        .and_then(TaskArchival::from_db)
        .unwrap_or(occurrence.fields.archival);
    let plan = if overlay.plan_set {
        overlay
            .plan_start_id
            .zip(overlay.plan_end_id)
            .map(|(start_id, end_id)| TimeScope {
                start_id,
                end_id,
                duration: None,
            })
    } else {
        occurrence.plan
    };
    let delegate_to = if overlay.delegate_set {
        Delegate::from_columns(overlay.delegate_kind.as_deref(), overlay.delegate_id)
    } else {
        occurrence.fields.delegate_to
    };
    let done = status.is_done();
    let lifecycle = work_lifecycle(
        "task",
        id.clone(),
        settled_timing(occurrence.timing, done, occurrence.closes_when_done),
        done,
        expired,
        overlay.tombstone.is_some(),
        archival == TaskArchival::Backlog,
    );
    let task = Task {
        id,
        title: overlay.title.clone().unwrap_or(occurrence.title),
        parent_type: occurrence.parent_type,
        parent_id: occurrence.parent_id,
        status,
        delegate_to,
        agentic: if overlay.agentic_set {
            overlay.agentic
        } else {
            occurrence.fields.agentic
        },
        asynchronous: overlay
            .asynchronous
            .unwrap_or(occurrence.fields.asynchronous),
        // Only a stored Task carries Compound; an occurrence keeps its own status.
        compound: false,
        async_template: None,
        // The template's brief, field by field, under the occurrence's own.
        agentic_brief: overlay.brief_over(occurrence.fields.agentic_brief.as_ref()),
        on_scope_exit: on_exit(clock, &occurrence.time_scope),
        time_scope: occurrence.time_scope,
        plan,
        due_scope: overlay
            .due_scope_start_id
            .zip(overlay.due_scope_end_id)
            .map(|(start_id, end_id)| TimeScope {
                start_id,
                end_id,
                duration: None,
            }),
        archival,
        tag_ids: occurrence.fields.tag_ids.clone(),
        position: overlay.position.unwrap_or(occurrence.position),
        is_private: overlay.is_private.unwrap_or(occurrence.is_private),
        beads_id: if overlay.beads_id_set {
            overlay.beads_id
        } else {
            occurrence.fields.beads_id.clone()
        },
        origin: occurrence.origin,
    };
    (task, lifecycle)
}

/// A Goal occurrence: its template overlaid.
fn goal_row(
    occurrence: Occurrence,
    overlay: GoalOverlay,
    clock: Clock,
    expired: bool,
) -> (Goal, ItemLifecycle) {
    let id = NodeId::Derived(occurrence.key.id());
    let status = overlay
        .status
        .clone()
        .unwrap_or_else(|| "active".to_string());
    let done = status == "achieved" || status == "archived";
    let lifecycle = work_lifecycle(
        "goal",
        id.clone(),
        settled_timing(occurrence.timing, done, occurrence.closes_when_done),
        done,
        expired,
        overlay.tombstone.is_some(),
        false,
    );
    let goal = Goal {
        id,
        title: overlay.title.clone().unwrap_or(occurrence.title),
        parent_type: occurrence.parent_type,
        parent_id: occurrence.parent_id,
        status,
        on_scope_exit: on_exit(clock, &occurrence.time_scope),
        time_scope: occurrence.time_scope,
        tag_ids: occurrence.fields.tag_ids.clone(),
        position: overlay.position.unwrap_or(occurrence.position),
        is_private: overlay.is_private.unwrap_or(occurrence.is_private),
        beads_id: if overlay.beads_id_set {
            overlay.beads_id
        } else {
            occurrence.fields.beads_id.clone()
        },
        origin: occurrence.origin,
    };
    (goal, lifecycle)
}

/// A commitment Habit's iteration root: a Commitment over the iteration's window, answerable for
/// the Habit's Verdict Window, derived exactly as a stored Commitment's lifecycle is.
fn commitment_row(
    flow: &Flow,
    occurrence: Occurrence,
    overlay: CommitmentOverlay,
    window: (NaiveDateTime, NaiveDateTime),
    now: NaiveDateTime,
) -> (Commitment, ItemLifecycle) {
    let id = NodeId::Derived(occurrence.key.id());
    let verdict = overlay
        .verdict
        .as_deref()
        .and_then(Verdict::from_db)
        .unwrap_or(Verdict::Unresolved);
    let verdict_window = flow
        .verdict_window_n
        .zip(flow.verdict_window_kind.clone())
        .map(|(n, kind)| DurationSpec { n, kind });
    let state = derive_commitment_state(Some(window), verdict, verdict_window.as_ref(), now);
    let lifecycle = ItemLifecycle {
        node_type: "commitment".to_string(),
        node_id: id.clone(),
        timing: state.timing,
        resolution: None,
        // Nothing on a Commitment comes due: it is judged by its Verdict.
        overdue: false,
        verdict: Some(state.verdict),
        archival: if overlay.tombstone.is_some() {
            Archival::Archived
        } else {
            state.archival
        },
        archival_conflict: false,
        plan_timing: None,
    };
    let commitment = Commitment {
        id,
        title: overlay.title.clone().unwrap_or(occurrence.title),
        parent_type: occurrence.parent_type,
        parent_id: occurrence.parent_id,
        verdict,
        time_scope: occurrence.time_scope,
        verdict_window,
        tag_ids: occurrence.fields.tag_ids.clone(),
        position: overlay.position.unwrap_or(occurrence.position),
        is_private: overlay.is_private.unwrap_or(occurrence.is_private),
        beads_id: if overlay.beads_id_set {
            overlay.beads_id
        } else {
            occurrence.fields.beads_id.clone()
        },
        origin: occurrence.origin,
    };
    (commitment, lifecycle)
}

#[cfg(test)]
mod tests;
