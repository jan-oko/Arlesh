//! Plan inheritance: the **effective Plan** every node reads, derived on load and never stored
//! (Task `065b`, ruled by the user on 2026-10-03; `docs/spec/time-scopes.md`, *Plan inheritance*).
//!
//! A Task with a Plan of its own reads that Plan. One without reads the Plan it inherits: its
//! parent's effective Plan, **clipped** to its own Time Scope. The chain climbs through every kind —
//! Goals, Commitments, waits and containers pass the Plan above them down — and there is no
//! opt-out. Containment is the write rule: a child's own Plan must sit inside the Plan it inherits,
//! and nothing may be left with an **empty** effective Plan, where the inherited Plan and its own
//! window do not meet.
//!
//! Pure functions over the board's links, generic over how a node is keyed, so the board load,
//! the write guard and the clamp prompt all read one rule.

use std::collections::{HashMap, HashSet};
use std::hash::Hash;

use chrono::NaiveDateTime;
use serde::Serialize;

use crate::scopes::{
    key::ScopeKey,
    resolve::{interval_contains, Bounds},
};
use crate::tasks::model::TimeScope;

/// What one node passes a Plan through: where it hangs, its own Plan and Time Scope, and whether
/// its window clips what it inherits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanLink<K> {
    /// The node it hangs under, or `None` at the top of the board.
    pub parent: Option<K>,
    /// Its own Plan. Only a Task carries one.
    pub plan: Option<TimeScope>,
    /// Its own Time Scope.
    pub time_scope: Option<TimeScope>,
    /// Whether its own Time Scope clips the Plan it inherits. Not for a wait or a wait's check
    /// task, which inherit fully (a check's window is the day it fell due, not a relevance the
    /// user chose), nor for an **Overdue** Task, whose Plan may leave its window.
    pub clips: bool,
    /// Whether it is a Task — the kind whose effective Plan is judged.
    pub is_task: bool,
}

/// The Plan a node reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EffectivePlan<K> {
    /// A Plan of its own.
    Own(TimeScope),
    /// Inherited from `source`, the nearest planned node above, clipped on the way down.
    Inherited {
        /// The inherited Plan, clipped to the windows between.
        plan: TimeScope,
        /// The node whose own Plan it is.
        source: K,
    },
    /// Something above is planned, but its Plan and this node's window do not meet.
    Empty {
        /// The node whose own Plan it is.
        source: K,
    },
    /// Nothing above it is planned, and it has no Plan of its own.
    Unplanned,
}

impl<K> EffectivePlan<K> {
    /// The Plan it reads, or `None` when it reads none.
    pub fn plan(&self) -> Option<&TimeScope> {
        match self {
            Self::Own(plan) | Self::Inherited { plan, .. } => Some(plan),
            Self::Empty { .. } | Self::Unplanned => None,
        }
    }
}

/// Which plan rule a node breaks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanConflict {
    /// Its own Plan is not inside the Plan it inherits.
    ParentPlan,
    /// It has no Plan of its own, and the one above it does not meet its window.
    Empty,
}

/// What one node reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanReading<K> {
    /// The Plan it reads.
    pub effective: EffectivePlan<K>,
    /// What it takes from above — its parent's effective Plan clipped to its own window — whether
    /// or not it has a Plan of its own. It is what an own Plan must sit inside, and what it reads
    /// when it has none.
    pub inherited: Option<(TimeScope, K)>,
    /// The rule it breaks, judged for a Task only.
    pub conflict: Option<PlanConflict>,
}

/// `plan` clipped to `scope`: the part of the Plan inside the window, or `None` when they do not
/// meet. A Plan inside the window is returned as it is, and so is a window inside the Plan; a
/// partial overlap is spelled as a range of Days when both ends fall on the 02:00 day boundary,
/// and otherwise by the two scopes whose ends bound it.
pub fn clip(plan: &TimeScope, scope: &TimeScope) -> Option<TimeScope> {
    let (plan_window, scope_window) = (plan.window(), scope.window());
    if interval_contains(scope_window, plan_window) {
        return Some(bare(plan));
    }
    if interval_contains(plan_window, scope_window) {
        return Some(bare(scope));
    }
    let start = plan_window.0.max(scope_window.0);
    let end = plan_window.1.min(scope_window.1);
    if start >= end {
        return None;
    }
    if let Some(days) = day_range(start, end) {
        return Some(days);
    }
    let start_id = if plan_window.0 >= scope_window.0 {
        plan.start_id
    } else {
        scope.start_id
    };
    let end_id = if plan_window.1 <= scope_window.1 {
        plan.end_id
    } else {
        scope.end_id
    };
    Some(TimeScope {
        start_id,
        end_id,
        duration: None,
    })
}

/// A window as a Plan: its two endpoints, without the duration a Time Scope may carry.
fn bare(scope: &TimeScope) -> TimeScope {
    TimeScope {
        start_id: scope.start_id,
        end_id: scope.end_id,
        duration: None,
    }
}

