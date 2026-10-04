//! The values a filter is expressed in, and the facts it reads off a node.

use serde::{Deserialize, Serialize};

use crate::{
    scopes::key::ScopeKey,
    tasks::{
        lifecycle::Timing,
        model::{TimeScope, Verdict},
    },
};

/// The status preset a board is being read under.
///
/// `All` disables status filtering, `Backlog` inverts it — showing only what was deliberately set
/// aside — and the three in between narrow progressively.
///
/// **Unblock is not here.** It is the List View's own sixth option, and picking it leaves whatever
/// preset was active where it is — the Mindmap still answers to that preset when you switch back.
/// It is therefore [`BoardFilter::unblock`], a flag beside the preset rather than a variant of it,
/// which is what the frontend stores too. The flag sits beside the preset without combining with
/// it: while it is set the list's rows are the blocked ones and the preset does not answer for
/// them (see [`crate::filters::list::passes_row`]).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum Preset {
    /// Everything, containers included.
    #[default]
    All,
    /// What is still to be planned: no done tasks, no achieved/frozen/archived goals, nothing
    /// whose effective Archival is Archived.
    Plan,
    /// What can be begun now: Plan, minus items whose window has lapsed — unless they are
    /// Overdue, which Start keeps — or has not begun yet
    /// (Tasks, Goals and waits — a wait still ahead takes its check tasks with it), minus
    /// in-progress tasks with nothing left under them to start, minus Habit flows, minus blocked
    /// subtrees, minus Tasks planned into a scope that has not begun yet.
    Start,
    /// Only in-progress tasks — and of Agentic ones, Doing and Review.
    Do,
    /// Only Tasks deliberately set aside, together with their subtrees.
    Backlog,
}

/// The status an Expectation fact spells when the wait is still on.
pub const EXPECTATION_PENDING: &str = "pending";

/// A tri-state pill's override, on top of whatever the status preset would otherwise decide.
///
/// `Inactive` defers entirely to the preset; `Include` shows; `Exclude` force-hides, gating the
/// whole subtree. Shared by the Archived, Backlog and Delegated pills.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum OverrideMode {
    /// Defer to the preset.
    #[default]
    Inactive,
    /// Force-show, even under a preset that would hide it.
    Include,
    /// Force-hide, even under All, and gate the whole subtree.
    Exclude,
}

/// How a single tag filter contributes to the combined tag predicate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TagMode {
    /// The node must carry at least one of the Any-mode tags.
    Any,
    /// The node must carry every All-mode tag.
    All,
    /// The node must carry none of the Exclusion-mode tags.
    Exclude,
}

/// One tag filter: a tag's domain id in one of the three modes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct TagFilter {
    /// The tag's domain id.
    pub tag_id: i64,
    /// How it combines with the others.
    pub mode: TagMode,
}

/// How the Plan preset's scope narrowing ([`BoardFilter::plan_scope`]) matches a Task's window.
///
/// An app-wide preference in the UI, carried in the filter so that a board read over MCP can ask
/// the same question either way.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum ScopeMatch {
    /// The Task's effective Time Scope lies wholly inside the scope. An Unscoped Task is inside
    /// nothing, and is left out.
    #[default]
    Contained,
    /// The Task's effective Time Scope shares any instant with the scope. An Unscoped Task is
    /// always relevant, so it overlaps every scope.
    Overlapping,
}

/// The kinds of row the List View draws.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum RowKind {
    /// A Task row.
    Task,
    /// A Commitment row.
    Commitment,
    /// An Expectation row: a wait.
    Expectation,
}

impl RowKind {
    /// Every kind, in the order the List View's selector lists them.
    pub const ALL: [Self; 3] = [Self::Task, Self::Commitment, Self::Expectation];
}

/// One List View pill: a value in one of the three modes a tag filter takes.
///
/// The value is a node id (Antecedent, Depends on), a status or verdict spelling, or one of the
/// fixed tokens a dimension reads (see [`super::pills`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Pill {
    /// What the pill matches.
    pub value: String,
    /// How it combines with the other pills of its group.
    pub mode: TagMode,
}

