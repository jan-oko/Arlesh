//! Input types for the MCP tools.
//!
//! These mirror the domain request types rather than reusing them. Two reasons: `Parameters<T>`
//! requires `schemars::JsonSchema`, and deriving it on the domain models would spread the MCP
//! schema generator across `tasks/`, `flows/` and `scopes/` for the benefit of one adapter. More
//! importantly, the wire contract an agent codes against should be able to change independently of
//! the storage model — the conversions below are the seam where that divergence would live.
//!
//! Outputs need no equivalent: tool results are built with
//! [`CallToolResult::structured`](rmcp::model::CallToolResult::structured) from a plain
//! `serde_json::Value`, so the domain models serialise straight through with the serde
//! representation the frontend already receives.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    flows::model::TargetRef,
    scopes::{error::ScopeError, key::ScopeKey},
    tasks::model,
};

/// A scope's id: its value key, a JSON object tagged by `kind` that names the scope's own start.
///
/// The mirror of [`ScopeKey`] with a schema; converting it runs the key's own validation, so a
/// week keyed by a Wednesday is refused here exactly as everywhere else.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ScopeKeyParam {
    /// A Season, by its first day (the 1st of December, March, June or September).
    Season {
        /// `YYYY-MM-DD`.
        date: String,
    },
    /// A Month, by its first day.
    Month {
        /// `YYYY-MM-DD`.
        date: String,
    },
    /// A Sunday-to-Saturday Week, by its Sunday.
    Week {
        /// `YYYY-MM-DD`, a Sunday.
        date: String,
    },
    /// A Day.
    Day {
        /// `YYYY-MM-DD`.
        date: String,
    },
    /// A Part of Day, on the day it starts on.
    PartOfDay {
        /// `YYYY-MM-DD`.
        date: String,
        /// `premorning`, `morning`, `noon`, `afternoon`, `evening` or `night`.
        part: String,
    },
    /// A half-open `[start, end)` window.
    Exact {
        /// `YYYY-MM-DDTHH:MM:SS`.
        start: String,
        /// `YYYY-MM-DDTHH:MM:SS`, after `start`.
        end: String,
    },
}

impl TryFrom<ScopeKeyParam> for ScopeKey {
    type Error = ScopeError;

    fn try_from(param: ScopeKeyParam) -> Result<Self, Self::Error> {
        // One validation, the key's own: the mirror is re-read through it.
        let value = serde_json::to_value(&param)
            .map_err(|error| ScopeError::MalformedKey(format!("{param:?}"), error.to_string()))?;
        serde_json::from_value(value)
            .map_err(|error| ScopeError::MalformedKey(format!("{param:?}"), error.to_string()))
    }
}

/// A relevance or scheduling window, as an MCP caller supplies it.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct TimeScope {
    /// Start boundary scope id: a value key such as `{"kind":"week","date":"2026-09-20"}`.
    pub start_id: ScopeKeyParam,
    /// End boundary scope id. Equal to `start_id` for a single scope.
    pub end_id: ScopeKeyParam,
    /// Duration parameters, when the window was expressed in duration form.
    #[serde(default)]
    pub duration: Option<DurationSpec>,
}

/// A window expressed as a count of scope-kind units.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct DurationSpec {
    /// Number of scope-kind units (e.g. 3 in "3 weeks").
    pub n: i64,
    /// The scope kind the duration is expressed in (e.g. "week").
    pub kind: String,
}

/// A reference to a node in the tree, by kind and id.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct NodeRef {
    /// Node kind: `aspect`, `domain`, `project`, `goal` or `task`.
    pub node_type: String,
    /// Node id.
    pub node_id: i64,
}

impl From<DurationSpec> for model::DurationSpec {
    fn from(spec: DurationSpec) -> Self {
        Self {
            n: spec.n,
            kind: spec.kind,
        }
    }
}

impl TryFrom<TimeScope> for model::TimeScope {
    type Error = ScopeError;

    fn try_from(scope: TimeScope) -> Result<Self, Self::Error> {
        Ok(Self {
            start_id: ScopeKey::try_from(scope.start_id)?,
            end_id: ScopeKey::try_from(scope.end_id)?,
            duration: scope.duration.map(Into::into),
        })
    }
}

impl From<NodeRef> for TargetRef {
    fn from(node: NodeRef) -> Self {
        Self {
            node_type: node.node_type,
            node_id: node.node_id,
        }
    }
}

/// The whole planning graph in one payload.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(tag = "operation", rename_all = "snake_case")]
#[schemars(extend("type" = "object"))]
pub enum SnapshotOperation {
    /// Everything one mindmap render reads: domains, goals, tasks, infos, flows, flow items,
    /// cycles, dependencies, block reasons, instance nodes, derived lifecycles, and each flow's
    /// habit iterations and statuses.
    Load {
        /// The reference instant lifecycles and habit iterations are derived at.
        now: chrono::NaiveDateTime,
        /// Only these sections, instead of all of them. Omit for everything.
        ///
        /// A question about scheduling needs `tasks` and `lifecycles`, not the knowledge of every
        /// flow cycle on the board; asking for less is the cheapest way to make a page go further.
        #[serde(default)]
        sections: Option<Vec<super::paging::Section>>,
        /// Where to resume, taken verbatim from the previous page's `next_cursor`.
        ///
        /// Omit for the first page. Never construct one by hand — its form is not a promise.
        #[serde(default)]
        cursor: Option<String>,
        /// Read the board under one of the List View's status presets, instead of whole.
        ///
        /// `{"preset": "start"}` answers "what can I begin now?" with the rules the user is
        /// looking at, rather than an approximation assembled from `lifecycles`. Omit it — the
        /// default — for every node on the board.
        ///
        /// It narrows the domain, goal, task, commitment, expectation and info sections, and the lifecycles,
        /// block reasons and dependencies derived from them. The flow sections are never narrowed:
        /// a Flow's subtree and a Habit's occurrences are assembled from these rows rather than
        /// being rows themselves, so there is nothing for a preset to judge.
        #[serde(default)]
        filter: Option<crate::filters::model::BoardFilter>,
    },
}

