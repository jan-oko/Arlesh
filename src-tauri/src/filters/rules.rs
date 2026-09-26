//! The predicates themselves: one function per rule, each answering about a single node.
//!
//! These are shared by both surfaces. [`tree`](super::tree) applies them while pruning the
//! Mindmap's tree and [`list`](super::list) applies them to a flat row and its ancestor chain, so
//! the two cannot answer the same node differently.

use crate::{
    scopes::resolve::{interval_contains, Bounds},
    tasks::{
        lifecycle::Timing,
        model::{TimeScope, Verdict},
    },
};

use super::model::{
    BoardFilter, NodeFacts, NodeKind, OverrideMode, Preset, ScopeMatch, TagFilter, TagMode,
    EXPECTATION_PENDING,
};

/// Goal statuses that read as resolved, and so drop out of Plan and Start.
const RESOLVED_GOAL: [&str; 3] = ["achieved", "frozen", "archived"];

/// Project statuses that shelve the whole subtree in Plan/Start: the work is deliberately off the
/// table, so unresolved items inside it are neither plannable nor startable.
///
/// `achieved` is deliberately absent — finished work can still hold unfinished items worth
/// surfacing, so it keeps the ordinary ancestor-keeping.
const SHELVED_PROJECT: [&str; 2] = ["frozen", "archived"];

/// The status a container falls back to when neither it nor any ancestor carries one.
pub const UNSET_STATUS: &str = "active";

/// Whether a goal status reads as resolved.
fn is_resolved_goal(status: &str) -> bool {
    RESOLVED_GOAL.contains(&status)
}

/// Whether a node is blocked.
///
/// Only a Task or a Goal can be: a block reason on anything else is not a state the model has, so
/// `is_blocked` is read through this rather than directly, exactly as the frontend reads it
/// through `isNodeBlocked`.
pub fn is_blocked(node: &NodeFacts) -> bool {
    matches!(node.kind, NodeKind::Task | NodeKind::Goal) && node.is_blocked
}

/// An Archived-status node, one whose effective Archival was derived as Archived, or a delegated
/// Task.
///
/// A scope Resolution of Completed or Missed forces the second regardless of done-ness: both
/// render the same archive-box badge, and the Archived pill governs both together. A delegated
/// Task has **every effect of archival** — someone else holds it, so it is off your board
/// wherever an archived node is — and so it answers here rather than through a rule of its own.
/// What it is waiting on stays visible: its virtual Expectation (see [`crate::filters::facts`]).
pub fn is_archived(node: &NodeFacts) -> bool {
    node.status_str() == "archived" || node.archived || node.delegated
}

/// Forces an archived-like node to match when the Archived pill is on `Include`, overriding
/// whatever the active preset would otherwise decide.
///
/// `Exclude` needs no handling here: it hard-hides the whole subtree earlier, in
/// [`type_hard_hidden`].
pub fn with_archived_override(node: &NodeFacts, filter: &BoardFilter, base: bool) -> bool {
    if filter.archived == OverrideMode::Include && is_archived(node) {
        return true;
    }
    base
}

/// Whether `node` is a backlogged Task the active filter hides along with everything beneath it.
///
/// Setting a piece of work aside sets its sub-steps aside too, so it is dropped as a unit rather
/// than kept on screen as the ancestor of live children. Plan and Start hide it; All and Do leave
/// it alone; Backlog is the preset that exists to show it. The pill overrides all of that.
///
/// **Do is deliberate.** Backlog says *not planning this now* and Do asks *what is underway* —
/// different questions a Task can answer yes to at once — so a backlogged in-progress Task still
/// shows under Do. The tension is resolved where it starts instead: setting a Task In Progress
/// takes it out of the Backlog (see [`crate::tasks`]), so the pair is rare rather than hidden.
pub fn is_hidden_backlog(node: &NodeFacts, filter: &BoardFilter) -> bool {
    if !node.backlogged {
        return false;
    }
    match filter.backlog {
        OverrideMode::Exclude => true,
        OverrideMode::Include => false,
        OverrideMode::Inactive => matches!(filter.preset, Preset::Plan | Preset::Start),
    }
}

