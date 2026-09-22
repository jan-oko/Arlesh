//! The values a filter is expressed in, and the facts it reads off a node.

use serde::{Deserialize, Serialize};

use crate::tasks::{lifecycle::Timing, model::Verdict};

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
    /// What can be begun now: Plan, minus lapsed windows, minus in-progress tasks with nothing
    /// left under them to start, minus Habit flows, minus blocked subtrees.
    Start,
    /// Only in-progress tasks.
    Do,
    /// Only Tasks deliberately set aside, together with their subtrees.
    Backlog,
}

/// A tri-state pill's override, on top of whatever the status preset would otherwise decide.
///
/// `Inactive` defers entirely to the preset; `Include` force-shows; `Exclude` force-hides, gating
/// the whole subtree. Shared by the Archived and Backlog pills, which behave identically.
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
}

impl Default for BoardFilter {
    /// The neutral filter: everything except nodes marked private.
    fn default() -> Self {
        Self {
            preset: Preset::All,
            unblock: false,
            include_flows: true,
            tags: Vec::new(),
            show_info: true,
            show_flow: true,
            private_mode: false,
            archived: OverrideMode::Inactive,
            backlog: OverrideMode::Inactive,
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
    /// The node's own stored status, where its kind has one (Task, Goal, Project).
    #[serde(default)]
    pub status: Option<String>,
    /// Derived window position, for the kinds that have a window.
    #[serde(default)]
    pub timing: Option<Timing>,
    /// Effective Archival is Archived — which a forced Resolution can set regardless of the stored
    /// status.
    #[serde(default)]
    pub archived: bool,
    /// The Task's own stored Backlog flag.
    #[serde(default)]
    pub backlogged: bool,
    /// A Commitment's recorded verdict.
    #[serde(default)]
    pub verdict: Option<Verdict>,
    /// Whether the node is marked private.
    #[serde(default)]
    pub is_private: bool,
    /// Whether a Task/Goal has any block reason, explicit or implied by an unmet dependency.
    #[serde(default)]
    pub is_blocked: bool,
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
}

impl NodeFacts {
    /// A bare node of `kind` with id `id` and every other fact at its neutral value.
    pub fn new(id: impl Into<String>, kind: NodeKind) -> Self {
        Self {
            id: id.into(),
            kind,
            status: None,
            timing: None,
            archived: false,
            backlogged: false,
            verdict: None,
            is_private: false,
            is_blocked: false,
            has_todo_child: false,
            is_habit_flow: false,
            is_habit_occurrence: false,
            tag_ids: Vec::new(),
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
