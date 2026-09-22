//! Task and Goal resource models.

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
    /// Person id this task is delegated to (if any).
    pub delegate_to: Option<i64>,
    /// Whether this task is explicitly Agentic. A null value inherits the nearest flagged
    /// ancestor; `Some` is an explicit value that replaces what would have been inherited.
    /// Independent of `delegate_to` — a task may be both.
    pub agentic: Option<bool>,
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

/// Dependency reference: either a task or a goal.
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
}

/// Request body for updating a task.
#[derive(Debug, Default, Deserialize)]
pub struct UpdateTaskRequest {
    /// New title (if provided).
    pub title: Option<String>,
    /// New status (if provided).
    pub status: Option<TaskStatus>,
    /// Person to delegate to (None leaves unchanged, Some(None) clears it).
    #[serde(default, deserialize_with = "crate::wire::null_clears")]
    pub delegate_to: Option<Option<i64>>,
    /// Agentic state to set. `None` leaves the column unchanged; `Some(TaskAgentic::Inherit)`
    /// writes the NULL that puts the task back to inheriting. The three states are named rather
    /// than nested in a second `Option` — see [`TaskAgentic`] for why that shape is wrong here.
    pub agentic: Option<TaskAgentic>,
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
    /// conflict in the Plan's favour — see [`UpdateTaskRequest`]'s merge. Set to `Backlog` on a
    /// task that keeps its Plan, the write is refused until the caller also clears the Plan.
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

#[cfg(test)]
mod commitment_tests;