/// Whether `node` is a Habit occurrence whose window has not opened yet, which every preset but
/// All hides together with everything beneath it.
///
/// This is the Archived shape, not the Archived rule: the backend produces the occurrence and says
/// where its window stands, and the preset decides. All shows it — that is All's whole contract,
/// and a Habit's later-today items are exactly what one looks at All to see.
///
/// Restricted to the occurrences a Habit generates in bulk on purpose. `Pending` is derived for
/// *any* scoped item whose window is still ahead, and a real task scheduled for next week has
/// always shown under Plan — that is what planning is.
///
/// It gates the subtree rather than merely failing its own match, because children nest under
/// their parent's first occurrence: keeping an unopened parent on screen as the ancestor of a
/// child whose own window has opened would draw a row nobody asked for.
///
/// **Backlog hides it like the rest.** An unopened window is not work that was set aside, so the
/// preset that exists to show what you put down has nothing to say about what has not started;
/// `docs/spec/habits.md` names every preset but All.
pub fn is_unopened_occurrence(node: &NodeFacts, filter: &BoardFilter) -> bool {
    if !node.is_habit_occurrence || node.timing != Some(Timing::Pending) {
        return false;
    }
    filter.preset != Preset::All
}

/// Whether `node` is a Task that Start hides because its Plan has not begun yet.
///
/// Start asks what can be begun **now**, and a Task scheduled into next week is not that. The
/// Plan's position is `node`'s own when it has a Plan, and otherwise `inherited_plan` — the
/// nearest planned ancestor Task's, which the walk carries down. That inheritance is the interim
/// reading of an unplanned sub-step under a planned Task, pending real Plan inheritance, and lives
/// only here: nothing stored, edited or badged inherits a Plan yet. A Task with a Plan of its own
/// answers to it alone, whatever its parent's says.
///
/// Only a Plan still **ahead** hides. One that has already ended unfulfilled keeps the Task on
/// screen as missed work — a missed slot does not make the work any less startable; the Task's
/// own Time Scope is what decides when it stops being relevant. An unplanned Task with no planned
/// ancestor is unaffected, as is every other kind.
///
/// It fails the Task's own match rather than gating its subtree, so a sub-step with a current
/// Plan of its own still shows, holding its future-planned parent on screen as its ancestor.
pub fn is_planned_ahead(
    node: &NodeFacts,
    filter: &BoardFilter,
    inherited_plan: Option<Timing>,
) -> bool {
    filter.preset == Preset::Start
        && node.kind == NodeKind::Task
        && node.plan_timing.or(inherited_plan) == Some(Timing::Pending)
}

/// Whether two half-open windows share any instant. Adjacent windows — one ending where the next
/// begins — do not.
fn intervals_overlap(a: Bounds, b: Bounds) -> bool {
    a.0 < b.1 && b.0 < a.1
}

/// Whether `node` is a Task the Plan preset's **scope narrowing** leaves out.
///
/// With [`BoardFilter::plan_scope`] set under [`Preset::Plan`], a Task shows only when its
/// **effective** Time Scope — its own, or `inherited`, the nearest scoped ancestor's, which the
/// walk carries down — matches the scope by [`BoardFilter::scope_match`]:
///
/// - **Contained** (the default): the window lies wholly inside the scope. An **Unscoped** Task —
///   no window of its own or inherited — is inside nothing, and is left out.
/// - **Overlapping**: the window shares any instant with the scope, and an Unscoped Task, which
///   the model defines as always relevant, overlaps every scope.
///
/// Only a Task is narrowed; every other kind answers the preset as before. It fails the Task's own
/// match rather than gating its subtree, so a sub-step inside the scope still shows, holding its
/// wider parent on screen as its ancestor — the ordinary ancestor-keeping.
pub fn is_outside_plan_scope(
    node: &NodeFacts,
    filter: &BoardFilter,
    inherited: Option<&TimeScope>,
) -> bool {
    let Some(scope) = filter.plan_scope else {
        return false;
    };
    if filter.preset != Preset::Plan || node.kind != NodeKind::Task {
        return false;
    }
    let target = scope.bounds();
    let Some(window) = node.time_scope.as_ref().or(inherited) else {
        return filter.scope_match == ScopeMatch::Contained;
    };
    match filter.scope_match {
        ScopeMatch::Contained => !interval_contains(target, window.window()),
        ScopeMatch::Overlapping => !intervals_overlap(target, window.window()),
    }
}

