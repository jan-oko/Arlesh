//! Task and Goal resource models.

use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};

/// Identifies a task row by its primary key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskId(pub i64);

impl From<i64> for TaskId {
    fn from(value: i64) -> Self {
        Self(value)
    }
}
impl From<TaskId> for i64 {
    fn from(id: TaskId) -> Self {
        id.0
    }
}

/// Identifies a goal row by its primary key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct GoalId(pub i64);

impl From<i64> for GoalId {
    fn from(value: i64) -> Self {
        Self(value)
    }
}
impl From<GoalId> for i64 {
    fn from(id: GoalId) -> Self {
        id.0
    }
}

/// Task lifecycle status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    /// Not yet started.
    Todo,
    /// Currently being worked on.
    InProgress,
    /// Completed.
    Done,
}

impl TaskStatus {
    /// Returns the database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Todo => "todo",
            Self::InProgress => "in_progress",
            Self::Done => "done",
        }
    }

    /// Parses the database string representation, if recognized.
    pub fn from_db(value: &str) -> Option<Self> {
        match value {
            "todo" => Some(Self::Todo),
            "in_progress" => Some(Self::InProgress),
            "done" => Some(Self::Done),
            _ => None,
        }
    }
}

/// A Task's own manually-set archival state — the stored half of the
/// [`Archival`](super::lifecycle::Archival) axis, independent of [`TaskStatus`].
///
/// Two variants, not four. A Task is never manually **Archived** (a Task's effective Archival is
/// forced by its scope Resolution alone), and **Frozen** is Goal/Project vocabulary. Giving the
/// Task side its own type is what makes "Backlog is valid on Tasks only" a thing the compiler
/// knows rather than a comment: nothing can hand a Goal a `Backlog`, or a Task a `Frozen`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskArchival {
    /// In play, and filtered on its status alone. The default.
    #[default]
    Live,
    /// Deliberately set aside: hidden from Plan and Start along with everything beneath it, still
    /// listed under All, and browsable on its own through the Backlog preset.
    Backlog,
}

impl TaskArchival {
    /// Returns the database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Live => "live",
            Self::Backlog => "backlog",
        }
    }

    /// Parses the database string representation, if recognized.
    pub fn from_db(value: &str) -> Option<Self> {
        match value {
            "live" => Some(Self::Live),
            "backlog" => Some(Self::Backlog),
            _ => None,
        }
    }

    /// Whether a Task in this state may also carry a Plan.
    ///
    /// The stored invariant is `archival = Backlog ⇒ plan IS NULL`: a Task is never both set aside
    /// and scheduled, because the two say opposite things about the same week. Enforced at write
    /// time, in both directions — backlogging a planned Task is refused until the caller agrees to
    /// clear the Plan, and setting a Plan on a backlogged Task takes it out of the backlog.
    pub fn allows_plan(&self) -> bool {
        matches!(self, Self::Live)
    }
}

/// A Task's **Agentic** flag: whether the work suits being handed to an agent.
///
/// Three named states rather than a `bool`, because the flag inherits downward and is overridable
/// — the rule Delegation already uses. A Task with no value of its own reads its nearest flagged
/// ancestor, so marking a branch agentic is one edit; an explicit value replaces what it would
/// have inherited, in either direction.
///
/// Deliberately **not** spelled `Option<Option<bool>>` on an update request. That shape would nest
/// "leave unchanged" around "set to NULL", and serde reads an explicit JSON `null` as an absent
/// field — so clearing the flag over IPC would silently do nothing. Naming the three states makes
/// the wire honest and the intent readable: `Some(Inherit)` writes the NULL, `None` (the outer
/// `Option` on the request field) leaves the column alone.
///
/// Independent of the delegate: a Task may be agentic and delegated, either, or neither.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskAgentic {
    /// No value of its own — reads the nearest flagged ancestor. Stored as NULL, and the state
    /// every Task starts in.
    #[default]
    Inherit,
    /// Explicitly agentic, whatever the ancestors say.
    Yes,
    /// Explicitly not agentic, overriding an agentic ancestor.
    No,
}