/// `[start, end)` as a range of whole Days, when both ends fall on a Day's 02:00 boundary.
fn day_range(start: NaiveDateTime, end: NaiveDateTime) -> Option<TimeScope> {
    let first = ScopeKey::day(start.date());
    let last = ScopeKey::day(end.date().pred_opt()?);
    (first.bounds().0 == start && last.bounds().1 == end).then_some(TimeScope {
        start_id: first,
        end_id: last,
        duration: None,
    })
}

/// What a node takes from a parent reading `parent`, through its own `link`.
fn take_from<K: Clone>(
    parent: Option<&EffectivePlan<K>>,
    link: &PlanLink<K>,
) -> (Option<(TimeScope, K)>, Option<K>) {
    let (plan, source) = match parent {
        Some(EffectivePlan::Own(plan)) => match &link.parent {
            Some(parent) => (plan, parent.clone()),
            None => return (None, None),
        },
        Some(EffectivePlan::Inherited { plan, source }) => (plan, source.clone()),
        Some(EffectivePlan::Empty { source }) => return (None, Some(source.clone())),
        Some(EffectivePlan::Unplanned) | None => return (None, None),
    };
    let window = link.time_scope.as_ref().filter(|_| link.clips);
    match window {
        None => (Some((bare(plan), source)), None),
        Some(window) => match clip(plan, window) {
            Some(clipped) => (Some((clipped, source)), None),
            None => (None, Some(source)),
        },
    }
}

/// The reading of a node whose parent reads `parent`.
fn reading<K: Clone>(parent: Option<&EffectivePlan<K>>, link: &PlanLink<K>) -> PlanReading<K> {
    let (inherited, empty_from) = take_from(parent, link);
    let effective = match (&link.plan, &inherited, &empty_from) {
        (Some(own), _, _) => EffectivePlan::Own(own.clone()),
        (None, Some((plan, source)), _) => EffectivePlan::Inherited {
            plan: plan.clone(),
            source: source.clone(),
        },
        (None, None, Some(source)) => EffectivePlan::Empty {
            source: source.clone(),
        },
        (None, None, None) => EffectivePlan::Unplanned,
    };
    let conflict = link
        .is_task
        .then(|| conflict(link, &inherited, &empty_from))
        .flatten();
    PlanReading {
        effective,
        inherited,
        conflict,
    }
}

/// The rule a Task breaks, given what it takes from above.
fn conflict<K>(
    link: &PlanLink<K>,
    inherited: &Option<(TimeScope, K)>,
    empty_from: &Option<K>,
) -> Option<PlanConflict> {
    match (&link.plan, inherited) {
        (Some(own), Some((bound, _))) => {
            (!interval_contains(bound.window(), own.window())).then_some(PlanConflict::ParentPlan)
        }
        (Some(_), None) => empty_from.as_ref().map(|_| PlanConflict::ParentPlan),
        (None, _) => empty_from.as_ref().map(|_| PlanConflict::Empty),
    }
}

/// Every node's reading over `links`. A node whose parent is not among the links reads as the top
/// of the board; a parent chain that loops reads as the top where it closes, so a corrupt board
/// still loads.
pub fn read_plans<K: Clone + Eq + Hash>(
    links: &HashMap<K, PlanLink<K>>,
) -> HashMap<K, PlanReading<K>> {
    let mut readings: HashMap<K, PlanReading<K>> = HashMap::with_capacity(links.len());
    for key in links.keys() {
        if readings.contains_key(key) {
            continue;
        }
        // Climb to the first node already read, or to the top, then read back down.
        let mut chain = vec![key.clone()];
        let mut seen: HashSet<&K> = HashSet::from([key]);
        let mut cursor = links.get(key).and_then(|link| link.parent.as_ref());
        while let Some(parent) = cursor {
            if readings.contains_key(parent) || !links.contains_key(parent) || !seen.insert(parent)
            {
                break;
            }
            chain.push(parent.clone());
            cursor = links.get(parent).and_then(|link| link.parent.as_ref());
        }
        for node in chain.into_iter().rev() {
            let Some(link) = links.get(&node) else {
                continue;
            };
            let parent = link
                .parent
                .as_ref()
                .and_then(|parent| readings.get(parent))
                .map(|reading| &reading.effective);
            let read = reading(parent, link);
            readings.insert(node, read);
        }
    }
    readings
}

/// The nearest own Time Scope at or above `key` — the node's effective Time Scope.
pub fn effective_time_scope<'a, K: Eq + Hash>(
    links: &'a HashMap<K, PlanLink<K>>,
    key: &K,
) -> Option<&'a TimeScope> {
    let mut cursor = Some(key);
    for _ in 0..=links.len() {
        let link = links.get(cursor?)?;
        if let Some(scope) = &link.time_scope {
            return Some(scope);
        }
        cursor = link.parent.as_ref();
    }
    None
}