/// Whether `node` is a Project that Plan/Start shelve along with everything inside it.
///
/// The Archived pill's `Include` still wins for the Archived case, as it does everywhere else; a
/// Frozen Project is not archived, so nothing rescues it.
pub fn is_shelved_project(node: &NodeFacts, filter: &BoardFilter) -> bool {
    if node.kind != NodeKind::Project {
        return false;
    }
    if !matches!(filter.preset, Preset::Plan | Preset::Start) {
        return false;
    }
    if !SHELVED_PROJECT.contains(&node.status_str()) {
        return false;
    }
    !(filter.archived == OverrideMode::Include && is_archived(node))
}

/// Whether a Flow subtree is hidden as a unit rather than softly, via ancestor-keeping.
///
/// Hard-hiding the Flow node drops its whole item subtree with it.
fn is_flow_hard_hidden(node: &NodeFacts, filter: &BoardFilter) -> bool {
    if !node.kind.is_flow() {
        return false;
    }
    if !filter.show_flow {
        return true;
    }
    if node.kind != NodeKind::Flow {
        return false;
    }
    if filter.preset == Preset::Do {
        return true;
    }
    if matches!(filter.preset, Preset::Plan | Preset::Start) && !filter.include_flows {
        return true;
    }
    filter.preset == Preset::Start && node.is_habit_flow
}

/// Whether `node` is hidden outright — its subtree removed, not kept as an ancestor.
///
/// The Archived pill's `Exclude` branch below applies under **every** preset, Do included: it is
/// one rule about archived items rather than a per-preset carve-out, so an effectively-archived
/// in-progress Task is hidden from Do while the pill is on `Exclude`.
pub fn type_hard_hidden(node: &NodeFacts, filter: &BoardFilter) -> bool {
    // Outside Private Mode, a private node and everything beneath it are dropped, whatever kind it
    // is.
    if !filter.private_mode && node.is_private {
        return true;
    }
    if node.kind == NodeKind::Info && !filter.show_info {
        return true;
    }
    // In Start a blocked Task/Goal gates its whole subtree: it is what stands in the way of
    // everything under it, so nothing there is startable either.
    if filter.preset == Preset::Start && is_blocked(node) {
        return true;
    }
    // `Exclude` gates the whole subtree the way blocked and private do — otherwise an excluded
    // Habit-instance goal with one still-undone item and one already-done sibling would stay
    // visible as that sibling's ancestor.
    if filter.archived == OverrideMode::Exclude && is_archived(node) {
        return true;
    }
    if is_hidden_backlog(node, filter) {
        return true;
    }
    if is_shelved_project(node, filter) {
        return true;
    }
    if is_unopened_occurrence(node, filter) {
        return true;
    }
    is_flow_hard_hidden(node, filter)
}

/// Whether a Commitment shows under the active preset.
///
/// Its own rule, not a translation of a Task's, because the two kinds resolve the opposite way
/// round. Plan, Start and Do show what is **unresolved**: what you have yet to judge is what is
/// still live, and a recorded verdict — Kept or Broken alike — is resolved, the way a done Task
/// is. All shows everything, past verdicts included, because looking back over what you kept and
/// broke is the point of keeping the record.
///
/// (Plan once also kept a Broken commitment on screen while its window was open. The user ruled
/// that out on 2026-09-23: a Broken commitment is answered, and Plan hides what is answered.)
///
/// Backlog shows none: a Commitment has no Backlog state to be in.
pub fn passes_commitment_preset(node: &NodeFacts, filter: &BoardFilter) -> bool {
    let verdict = node.verdict.unwrap_or(Verdict::Unresolved);
    match filter.preset {
        Preset::All => true,
        Preset::Plan | Preset::Start | Preset::Do => verdict == Verdict::Unresolved,
        Preset::Backlog => false,
    }
}