impl TaskAgentic {
    /// The column value this state stores: `None` is the NULL that means *inherit*.
    pub fn as_column(self) -> Option<bool> {
        match self {
            Self::Inherit => None,
            Self::Yes => Some(true),
            Self::No => Some(false),
        }
    }

    /// The state a stored column value carries; a NULL column reads as [`Self::Inherit`].
    pub fn from_column(column: Option<bool>) -> Self {
        match column {
            None => Self::Inherit,
            Some(true) => Self::Yes,
            Some(false) => Self::No,
        }
    }

    /// A short rendering, for a prompt that has to name the value at stake.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Inherit => "inherit",
            Self::Yes => "yes",
            Self::No => "no",
        }
    }
}

/// Who holds a delegated Task: a **Person**, or the **Agent**.
///
/// A `(kind, id)` pair rather than a person id, so the model says what is true — delegating a
/// Task to an agent does not have to invent a Person called "Agent". There is one Agent target,
/// so the variant carries no id; naming individual agents is a later question.
///
/// On the wire it is `{"kind": "person", "id": 3}` or `{"kind": "agent"}`; in the `tasks` table it
/// is the `delegate_kind` / `delegate_id` column pair (migration 0037), whose CHECK allows exactly
/// the shapes this enum can hold.
///
/// Independent of the Agentic flag: the flag says the work suits an agent, the delegate says who
/// holds it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Delegate {
    /// Delegated to the Person with this id.
    Person {
        /// The `people` row the task is delegated to.
        id: i64,
    },
    /// Delegated to the Agent.
    Agent,
}

impl Delegate {
    /// `delegate_kind` for a Person delegate.
    const PERSON: &'static str = "person";
    /// `delegate_kind` for the Agent delegate.
    const AGENT: &'static str = "agent";

    /// The `(delegate_kind, delegate_id)` columns a delegate — or its absence — stores.
    pub fn columns(delegate: Option<Self>) -> (Option<&'static str>, Option<i64>) {
        match delegate {
            None => (None, None),
            Some(Self::Person { id }) => (Some(Self::PERSON), Some(id)),
            Some(Self::Agent) => (Some(Self::AGENT), None),
        }
    }

    /// The delegate a stored column pair holds. A pair the schema's CHECK would have refused — an
    /// unknown kind, or a Person without an id — reads as no delegate, the same fallback the other
    /// enum columns use.
    pub fn from_columns(kind: Option<&str>, id: Option<i64>) -> Option<Self> {
        match (kind?, id) {
            (Self::PERSON, Some(id)) => Some(Self::Person { id }),
            (Self::AGENT, _) => Some(Self::Agent),
            _ => None,
        }
    }

    /// A short rendering, for a prompt that has to name the value at stake.
    pub fn describe(self) -> String {
        match self {
            Self::Person { id } => format!("person {id}"),
            Self::Agent => Self::AGENT.to_string(),
        }
    }
}

/// Goal lifecycle status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalStatus {
    /// Actively being pursued.
    Active,
    /// Successfully achieved.
    Achieved,
    /// Temporarily paused.
    Frozen,
    /// No longer relevant.
    Archived,
}

impl GoalStatus {
    /// Returns the database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Achieved => "achieved",
            Self::Frozen => "frozen",
            Self::Archived => "archived",
        }
    }

    /// Parses the database string representation, if recognized.
    pub fn from_db(value: &str) -> Option<Self> {
        match value {
            "active" => Some(Self::Active),
            "achieved" => Some(Self::Achieved),
            "frozen" => Some(Self::Frozen),
            "archived" => Some(Self::Archived),
            _ => None,
        }
    }
}

/// What happens to a scoped item once its Time Scope has fully passed while still unfinished.
/// The single-occurrence form of a Habit's Consumption root.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OnScopeExit {
    /// The item **Lapses** — drops out of the active view.
    Archive,
    /// The item stays, flagged **Overdue**.
    Keep,
}

impl OnScopeExit {
    /// The database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Archive => "archive",
            Self::Keep => "keep",
        }
    }

    /// Parses the database string representation, if recognized.
    pub fn from_db(value: &str) -> Option<Self> {
        match value {
            "archive" => Some(Self::Archive),
            "keep" => Some(Self::Keep),
            _ => None,
        }
    }
}

