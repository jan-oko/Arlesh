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

/// A node's id, as an agent may give it.
///
/// Either the row id a stored node carries in the snapshot (a number), or a **short id** (a
/// string): any prefix of a node's full id, at least 3 hex characters, that names one node the MCP
/// can see — the `short_id` the snapshot sends is always one. A prefix that matches several nodes
/// is refused as `ambiguous_id`, listing them; one that matches none as `not_permitted`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum NodeIdParam {
    /// A stored node's row id.
    Row(i64),
    /// A short id, or a full id.
    Short(String),
}

impl From<i64> for NodeIdParam {
    fn from(id: i64) -> Self {
        Self::Row(id)
    }
}

/// A reference to a node in the tree, by kind and id.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct NodeRef {
    /// Node kind: `aspect`, `domain`, `project`, `goal` or `task`.
    pub node_type: String,
    /// Node id: a row id or a short id.
    pub node_id: NodeIdParam,
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

/// The whole planning graph in one payload.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(tag = "operation", rename_all = "snake_case")]
#[schemars(extend("type" = "object"))]
pub enum SnapshotOperation {
    /// Everything one mindmap render reads: domains, goals, tasks, infos, flows, flow items,
    /// cycles, dependencies, block reasons, instance nodes, derived lifecycles, and each flow's
    /// habit iterations and statuses.
    Load {
        /// The reference instant lifecycles and habit iterations are derived at: a local date and
        /// time string, `"2026-09-25T09:00:00"`. Omit it for the server's current time — the usual
        /// case; pass one only to see the board as of another moment.
        #[serde(default)]
        now: Option<chrono::NaiveDateTime>,
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
        /// Only the Tasks that read as **Agentic** — their own flag, or their nearest flagged
        /// ancestor's, stored rows and Habit occurrences alike — with the rows they hang from, for
        /// context, and their waits and notes. `{}` for all of them; `{"max_priority": "A"}` for MW
        /// and A only. Tasks come most urgent first, and each carries `reads_agentic`: `true` for
        /// a match, `false` for a context row. The Flow sections are left out. Omit for no such
        /// narrowing. Pass the same value on every page.
        #[serde(default)]
        agentic: Option<AgenticQuery>,
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

/// A Task status, as the status write names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatusParam {
    /// Not started.
    Todo,
    /// Under way. Starting an Agentic Task needs a Spec in its brief.
    InProgress,
    /// Finished.
    Done,
}

impl From<TaskStatusParam> for model::TaskStatus {
    fn from(status: TaskStatusParam) -> Self {
        match status {
            TaskStatusParam::Todo => Self::Todo,
            TaskStatusParam::InProgress => Self::InProgress,
            TaskStatusParam::Done => Self::Done,
        }
    }
}

/// An agentic brief, or the fields of one to change. Each field left out stays as it is (on
/// create: empty).
#[derive(Debug, Clone, Default, Deserialize, JsonSchema)]
pub struct BriefParam {
    /// Priority `"MW"`, `"A"`, `"B"` or `"C"`, most urgent first; `null` for none.
    #[serde(default, deserialize_with = "crate::wire::null_clears")]
    pub priority: Option<Option<model::AgenticPriority>>,
    /// What to build. A Task that reads as Agentic cannot start without one.
    #[serde(default)]
    pub spec: Option<String>,
    /// How to build it.
    #[serde(default)]
    pub design: Option<String>,
    /// How to tell it is done.
    #[serde(default)]
    pub acceptance: Option<String>,
    /// Anything else.
    #[serde(default)]
    pub notes: Option<String>,
}

impl BriefParam {
    /// `self` written over `base`.
    pub fn over(self, base: model::AgenticBrief) -> model::AgenticBrief {
        model::AgenticBrief {
            priority: self.priority.unwrap_or(base.priority),
            spec: self.spec.unwrap_or(base.spec),
            design: self.design.unwrap_or(base.design),
            acceptance: self.acceptance.unwrap_or(base.acceptance),
            notes: self.notes.unwrap_or(base.notes),
        }
    }
}

/// The snapshot's agentic query.
#[derive(Debug, Clone, Default, Deserialize, JsonSchema)]
pub struct AgenticQuery {
    /// Only Tasks at this priority or more urgent — `"A"` means `MW` and `A`. A Task with no
    /// priority is then left out.
    #[serde(default)]
    pub max_priority: Option<model::AgenticPriority>,
}

/// Task reads the snapshot does not answer, and the writes an agent may make.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(tag = "operation", rename_all = "snake_case")]
#[schemars(extend("type" = "object"))]
pub enum TasksOperation {
    /// One task with its block reasons — explicit ones and those implied by its dependencies.
    Get {
        /// Task id: a row id or a short id.
        id: NodeIdParam,
    },
    /// Creates a Task — always Agentic — under a node inside an MCP root that can hold one: a
    /// domain or project, a goal, a task, a commitment, or a Habit occurrence. Never under a Task
    /// explicitly marked Not agentic.
    Create {
        /// The parent's kind: `domain`, `project`, `goal`, `task` or `commitment`.
        parent_type: String,
        /// The parent's id: a row id or a short id.
        parent_id: NodeIdParam,
        /// The new Task's title.
        title: String,
        /// Its agentic brief.
        #[serde(default)]
        brief: Option<BriefParam>,
    },
    /// Edits an Agentic Task's fields: its title, its brief, whether it is set aside.
    Update {
        /// Task id: a row id or a short id.
        id: NodeIdParam,
        /// New title.
        #[serde(default)]
        title: Option<String>,
        /// Brief fields to change.
        #[serde(default)]
        brief: Option<BriefParam>,
        /// `true` sets it aside in the Backlog, `false` puts it back in play.
        #[serde(default)]
        backlog: Option<bool>,
    },
    /// Changes an Agentic Task's status **if it is still `expected`** — one compare-and-set step.
    /// Otherwise refused as `status_changed`, naming the current status, and nothing is written.
    SetStatus {
        /// Task id: a row id or a short id.
        id: NodeIdParam,
        /// The status you last saw.
        expected: TaskStatusParam,
        /// The status to set.
        status: TaskStatusParam,
    },
    /// Moves an Agentic Task under another parent. Needs create permission at both its old and
    /// its new parent. A Habit occurrence cannot move.
    Move {
        /// Task id: a row id or a short id.
        id: NodeIdParam,
        /// The new parent's kind.
        parent_type: String,
        /// The new parent's id: a row id or a short id.
        parent_id: NodeIdParam,
    },
    /// Archives an Agentic Habit occurrence, as the app archives one; it is never deleted.
    /// Archiving a stored Task by hand is not supported yet, and is refused as `not_permitted`.
    Archive {
        /// Task id: a row id or a short id.
        id: NodeIdParam,
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
        /// Flow id: a row id or a short id.
        id: NodeIdParam,
    },
    /// A flow's stored recurrence configuration, as opposed to the iterations derived from it.
    /// `null` when the flow is not a Habit.
    Recurrence {
        /// Flow id: a row id or a short id.
        flow_id: NodeIdParam,
    },
    /// How many of a Habit's iterations are complete.
    CompletionCount {
        /// Flow id: a row id or a short id.
        flow_id: NodeIdParam,
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
        /// The resource's id: a row id or a short id.
        node_id: NodeIdParam,
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
        task_id: NodeIdParam,
        /// What the agent is waiting for, as the wait's title.
        title: String,
        /// The agent's question, in full.
        #[serde(default)]
        note: Option<String>,
    },
}
