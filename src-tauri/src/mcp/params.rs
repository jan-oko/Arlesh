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
use serde::Deserialize;

use crate::{flows::model::TargetRef, tasks::model};

/// A relevance or scheduling window, as an MCP caller supplies it.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct TimeScope {
    /// Start boundary scope id.
    pub start_id: i64,
    /// End boundary scope id. Equal to `start_id` for a single scope.
    pub end_id: i64,
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

impl From<TimeScope> for model::TimeScope {
    fn from(scope: TimeScope) -> Self {
        Self {
            start_id: scope.start_id,
            end_id: scope.end_id,
            duration: scope.duration.map(Into::into),
        }
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
    },
}

/// Turning the snapshot's scope ids into dates.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(tag = "operation", rename_all = "snake_case")]
#[schemars(extend("type" = "object"))]
pub enum ScopesOperation {
    /// One scope row by id.
    Get {
        /// Scope id.
        id: i64,
    },
    /// One scope resolved to concrete datetime boundaries.
    Resolve {
        /// Scope id.
        id: i64,
    },
    /// Several scopes resolved in one call, in the order given.
    ///
    /// Tasks and goals carry `time_scope` and `plan` as boundary scope *ids*, so reading a
    /// snapshot without this means one round trip per distinct id.
    ResolveMany {
        /// Scope ids, resolved positionally.
        ids: Vec<i64>,
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