/// The Duration parameters of a Time Scope, retained after snapshotting so the UI can keep
/// presenting and editing the scope in duration form.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DurationSpec {
    /// Number of scope-kind units (e.g. 3 in "3 weeks").
    pub n: i64,
    /// The scope kind the duration is expressed in (e.g. "week").
    pub kind: String,
}

/// An item's relevance window: a resolved boundaries `[start, end]` scope range (equal ids
/// denote a single scope), optionally tagged with the Duration parameters it came from.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TimeScope {
    /// Start boundary scope id.
    pub start_id: i64,
    /// End boundary scope id.
    pub end_id: i64,
    /// Duration parameters, when the scope was set in duration form.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<DurationSpec>,
}

/// A task row as returned from the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    /// Primary key.
    pub id: i64,
    /// Display title.
    pub title: String,
    /// Type of the parent entity.
    pub parent_type: String,
    /// Id of the parent entity.
    pub parent_id: i64,
    /// Current status.
    pub status: String,
    /// Who this task is delegated to — a Person or the Agent — if anyone.
    pub delegate_to: Option<Delegate>,
    /// Whether this task is explicitly Agentic. A null value inherits the nearest flagged
    /// ancestor; `Some` is an explicit value that replaces what would have been inherited.
    /// Independent of `delegate_to` — a task may be both.
    pub agentic: Option<bool>,
    /// Whether doing this task starts a **wait** — derived, `true` exactly when
    /// [`Self::async_template`] is set. Kept on the wire because the badge, the filter pill and the
    /// List View's Asynchronous section all ask only this.
    #[serde(default)]
    pub asynchronous: bool,
    /// The **Expectation template** that makes this task Asynchronous, or `None`. Completing the
    /// task spawns a virtual Expectation from it. It does not inherit: "starts a wait" is a
    /// property of one concrete action.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub async_template: Option<AsyncTemplate>,
    /// Relevance window (if set). A null value inherits the nearest scoped ancestor.
    pub time_scope: Option<TimeScope>,
    /// On-exit behavior; present iff `time_scope` is (inherited with the window otherwise).
    pub on_scope_exit: Option<OnScopeExit>,
    /// Scheduling window this task is planned into (if any). Must be contained in `time_scope`.
    pub plan: Option<TimeScope>,
    /// Manually-set archival state: `Live`, or `Backlog` when deliberately set aside. Never both
    /// `Backlog` and planned — see [`TaskArchival::allows_plan`].
    #[serde(default)]
    pub archival: TaskArchival,
    /// Tag domain ids attached to this task.
    pub tag_ids: Vec<i64>,
    /// Sort position among siblings; defaults to id (insertion order).
    pub position: i64,
    /// Whether this node is private (hidden unless Private Mode is on).
    pub is_private: bool,
    /// The `bd` issue tracking this task, if any (e.g. `"Arlesh-5fs"`). Sourced only from the MCP
    /// server, through [`TaskOperator::set_beads_id`](crate::tasks::TaskOperator::set_beads_id);
    /// [`UpdateTaskRequest`] deliberately has no field for it. Duplicating a node propagates
    /// the id it already has, and the Issue row's × drops the link — neither writes a new one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub beads_id: Option<String>,
}

/// A task row enriched with virtual block information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskWithBlockers {
    /// The base task.
    pub task: Task,
    /// All block reasons (explicit + virtual from dependencies).
    pub block_reasons: Vec<String>,
}

/// A single dependency edge: `task_id` depends on `(dependency_type, dependency_id)`. Returned by the
/// bulk-load endpoint so the mindmap can derive virtual "blocked by" reasons without a per-task call.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskDependencyEdge {
    /// The dependent task.
    pub task_id: i64,
    /// Kind of the dependency target: `task` or `goal`.
    pub dependency_type: String,
    /// Database id of the dependency target.
    pub dependency_id: i64,
}