/// Whether an Expectation is still being waited on and has not been put away: pending, and not
/// archived.
pub fn is_live_expectation(node: &NodeFacts) -> bool {
    node.status_str() == EXPECTATION_PENDING && !node.archived
}

/// Whether an Expectation shows under the active preset.
///
/// A wait is not work, so it answers to its own rule. **All** shows every one. A **pending**, live
/// one shows under **Plan** — it is part of what is in play — and under **Start** while its window
/// has not passed, whether or not it is checked on; its check tasks answer the ordinary Task rules
/// beside it. With [`BoardFilter::start_hides_checked_waits`] on (an app-wide setting, off by
/// default), Start shows one only when it has **no** Check every: the check task beneath it is then
/// the thing to start, and stands in for it. Stored and derived waits alike. **Do** and **Backlog**
/// show none: nothing about a wait is
/// underway on your side, and a wait cannot be set aside. A **released** or **archived** one shows
/// under All only.
///
/// The List View's own Expectations option is not a preset and is not answered here; see
/// [`crate::filters::list::passes_expectation_row`].
pub fn passes_expectation_preset(node: &NodeFacts, filter: &BoardFilter) -> bool {
    match filter.preset {
        Preset::All => true,
        Preset::Plan => is_live_expectation(node),
        // A window that has passed drops out of Start, as a Task's does.
        Preset::Start => {
            let hidden_for_its_check = filter.start_hides_checked_waits && node.has_check;
            is_live_expectation(node)
                && !hidden_for_its_check
                && node.timing != Some(Timing::Lapsed)
        }
        Preset::Do | Preset::Backlog => false,
    }
}

/// Whether a node's own status satisfies the active preset.
///
/// `inherited_status` is the nearest status-bearing container ancestor's status, used only for
/// containers of their own: a Domain or Aspect can never be given a status — only a Project can —
/// so judging one on its own status alone would make every Domain read as unresolved and keep an
/// achieved Project visible in Plan as their ancestor.
///
/// `under_backlog` says whether some ancestor is a backlogged Task. It matters only to the Backlog
/// preset, which shows a set-aside Task *and its whole subtree*: the sub-steps go with the step.
pub fn passes_status(
    node: &NodeFacts,
    filter: &BoardFilter,
    inherited_status: &str,
    under_backlog: bool,
) -> bool {
    // In any filtered preset a structural container never matches on its own — it shows only when
    // it holds a content match, so an empty or fully-resolved container drops out. The exception
    // is Plan, where an active Aspect/Domain/Project shows alone, because planning may mean adding
    // items to an empty one. Resolved ones, and Tags, stay ancestor-only.
    if filter.preset != Preset::All && node.kind.is_structural() {
        if filter.preset == Preset::Plan && node.kind != NodeKind::Tag {
            let effective = match node.status.as_deref() {
                Some(status) => status,
                None => inherited_status,
            };
            return with_archived_override(node, filter, !is_resolved_goal(effective));
        }
        return false;
    }
    if node.kind == NodeKind::Commitment {
        return with_archived_override(node, filter, passes_commitment_preset(node, filter));
    }
    if node.kind == NodeKind::Expectation {
        return with_archived_override(node, filter, passes_expectation_preset(node, filter));
    }
    match filter.preset {
        // The Archived pill's `Exclude` hides an archived item under All too, but that is the
        // hard-hide in `type_hard_hidden`, which runs first; `Include` is a no-op here.
        Preset::All => true,
        Preset::Plan => passes_plan(node, filter),
        Preset::Start => passes_start(node, filter),
        // Only in-progress Tasks match; Goals and structure appear solely as ancestors.
        Preset::Do => node.kind == NodeKind::Task && node.status_str() == "in_progress",
        // The inverse of every other preset: only what was deliberately set aside, plus everything
        // beneath it. Structural containers already dropped to ancestor-only above.
        Preset::Backlog => under_backlog || node.backlogged,
    }
}