/// The List View's own filter dimensions, each a list of [`Pill`]s combined as
/// `(∪Any) ∧ (∩All) ∧ ¬(∪Exclude)`. An empty dimension narrows nothing.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(default, rename_all = "snake_case")]
pub struct ListPills {
    /// **Under**: node ids, matched against every ancestor of the row.
    pub antecedent: Vec<Pill>,
    /// **Depends on**: node ids, matched against a Task's own dependency targets.
    pub dependency: Vec<Pill>,
    /// A Task's own status, in either status model's spelling.
    pub task_status: Vec<Pill>,
    /// The status of the Task's nearest Goal ancestor.
    pub goal_status: Vec<Pill>,
    /// The status of the Task's nearest Project ancestor.
    pub project_status: Vec<Pill>,
    /// A Commitment's verdict; an unrecorded one reads `unresolved`.
    pub verdict: Vec<Pill>,
    /// **Scope**: `unscoped`, `active`, `overdue`, `lapsed`, `planned`, `unplanned`.
    pub scope_state: Vec<Pill>,
    /// `blocked`. One group with the three below: an Any among them is an Any across them.
    pub blocked: Vec<Pill>,
    /// `agentic`.
    pub agentic: Vec<Pill>,
    /// `asynchronous`.
    pub asynchronous: Vec<Pill>,
    /// `private`. The one flag a Commitment or a wait answers.
    pub private: Vec<Pill>,
}

impl ListPills {
    /// Whether no dimension holds a pill.
    pub fn is_empty(&self) -> bool {
        [
            &self.antecedent,
            &self.dependency,
            &self.task_status,
            &self.goal_status,
            &self.project_status,
            &self.verdict,
            &self.scope_state,
            &self.blocked,
            &self.agentic,
            &self.asynchronous,
            &self.private,
        ]
        .iter()
        .all(|pills| pills.is_empty())
    }
}

fn every_row_kind() -> Vec<RowKind> {
    RowKind::ALL.to_vec()
}

/// The whole filter state one board read is taken under.
///
/// Mirrors the frontend's persisted `FilterState` plus the List View's `unblock` option, so that a
/// filter set in the UI and a filter asked for over MCP are the same value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(default, rename_all = "snake_case")]
pub struct BoardFilter {
    /// The status preset.
    pub preset: Preset,
    /// The List View's sixth option: blocked rows only, in place of `preset`'s rules rather than
    /// on top of them. Ignored by the Mindmap, which does not offer it.
    pub unblock: bool,
    /// The List View's **Expectations** option: pending, live Expectations only, in place of
    /// `preset`'s rules exactly as `unblock` is. The List View's dropdown holds one value, so this
    /// and `unblock` are never both set by the UI; were they, Unblock answers, since both empty
    /// what the other shows. Ignored by the Mindmap.
    pub expectations: bool,
    /// Plan/Start's per-preset "include flows" subtoggle, separate from `show_flow`.
    pub include_flows: bool,
    /// Tag filters, combined as `(∪Any) ∧ (∩All) ∧ ¬(∪Exclude)`.
    pub tags: Vec<TagFilter>,
    /// Whether Info nodes are shown at all.
    pub show_info: bool,
    /// Whether Flow nodes are shown at all.
    pub show_flow: bool,
    /// Private Mode. While off — the default — a node marked private is hidden together with its
    /// whole subtree.
    pub private_mode: bool,
    /// The Archived pill.
    pub archived: OverrideMode,
    /// The Backlog pill.
    pub backlog: OverrideMode,
    /// The Delegated pill (Task 269): off drops a delegated Task under Plan and Start, `Include`
    /// keeps it there, `Exclude` hides it with its subtree under every preset.
    pub delegated: OverrideMode,
    /// The Plan preset's scope narrowing: with a scope here and the preset [`Preset::Plan`], a
    /// Task shows only when its effective Time Scope matches it by [`Self::scope_match`]. `None`
    /// narrows nothing, and no other preset reads it.
    #[schemars(with = "Option<crate::mcp::params::ScopeKeyParam>")]
    pub plan_scope: Option<ScopeKey>,
    /// How [`Self::plan_scope`] matches: by containment (the default) or by overlap.
    pub scope_match: ScopeMatch,
    /// Whether **Start** hides a pending wait that has a Check every, showing only the check task
    /// beneath it. Off by default: under Start a pending, live wait shows whether it is checked on
    /// or not. An app-wide preference in the UI, carried here so an MCP read asks it either way.
    pub start_hides_checked_waits: bool,
    /// Whether **Start** shows a **Started** Task — begun and paused. **On by default**: a paused
    /// task is something to pick back up. An app-wide preference in the UI, carried here as
    /// [`Self::start_hides_checked_waits`] is.
    pub start_shows_started: bool,
    /// Whether **Do** shows a **Started** Task beside the In Progress ones. **Off by default**: Do
    /// asks what is being worked on now, and a paused task is not. App-wide, like the one above.
    /// The Zen View reads under Do with its own setting in place of this one.
    pub do_shows_started: bool,
    /// Whether **Start**, **Do** — and the Zen View, which reads under Do — show an Agentic Task
    /// that is **On Agent**: an agent holds it, so it is not the user's to begin or to work on, and
    /// it is hidden unless this explicit show control is on. **Off by default**, and kept with the
    /// tab's filter (the Filter menu's **On Agent** pill, key `o`). Review — On Agent with a
    /// question open — shows whatever this says.
    pub show_on_agent: bool,
    /// Which kinds the List View draws as rows. Every kind by default; ignored under
    /// [`Self::expectations`], which is itself a kind choice.
    #[serde(default = "every_row_kind")]
    pub kinds: Vec<RowKind>,
    /// The List View's own pills. None by default.
    pub pills: ListPills,
}