/// A goal row as returned from the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Goal {
    /// Primary key.
    pub id: i64,
    /// Display title.
    pub title: String,
    /// Type of the parent entity.
    pub parent_type: String,
    /// Id of the parent entity.
    pub parent_id: i64,
    /// Current status.
    pub status: String,
    /// Relevance window (if set). A null value inherits the nearest scoped ancestor.
    pub time_scope: Option<TimeScope>,
    /// On-exit behavior; present iff `time_scope` is (inherited with the window otherwise).
    pub on_scope_exit: Option<OnScopeExit>,
    /// Tag domain ids attached to this goal.
    pub tag_ids: Vec<i64>,
    /// Sort position among siblings; defaults to id (insertion order).
    pub position: i64,
    /// Whether this node is private (hidden unless Private Mode is on).
    pub is_private: bool,
    /// The `bd` issue tracking this goal, if any (e.g. `"Arlesh-5fs"`). Sourced only from the MCP
    /// server, through [`GoalOperator::set_beads_id`](crate::tasks::GoalOperator::set_beads_id);
    /// [`UpdateGoalRequest`] deliberately has no field for it. Duplicating a node propagates
    /// the id it already has, and the Issue row's × drops the link — neither writes a new one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub beads_id: Option<String>,
}

/// Dependency reference: a task, a goal, or an expectation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Dependency {
    /// Depends on another task.
    Task {
        /// The task being depended on.
        id: i64,
    },
    /// Depends on a goal being achieved.
    Goal {
        /// The goal being depended on.
        id: i64,
    },
    /// Depends on an expectation being released.
    Expectation {
        /// The expectation being waited on.
        id: i64,
    },
}

/// Request body for creating a task.
#[derive(Debug, Default, Deserialize)]
pub struct CreateTaskRequest {
    /// Display title.
    pub title: String,
    /// Parent entity type.
    pub parent_type: String,
    /// Parent entity id.
    pub parent_id: i64,
    /// Initial status (defaults to Todo).
    pub status: Option<TaskStatus>,
    /// Initial relevance window.
    #[serde(default)]
    pub time_scope: Option<TimeScope>,
    /// On-exit behavior; applied only when `time_scope` is set (defaults to Keep).
    #[serde(default)]
    pub on_scope_exit: Option<OnScopeExit>,
    /// Initial Plan (scheduling window).
    #[serde(default)]
    pub plan: Option<TimeScope>,
    /// Initial archival state (defaults to Live). Rejected together with a `plan`.
    #[serde(default)]
    pub archival: Option<TaskArchival>,
    /// Initial Agentic state (defaults to Inherit, the stored NULL).
    #[serde(default)]
    pub agentic: Option<TaskAgentic>,
    /// `Some(true)` makes the new task Asynchronous with a default template; ignored when
    /// [`Self::async_template`] names one. Nothing arrives asynchronous otherwise.
    #[serde(default)]
    pub asynchronous: Option<bool>,
    /// The new task's Expectation template, when it is created Asynchronous with one in hand — a
    /// duplicate carrying its source's.
    #[serde(default)]
    pub async_template: Option<AsyncTemplate>,
}