/// Plan's own branch: hide done Tasks and resolved Goals, and anything whose *effective* Archival
/// is Archived — which catches a still-`active` Goal, and any Task, neither of which has a stored
/// status that would say so.
fn passes_plan(node: &NodeFacts, filter: &BoardFilter) -> bool {
    match node.kind {
        NodeKind::Task => with_archived_override(
            node,
            filter,
            node.status_str() != "done" && !is_archived(node),
        ),
        NodeKind::Goal => with_archived_override(
            node,
            filter,
            !is_resolved_goal(node.status_str()) && !node.archived,
        ),
        _ => true,
    }
}

/// Start's own branch: things that can be begun now.
///
/// Anything whose window has passed drops out, which is why no separate Archival clause is needed
/// — effective Archival only ever becomes Archived once a window has lapsed, or once a Goal says
/// so in its own status. Blocked Tasks and Goals are dropped earlier, as a hard-hidden subtree.
fn passes_start(node: &NodeFacts, filter: &BoardFilter) -> bool {
    if !matches!(node.kind, NodeKind::Task | NodeKind::Goal) {
        return true;
    }
    // A lapsed window drops out, and so does a delegated Task: it is archived in every effect
    // but name, and nothing someone else holds is yours to start.
    if node.timing == Some(Timing::Lapsed) || node.delegated {
        return with_archived_override(node, filter, false);
    }
    if node.kind == NodeKind::Goal {
        return with_archived_override(node, filter, !is_resolved_goal(node.status_str()));
    }
    match node.status_str() {
        "done" => false,
        // An in-progress Task with nothing left to start — no direct todo child — drops out.
        "in_progress" => node.has_todo_child,
        _ => true,
    }
}

/// The combined tag predicate: `(∪Any) ∧ (∩All) ∧ ¬(∪Exclude)`.
///
/// Only the kinds that can carry tags are judged; everything else passes, because a filter a node
/// cannot answer must not be read as a node that failed it.
pub fn passes_tags(node: &NodeFacts, filter: &BoardFilter) -> bool {
    if filter.tags.is_empty() {
        return true;
    }
    if !matches!(
        node.kind,
        NodeKind::Task | NodeKind::Goal | NodeKind::Commitment | NodeKind::Expectation
    ) {
        return true;
    }
    matches_tag_group(&filter.tags, &node.tag_ids)
}

/// The same formula over a bare list of values, so that a caller with tag ids and no node — a
/// test, or a future pill dimension — reaches the one implementation.
pub fn matches_tag_group(filters: &[TagFilter], tag_ids: &[i64]) -> bool {
    let has = |id: i64| tag_ids.contains(&id);
    let mut any = filters.iter().filter(|f| f.mode == TagMode::Any).peekable();
    if any.peek().is_some() && !any.any(|f| has(f.tag_id)) {
        return false;
    }
    if !filters
        .iter()
        .filter(|f| f.mode == TagMode::All)
        .all(|f| has(f.tag_id))
    {
        return false;
    }
    !filters
        .iter()
        .filter(|f| f.mode == TagMode::Exclude)
        .any(|f| has(f.tag_id))
}

/// Whether a node matches the filter on its own, before ancestor-keeping is considered.
pub fn self_matches(
    node: &NodeFacts,
    filter: &BoardFilter,
    inherited_status: &str,
    under_backlog: bool,
) -> bool {
    passes_status(node, filter, inherited_status, under_backlog) && passes_tags(node, filter)
}

#[cfg(test)]
mod tests;