/// One descendant a new Plan on its ancestor would leave outside, and what it would be clamped to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanClamp<K> {
    /// The descendant.
    pub key: K,
    /// The Plan clamping gives it: the part of its own Plan inside the new bound, or the bound
    /// itself when they do not meet. `None` when nothing above admits it any more.
    pub clamp_to: Option<TimeScope>,
}

/// The descendants of `node` whose own Plan would leave the Plan they inherit were `node` given
/// `plan`, nearest first — each read as if those above it had been clamped already, so a
/// grandchild inside its clamped parent is not listed.
pub fn clamps_for<K: Clone + Eq + Hash>(
    links: &HashMap<K, PlanLink<K>>,
    node: &K,
    plan: Option<&TimeScope>,
) -> Vec<PlanClamp<K>> {
    let mut links = links.clone();
    let Some(written) = links.get_mut(node) else {
        return Vec::new();
    };
    written.plan = plan.cloned();
    let mut children: HashMap<&K, Vec<K>> = HashMap::new();
    for (key, link) in &links {
        if let Some(parent) = &link.parent {
            children.entry(parent).or_default().push(key.clone());
        }
    }
    let mut clamps = Vec::new();
    let mut readings: HashMap<K, EffectivePlan<K>> = HashMap::new();
    let start = read_plans(&links)
        .remove(node)
        .map_or(EffectivePlan::Unplanned, |reading| reading.effective);
    readings.insert(node.clone(), start);
    let mut queue: std::collections::VecDeque<K> =
        children.get(node).cloned().unwrap_or_default().into();
    let mut seen: HashSet<K> = HashSet::from([node.clone()]);
    while let Some(key) = queue.pop_front() {
        if !seen.insert(key.clone()) {
            continue;
        }
        let Some(link) = links.get(&key) else {
            continue;
        };
        let parent = link.parent.as_ref().and_then(|parent| readings.get(parent));
        let mut read = reading(parent, link);
        if read.conflict == Some(PlanConflict::ParentPlan) {
            let clamp_to = match (&link.plan, &read.inherited) {
                (Some(own), Some((bound, _))) => {
                    Some(clip(own, bound).unwrap_or_else(|| bound.clone()))
                }
                _ => None,
            };
            if let Some(clamped) = &clamp_to {
                read.effective = EffectivePlan::Own(clamped.clone());
            }
            clamps.push(PlanClamp {
                key: key.clone(),
                clamp_to,
            });
        }
        readings.insert(key.clone(), read.effective);
        queue.extend(children.get(&key).cloned().unwrap_or_default());
    }
    clamps
}

/// How far a Habit reaches, as a node: from its first occurrence to its last, or on without end.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Span {
    /// Where it starts.
    pub start: NaiveDateTime,
    /// Where it ends, or `None` for a Habit with no end.
    pub end: Option<NaiveDateTime>,
}

/// A Habit's effective Time Scope and effective Plan — derived, never shown (`docs/spec/habits.md`,
/// *Plan inheritance*).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct HabitSpan {
    /// From its first iteration's window to its last's; `None` for an Unscoped Habit.
    pub time_scope: Option<Span>,
    /// From its first occurrence's Plan to its last's; `None` when its occurrences carry no Plan
    /// of their own, and so inherit as any node does.
    pub plan: Option<Span>,
}

/// Which edge a Habit breaks against its target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HabitConflict {
    /// Its Time Scope leaves its target's effective Time Scope.
    TimeScope,
    /// Its Plan leaves its target's effective Plan.
    Plan,
}

/// Whether `inner` sits inside `outer`: anything sits inside nothing, nothing inside anything, and
/// a span with no end only inside nothing.
fn span_fits(outer: Option<Bounds>, inner: Option<Span>) -> bool {
    let (Some(outer), Some(inner)) = (outer, inner) else {
        return true;
    };
    inner
        .end
        .is_some_and(|end| interval_contains(outer, (inner.start, end)))
}

/// The edges a Habit spanning `span` breaks against a target whose effective Time Scope is `scope`
/// and effective Plan is `plan`. An endless Habit needs an unscoped target, and an endless planned
/// one an unplanned target.
pub fn habit_conflicts(
    span: HabitSpan,
    scope: Option<Bounds>,
    plan: Option<Bounds>,
) -> Vec<HabitConflict> {
    let mut conflicts = Vec::new();
    if !span_fits(scope, span.time_scope) {
        conflicts.push(HabitConflict::TimeScope);
    }
    if !span_fits(plan, span.plan) {
        conflicts.push(HabitConflict::Plan);
    }
    conflicts
}

/// The conflicts a write would leave that it must be refused for: every one that was not there
/// before, and every one on a node it wrote — an existing violation stays flagged until that node
/// is next edited, and that edit must resolve it.
pub fn refusable<'a, K: Eq + Hash, C: Eq + Hash + Copy>(
    before: &HashSet<(K, C)>,
    after: &'a [(K, C)],
    written: &HashSet<K>,
) -> Vec<&'a (K, C)> {
    after
        .iter()
        .filter(|entry| written.contains(&entry.0) || !before.contains(entry))
        .collect()
}

#[cfg(test)]
mod tests;