/// Request body for updating a task.
#[derive(Debug, Default, Deserialize)]
pub struct UpdateTaskRequest {
    /// New title (if provided).
    pub title: Option<String>,
    /// New status (if provided).
    pub status: Option<TaskStatus>,
    /// Delegate to set — a Person or the Agent (None leaves unchanged, Some(None) clears it).
    #[serde(default, deserialize_with = "crate::wire::null_clears")]
    pub delegate_to: Option<Option<Delegate>>,
    /// Agentic state to set. `None` leaves the column unchanged; `Some(TaskAgentic::Inherit)`
    /// writes the NULL that puts the task back to inheriting. The three states are named rather
    /// than nested in a second `Option` — see [`TaskAgentic`] for why that shape is wrong here.
    pub agentic: Option<TaskAgentic>,
    /// The bare `W` toggle's shorthand: `Some(true)` gives the task a default template when it has
    /// none (and keeps one it has), `Some(false)` removes it, `None` leaves it. Ignored when
    /// [`Self::async_template`] is present, which says exactly what to write.
    pub asynchronous: Option<bool>,
    /// The Expectation template to set (None leaves it unchanged, Some(None) removes it — the task
    /// stops being Asynchronous).
    #[serde(default, deserialize_with = "crate::wire::null_clears")]
    pub async_template: Option<Option<AsyncTemplate>>,
    /// Relevance window to set (None leaves unchanged, Some(None) clears it).
    #[serde(default, deserialize_with = "crate::wire::null_clears")]
    pub time_scope: Option<Option<TimeScope>>,
    /// On-exit behavior to set (None leaves unchanged); forced NULL when the scope is cleared,
    /// defaulted to Keep when a scope is set without one.
    #[serde(default, deserialize_with = "crate::wire::null_clears")]
    pub on_scope_exit: Option<Option<OnScopeExit>>,
    /// Plan window to set (None leaves unchanged, Some(None) clears it).
    #[serde(default, deserialize_with = "crate::wire::null_clears")]
    pub plan: Option<Option<TimeScope>>,
    /// Archival state to set (None leaves unchanged).
    ///
    /// Left unset, a request that *sets* a Plan on a backlogged task silently resolves the
    /// conflict in the Plan's favour — see [`UpdateTaskRequest`]'s merge — and so does one that
    /// sets the task's status to `InProgress`, since work under way is not work set aside. Set to
    /// `Backlog` on a task that keeps its Plan, the write is refused until the caller also clears
    /// the Plan; set to `Backlog` alongside `InProgress`, it is taken at its word, because a task
    /// already under way may still be put down and keeps its status when it is.
    pub archival: Option<TaskArchival>,
    /// New parent entity type for re-parenting (must be set together with parent_id).
    pub parent_type: Option<String>,
    /// New parent entity id for re-parenting (must be set together with parent_type).
    pub parent_id: Option<i64>,
    /// New sort position among siblings (for sibling reordering).
    pub position: Option<i64>,
    /// New private flag, if changing.
    pub is_private: Option<bool>,
}

/// Request body for creating a goal.
#[derive(Debug, Default, Deserialize)]
pub struct CreateGoalRequest {
    /// Display title.
    pub title: String,
    /// Parent entity type.
    pub parent_type: String,
    /// Parent entity id.
    pub parent_id: i64,
    /// Initial status (defaults to Active).
    pub status: Option<GoalStatus>,
    /// Initial relevance window.
    #[serde(default)]
    pub time_scope: Option<TimeScope>,
    /// On-exit behavior; applied only when `time_scope` is set (defaults to Keep).
    #[serde(default)]
    pub on_scope_exit: Option<OnScopeExit>,
}

#[cfg(test)]
mod tests;

/// Request body for updating a goal.
#[derive(Debug, Default, Deserialize)]
pub struct UpdateGoalRequest {
    /// New title (if provided).
    pub title: Option<String>,
    /// New status (if provided).
    pub status: Option<GoalStatus>,
    /// Relevance window to set (None leaves unchanged, Some(None) clears it).
    #[serde(default, deserialize_with = "crate::wire::null_clears")]
    pub time_scope: Option<Option<TimeScope>>,
    /// On-exit behavior to set (None leaves unchanged); forced NULL when the scope is cleared,
    /// defaulted to Keep when a scope is set without one.
    #[serde(default, deserialize_with = "crate::wire::null_clears")]
    pub on_scope_exit: Option<Option<OnScopeExit>>,
    /// New parent entity type for re-parenting (must be set together with parent_id).
    pub parent_type: Option<String>,
    /// New parent entity id for re-parenting (must be set together with parent_type).
    pub parent_id: Option<i64>,
    /// New sort position among siblings (for sibling reordering).
    pub position: Option<i64>,
    /// New private flag, if changing.
    pub is_private: Option<bool>,
}

/// Identifies a commitment row by its primary key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommitmentId(pub i64);

impl From<i64> for CommitmentId {
    fn from(value: i64) -> Self {
        Self(value)
    }
}
impl From<CommitmentId> for i64 {
    fn from(id: CommitmentId) -> Self {
        id.0
    }
}

/// Whether a Commitment was held to. The Commitment kind's answer to a Task's status, and
/// deliberately **not** derived from anything.
///
/// Not from the window passing, and not from children completing. A Task untouched when its
/// window closes is Missed, but a Commitment untouched may well have been Kept, so there is no
/// honest default — and `Unresolved` carries real information, *you have not said*, that any
/// default would destroy. A polarity field (abstentions default Kept, obligations default Broken)
/// was considered and rejected on exactly this ground; see
/// `docs/adr/0005-commitment-node-kind.md`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    /// No judgement recorded. The default, and never reached by inference.
    #[default]
    Unresolved,
    /// Held to.
    Kept,
    /// Not held to. Recorded, never inferred — the point of the kind is being able to say this.
    Broken,
}