impl BoardFilter {
    /// Whether this filter asks the List View's own questions — a pill, or fewer than every row
    /// kind — which only a list of rows can answer.
    pub fn reads_rows(&self) -> bool {
        !self.pills.is_empty() || RowKind::ALL.iter().any(|kind| !self.kinds.contains(kind))
    }
}

impl Default for BoardFilter {
    /// The neutral filter: everything except nodes marked private.
    fn default() -> Self {
        Self {
            preset: Preset::All,
            unblock: false,
            expectations: false,
            include_flows: true,
            tags: Vec::new(),
            show_info: true,
            show_flow: true,
            private_mode: false,
            archived: OverrideMode::Inactive,
            backlog: OverrideMode::Inactive,
            delegated: OverrideMode::Inactive,
            plan_scope: None,
            scope_match: ScopeMatch::Contained,
            start_hides_checked_waits: false,
            start_shows_started: true,
            do_shows_started: false,
            show_on_agent: false,
            kinds: every_row_kind(),
            pills: ListPills::default(),
        }
    }
}

impl BoardFilter {
    /// The filter for one preset, with every other axis left neutral.
    pub fn preset(preset: Preset) -> Self {
        Self {
            preset,
            ..Self::default()
        }
    }
}

/// The kinds a filter distinguishes, in the frontend's own vocabulary.
///
/// `Aspect`, `Project`, `Domain` and `Tag` are the four subtypes of the single domains table;
/// they are separate variants here because the presets treat them differently.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    /// A top-level colour-coded container.
    Aspect,
    /// A Project — the one container that carries a status of its own.
    Project,
    /// A general-purpose container.
    Domain,
    /// A tag marker.
    Tag,
    /// A Goal.
    Goal,
    /// A Task.
    Task,
    /// A Commitment.
    Commitment,
    /// An Expectation — a wait. Real, or virtual: the one a delegated Task waits on.
    Expectation,
    /// A free-text note attached to another node.
    Info,
    /// A Flow's root.
    Flow,
    /// A Flow's goal item.
    FlowGoal,
    /// A Flow's task item.
    FlowTask,
    /// The display-only stand-in for a run of passed Habit iterations.
    HabitGroup,
}

impl NodeKind {
    /// Whether this is a structural container: one with no status of its own to be judged on, so
    /// in a filtered preset it shows only as the ancestor of a content match.
    pub fn is_structural(self) -> bool {
        matches!(
            self,
            Self::Aspect | Self::Project | Self::Domain | Self::Tag
        )
    }

    /// Whether this is part of a Flow's subtree, which hides as a unit.
    pub fn is_flow(self) -> bool {
        matches!(self, Self::Flow | Self::FlowGoal | Self::FlowTask)
    }
}