/// What a scope's value key does not spell out: its label, its end, its datetime window.
///
/// A scope id is its value key — `{"kind":"week","date":"2026-09-20"}`,
/// `{"kind":"part_of_day","date":"2026-09-23","part":"morning"}`,
/// `{"kind":"exact","start":"2026-09-23T14:00:00","end":"2026-09-23T15:30:00"}` and so on — so its
/// start date is already in the id.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(tag = "operation", rename_all = "snake_case")]
#[schemars(extend("type" = "object"))]
pub enum ScopesOperation {
    /// One scope, with its label and inclusive end date.
    Get {
        /// Scope id (value key).
        id: ScopeKeyParam,
    },
    /// One scope resolved to its half-open datetime window and whether it is active.
    Resolve {
        /// Scope id (value key).
        id: ScopeKeyParam,
    },
    /// Several scopes resolved in one call, in the order given, against one reference instant.
    ResolveMany {
        /// Scope ids (value keys), resolved positionally.
        ids: Vec<ScopeKeyParam>,
    },
}

/// People, events and threads — the resources the snapshot does not carry.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(tag = "operation", rename_all = "snake_case")]
#[schemars(extend("type" = "object"))]
pub enum KbOperation {
    /// Every person.
    ListPeople,
    /// One person by id.
    GetPerson {
        /// Person id.
        id: i64,
    },
    /// Every event.
    ListEvents,
    /// Every thread.
    ListThreads,
}

/// Task reads the snapshot does not answer.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(tag = "operation", rename_all = "snake_case")]
#[schemars(extend("type" = "object"))]
pub enum TasksOperation {
    /// One task with its block reasons — explicit ones and those implied by its dependencies.
    Get {
        /// Task id.
        id: i64,
    },
    /// Which descendants would violate containment if a node were given this window.
    ///
    /// A what-if query: it changes nothing.
    ContainmentConflicts {
        /// The node whose window would change.
        node: NodeRef,
        /// The window to test.
        time_scope: TimeScope,
    },
}

/// Flow reads the snapshot does not answer.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(tag = "operation", rename_all = "snake_case")]
#[schemars(extend("type" = "object"))]
pub enum FlowsOperation {
    /// One flow by id.
    Get {
        /// Flow id.
        id: i64,
    },
    /// A flow's stored recurrence configuration, as opposed to the iterations derived from it.
    /// `null` when the flow is not a Habit.
    Recurrence {
        /// Flow id.
        flow_id: i64,
    },
    /// How many of a Habit's iterations are complete.
    CompletionCount {
        /// Flow id.
        flow_id: i64,
    },
    /// For each given node, the flow it was materialised from, if any.
    Origins {
        /// The nodes to look up.
        nodes: Vec<NodeRef>,
    },
}

/// Which resource an issue link is being set on.
#[derive(Debug, Clone, Copy, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum BeadsNode {
    /// A Task.
    Task,
    /// A Goal.
    Goal,
    /// A Commitment.
    Commitment,
    /// A Project — the `project` subtype of Domain. Aspects, Domains and Tags cannot be linked.
    Project,
}

/// The one write on this server: linking an item to a `bd` issue.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(tag = "operation", rename_all = "snake_case")]
#[schemars(extend("type" = "object"))]
pub enum BeadsOperation {
    /// Links a Task, Goal, Commitment or Project to a `bd` issue, or clears the link.
    ///
    /// This is the only way the link can be *set*: the one Tauri command that writes the column
    /// only ever clears it, so an issue id in Arlesh always came from here.
    Set {
        /// Which kind of resource to link.
        node_type: BeadsNode,
        /// The resource's id.
        node_id: i64,
        /// The `bd` issue id, e.g. `Arlesh-5fs`. `null` clears the link.
        beads_id: Option<String>,
    },
}

/// What [`BeadsOperation::Set`] echoes back, so a caller sees the link that now stands.
#[derive(Debug, Clone, serde::Serialize)]
pub struct BeadsLink {
    /// The resource kind, as given.
    pub node_type: String,
    /// The resource id, as given.
    pub node_id: i64,
    /// The issue id now stored, or `null` if the link was cleared.
    pub beads_id: Option<String>,
}

/// The operations on the waits an agent raises.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(tag = "operation", rename_all = "snake_case")]
#[schemars(extend("type" = "object"))]
pub enum WaitsOperation {
    /// Raises an agentic wait under an Agentic Task the MCP can write: "the agent is waiting on
    /// you". The user answers by writing into the note and releasing the wait.
    Ask {
        /// The Agentic Task the agent is working, which the wait hangs under.
        task_id: i64,
        /// What the agent is waiting for, as the wait's title.
        title: String,
        /// The agent's question, in full.
        #[serde(default)]
        note: Option<String>,
    },
}