impl Verdict {
    /// Returns the database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Unresolved => "unresolved",
            Self::Kept => "kept",
            Self::Broken => "broken",
        }
    }

    /// Parses the database string representation, if recognized.
    pub fn from_db(value: &str) -> Option<Self> {
        match value {
            "unresolved" => Some(Self::Unresolved),
            "kept" => Some(Self::Kept),
            "broken" => Some(Self::Broken),
            _ => None,
        }
    }

    /// Whether a judgement has been recorded at all.
    ///
    /// The one thing every caller asks — the Verdict Window only runs against an *unresolved*
    /// commitment, and the Archival derivation only settles a *resolved* one — so it is stated
    /// once here rather than re-spelled as a `!= Unresolved` at each site.
    pub fn is_resolved(&self) -> bool {
        !matches!(self, Self::Unresolved)
    }
}

/// A commitment row as returned from the database.
///
/// Note what is **absent**, since the absences are the design: no `plan` (the window *is* the
/// commitment, so there is nothing to schedule it into), no `on_scope_exit` (a Commitment always
/// Keeps, and the Verdict Window is what eventually ends that), no `status`, no `archival`, no
/// `delegate_to`, and no dependency edges in either direction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Commitment {
    /// Primary key.
    pub id: i64,
    /// Display title.
    pub title: String,
    /// Type of the parent entity.
    pub parent_type: String,
    /// Id of the parent entity.
    pub parent_id: i64,
    /// Whether it was held to. Never derived — see [`Verdict`].
    pub verdict: Verdict,
    /// Relevance window (if set). A null value inherits the nearest scoped ancestor; unlike every
    /// other kind, the *effective* window may not be absent — a Commitment that can never come
    /// due is refused at write time.
    pub time_scope: Option<TimeScope>,
    /// How long past the end of its window this Commitment stays answerable, as a count of any
    /// scope kind. Null inherits the nearest ancestor Commitment that sets one; nothing above
    /// setting one means it never expires.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verdict_window: Option<DurationSpec>,
    /// Tag domain ids attached to this commitment.
    pub tag_ids: Vec<i64>,
    /// Sort position among siblings; defaults to id (insertion order).
    pub position: i64,
    /// Whether this node is private (hidden unless Private Mode is on).
    pub is_private: bool,
    /// The `bd` issue tracking this commitment, if any. Sourced only from the MCP server, through
    /// [`CommitmentOperator::set_beads_id`](crate::tasks::CommitmentOperator::set_beads_id); the
    /// UI can drop the link but never write one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub beads_id: Option<String>,
}

/// Request body for creating a commitment.
#[derive(Debug, Default, Deserialize)]
pub struct CreateCommitmentRequest {
    /// Display title.
    pub title: String,
    /// Parent entity type.
    pub parent_type: String,
    /// Parent entity id.
    pub parent_id: i64,
    /// Initial verdict (defaults to Unresolved). Present so a retype can carry one across; the
    /// editor never sends it, because a commitment nobody has judged yet is unresolved.
    #[serde(default)]
    pub verdict: Option<Verdict>,
    /// Initial relevance window. Omitted, the commitment inherits a scoped ancestor's — and is
    /// refused outright if there is none.
    #[serde(default)]
    pub time_scope: Option<TimeScope>,
    /// Initial Verdict Window. Omitted, it inherits the nearest ancestor Commitment's.
    #[serde(default)]
    pub verdict_window: Option<DurationSpec>,
}