/// Everything a filter reads off one node, and nothing else.
///
/// Derived rather than stored: `archived`, `timing` and `is_blocked` come from the lifecycle
/// derivation and the block reasons, and the filter never re-derives them. Keeping the filter's
/// input to a flat record is what lets one set of rules serve a pruned tree, a flat list of rows
/// and a conformance corpus without any of the three knowing about the others.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeFacts {
    /// The frontend's node id, e.g. `task-12` — the identity every surface keys on.
    pub id: String,
    /// What kind of node this is.
    pub kind: NodeKind,
    /// The node's own status, where its kind has one (Task, Goal, Project, and an Expectation's
    /// `pending`/`released`). A Task's is spelled as its model spells it on the wire — see
    /// [`Self::agentic`] for which model.
    #[serde(default)]
    pub status: Option<String>,
    /// Whether a Task's status is of the **Agentic** model (To Do, On Agent, Review, Doing, Done)
    /// rather than the ordinary one. The presets dispatch on it before they read the status.
    #[serde(default)]
    pub agentic: bool,
    /// Derived window position, for the kinds that have a window.
    #[serde(default)]
    pub timing: Option<Timing>,
    /// Where the Task's **own** Plan stands at the same instant, for a Task that has one. `None`
    /// for an unplanned Task and for every other kind. What an ancestor's Plan says is not a fact
    /// of this node: the filter walk carries it down (see [`super::rules::is_planned_ahead`]).
    #[serde(default)]
    pub plan_timing: Option<Timing>,
    /// Effective Archival is Archived — which a forced Resolution can set regardless of the stored
    /// status.
    #[serde(default)]
    pub archived: bool,
    /// The derived **Overdue** flag: unfinished, not effectively Archived, and past the end of its
    /// due. Start keeps an Overdue item whose window has lapsed (see
    /// `is_startable_window` in [`super::rules`]).
    #[serde(default)]
    pub overdue: bool,
    /// The Task's own stored Backlog flag.
    #[serde(default)]
    pub backlogged: bool,
    /// A Commitment's recorded verdict.
    #[serde(default)]
    pub verdict: Option<Verdict>,
    /// Whether the node is marked private.
    #[serde(default)]
    pub is_private: bool,
    /// Whether a Task is delegated — held by a Person. Read by the Delegated pill (see
    /// [`crate::filters::rules::is_dropped_for_delegation`]); it is not archival.
    #[serde(default)]
    pub delegated: bool,
    /// Whether an Expectation is checked on — carries a Check every. Start shows a pending one only
    /// without it: with one, the virtual check task beneath it is what there is to do.
    #[serde(default)]
    pub has_check: bool,
    /// Whether a Task/Goal has any block reason, explicit or implied by an unmet dependency.
    #[serde(default)]
    pub is_blocked: bool,
    /// The node ids of the unmet dependencies a Task waits on — what its implied block reasons
    /// are made of. Under Start a blocked node still lets these through when they lie beneath it
    /// (see [`super::rules::gate_below`]).
    #[serde(default)]
    pub blocking_dependencies: Vec<String>,
    /// Whether the node has a direct child Task whose status is `todo` — what decides whether an
    /// in-progress Task still has something under it to start.
    #[serde(default)]
    pub has_todo_child: bool,
    /// Whether a Flow node is a Habit.
    #[serde(default)]
    pub is_habit_flow: bool,
    /// Whether this node is one of the occurrences a Habit generates in bulk.
    #[serde(default)]
    pub is_habit_occurrence: bool,
    /// The tag domain ids attached to the node.
    #[serde(default)]
    pub tag_ids: Vec<i64>,
    /// The node's **own** Time Scope, for the kinds that carry one. `None` inherits: what an
    /// ancestor's window says is not a fact of this node, and the filter walk carries it down
    /// (see [`super::rules::is_outside_plan_scope`]).
    #[serde(default)]
    pub time_scope: Option<TimeScope>,
    /// Whether a Task is Asynchronous: doing it starts a wait. Its own flag; it does not inherit.
    #[serde(default)]
    pub asynchronous: bool,
    /// The node ids a Task depends on, met or not — what a **Depends on** pill matches.
    #[serde(default)]
    pub dependencies: Vec<String>,
    /// Whether the node has a Plan of its own.
    #[serde(default)]
    pub planned: bool,
    /// Whether its lapse settled it as **Missed** — the Resolution that reads `lapsed` on the
    /// Scope pill.
    #[serde(default)]
    pub missed: bool,
    /// Whether a Task is **Compound**: it consists of its sub-items, and its status is derived.
    #[serde(default)]
    pub compound: bool,
    /// Whether an Expectation is an **agentic wait**: one an agent raised on the Task it hangs under.
    #[serde(default)]
    pub agent_waiting: bool,
}

impl NodeFacts {
    /// A bare node of `kind` with id `id` and every other fact at its neutral value.
    pub fn new(id: impl Into<String>, kind: NodeKind) -> Self {
        Self {
            id: id.into(),
            kind,
            status: None,
            agentic: false,
            timing: None,
            plan_timing: None,
            overdue: false,
            archived: false,
            backlogged: false,
            verdict: None,
            is_private: false,
            delegated: false,
            has_check: false,
            is_blocked: false,
            blocking_dependencies: Vec::new(),
            has_todo_child: false,
            is_habit_flow: false,
            is_habit_occurrence: false,
            tag_ids: Vec::new(),
            time_scope: None,
            asynchronous: false,
            dependencies: Vec::new(),
            planned: false,
            missed: false,
            compound: false,
            agent_waiting: false,
        }
    }

    /// The node's status, as a string slice, or `""` when it has none — the spelling the rules
    /// compare against.
    pub fn status_str(&self) -> &str {
        self.status.as_deref().unwrap_or("")
    }
}

#[cfg(test)]
mod tests;