/// Request body for updating a commitment.
#[derive(Debug, Default, Deserialize)]
pub struct UpdateCommitmentRequest {
    /// New title (if provided).
    pub title: Option<String>,
    /// New verdict (if provided). `Unresolved` is how a misclick is taken back.
    pub verdict: Option<Verdict>,
    /// Relevance window to set (None leaves unchanged, Some(None) clears it — which is refused
    /// unless a scoped ancestor still supplies one).
    #[serde(default, deserialize_with = "crate::wire::null_clears")]
    pub time_scope: Option<Option<TimeScope>>,
    /// Verdict Window to set (None leaves unchanged, Some(None) clears it back to inheriting).
    #[serde(default, deserialize_with = "crate::wire::null_clears")]
    pub verdict_window: Option<Option<DurationSpec>>,
    /// New parent entity type for re-parenting (must be set together with parent_id).
    pub parent_type: Option<String>,
    /// New parent entity id for re-parenting (must be set together with parent_type).
    pub parent_id: Option<i64>,
    /// New sort position among siblings (for sibling reordering).
    pub position: Option<i64>,
    /// New private flag, if changing.
    pub is_private: Option<bool>,
}

/// A Task's **Expectation template**: what the wait its completion spawns starts out as.
///
/// Thinner than an Expectation on purpose — only what a wait needs up front. No status: a status
/// exists only once the wait does. No parent: the spawned wait hangs under its Task.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AsyncTemplate {
    /// The spawned wait's title.
    pub title: String,
    /// Tags the spawned wait carries.
    #[serde(default)]
    pub tag_ids: Vec<i64>,
    /// The spawned wait's Time Scope **rule**: N of a kind, counted from the day the wait begins.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_scope: Option<DurationSpec>,
    /// How often to check on the spawned wait; the first check falls one interval after it begins.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub check_every: Option<DurationSpec>,
}

impl AsyncTemplate {
    /// The template the bare `W` toggle writes: a title derived from the task, and nothing else.
    pub fn for_task(task_title: &str) -> Self {
        Self {
            title: format!("Waiting on {task_title}"),
            ..Default::default()
        }
    }
}

/// The overlay of a Task's **spawned** Expectation — the virtual wait completing an Asynchronous
/// Task creates. Keyed by the Task: written when it is completed, deleted when it is un-completed.
/// Everything else the wait shows is read from the Task's template.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpawnedWait {
    /// The Task that spawned it.
    pub task_id: i64,
    /// When the Task was completed — when the wait began.
    pub spawned_at: NaiveDateTime,
    /// Pending or Released.
    pub status: ExpectationStatus,
    /// Live or Archived.
    pub archival: ExpectationArchival,
    /// When its last check was made, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_check_at: Option<NaiveDateTime>,
}

/// Request body for changing a spawned wait: release it, take the release back, or archive it.
#[derive(Debug, Default, Deserialize)]
pub struct UpdateSpawnedWaitRequest {
    /// New status (if provided).
    pub status: Option<ExpectationStatus>,
    /// New archival (if provided).
    pub archival: Option<ExpectationArchival>,
}

/// Identifies an expectation row by its primary key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExpectationId(pub i64);

impl From<i64> for ExpectationId {
    fn from(value: i64) -> Self {
        Self(value)
    }
}
impl From<ExpectationId> for i64 {
    fn from(id: ExpectationId) -> Self {
        id.0
    }
}

/// Where a wait stands: still being waited on, or over.
///
/// Two states and no third. An Expectation is not an action item, so it has no "in progress":
/// the thing it waits on happens somewhere else, and the only event on this side is noticing that
/// it has. **Released** is what unblocks the Tasks depending on it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExpectationStatus {
    /// Still waited on. The default, and what blocks dependents.
    #[default]
    Pending,
    /// The wait is over; dependents are free to go.
    Released,
}

impl ExpectationStatus {
    /// Returns the database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Released => "released",
        }
    }

    /// Parses the database string representation, if recognized.
    pub fn from_db(value: &str) -> Option<Self> {
        match value {
            "pending" => Some(Self::Pending),
            "released" => Some(Self::Released),
            _ => None,
        }
    }
}

/// Whether an Expectation is still in play: the usual archive, **orthogonal** to its status.
///
/// A wait can be put away without pretending it was released — the reply that will never come —
/// so this is its own column rather than a third status.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExpectationArchival {
    /// In play. The default.
    #[default]
    Live,
    /// Put away. Shown under All only.
    Archived,
}

impl ExpectationArchival {
    /// Returns the database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Live => "live",
            Self::Archived => "archived",
        }
    }

    /// Parses the database string representation, if recognized.
    pub fn from_db(value: &str) -> Option<Self> {
        match value {
            "live" => Some(Self::Live),
            "archived" => Some(Self::Archived),
            _ => None,
        }
    }
}

/// An expectation row as returned from the database: a **wait** that Tasks can depend on.
///
/// It carries a Time Scope and tags, like a Task. Note what is absent, since the absences are the
/// design: no Plan and no On-exit behaviour (a wait is not something you schedule, and it is never
/// Missed), no beads id, no block reasons and no dependencies of its own — it depends on nothing,
/// only Tasks depend on it. Beside its Time Scope it carries the optional **Check every**.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Expectation {
    /// Primary key.
    pub id: i64,
    /// Display title.
    pub title: String,
    /// Type of the parent entity.
    pub parent_type: String,
    /// Id of the parent entity.
    pub parent_id: i64,
    /// Pending or Released.
    pub status: ExpectationStatus,
    /// Live or Archived, independently of the status.
    pub archival: ExpectationArchival,
    /// Relevance window, if set. Its own only: a wait's window is validated against its nearest
    /// scoped ancestor's, but not inherited from it.
    pub time_scope: Option<TimeScope>,
    /// Tag domain ids attached to this expectation.
    pub tag_ids: Vec<i64>,
    /// How often to look in on it, if ever — a counted Duration. While it is set and the wait is
    /// pending, a virtual "check on it" task is due at [`Self::check_starting`], and after each
    /// check one interval after that check was made. Nothing is stored for a check but its time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub check_every: Option<DurationSpec>,
    /// When the first check falls due; set to the moment Check every is first given, unless the
    /// request names another.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub check_starting: Option<NaiveDateTime>,
    /// When the last check was made, if any. The next falls due one interval after it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_check_at: Option<NaiveDateTime>,
    /// Sort position among siblings.
    pub position: i64,
    /// Whether this node is private (hidden unless Private Mode is on).
    pub is_private: bool,
}

/// Request body for creating an expectation.
#[derive(Debug, Default, Deserialize)]
pub struct CreateExpectationRequest {
    /// Display title.
    pub title: String,
    /// Parent entity type.
    pub parent_type: String,
    /// Parent entity id.
    pub parent_id: i64,
    /// How often to check on it. Omitted, it is never checked.
    #[serde(default)]
    pub check_every: Option<DurationSpec>,
    /// When the first check falls due. Omitted with a Check every, it is the moment of creation.
    #[serde(default)]
    pub check_starting: Option<NaiveDateTime>,
    /// Initial relevance window. Omitted, the expectation has none.
    #[serde(default)]
    pub time_scope: Option<TimeScope>,
}

/// Request body for updating an expectation.
#[derive(Debug, Default, Deserialize)]
pub struct UpdateExpectationRequest {
    /// New title (if provided).
    pub title: Option<String>,
    /// New status (if provided). Releasing is a write of `Released`; `Pending` takes it back.
    pub status: Option<ExpectationStatus>,
    /// New archival (if provided).
    pub archival: Option<ExpectationArchival>,
    /// Check every to set (None leaves unchanged, Some(None) stops checking).
    #[serde(default, deserialize_with = "crate::wire::null_clears")]
    pub check_every: Option<Option<DurationSpec>>,
    /// When the first check falls due (None leaves unchanged). Setting a Check every with no
    /// Starting of its own starts it now.
    #[serde(default)]
    pub check_starting: Option<NaiveDateTime>,
    /// Relevance window to set (None leaves unchanged, Some(None) clears it).
    #[serde(default, deserialize_with = "crate::wire::null_clears")]
    pub time_scope: Option<Option<TimeScope>>,
    /// New parent entity type for re-parenting (must be set together with parent_id).
    pub parent_type: Option<String>,
    /// New parent entity id for re-parenting (must be set together with parent_type).
    pub parent_id: Option<i64>,
    /// New sort position among siblings (for sibling reordering).
    pub position: Option<i64>,
    /// New private flag, if changing.
    pub is_private: Option<bool>,
}

#[cfg(test)]
mod commitment_tests;
#[cfg(test)]
mod expectation_tests;
