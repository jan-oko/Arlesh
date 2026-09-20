//! Flow (template) resource models.

use serde::{Deserialize, Deserializer, Serialize};

use crate::tasks::model::TimeScope;

/// Identifies a flow row by its primary key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct FlowId(pub i64);

impl From<i64> for FlowId {
    fn from(value: i64) -> Self {
        Self(value)
    }
}
impl From<FlowId> for i64 {
    fn from(id: FlowId) -> Self {
        id.0
    }
}

/// What a Flow's root (and children) materialize as.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InstanceType {
    /// Materializes as a Goal subtree.
    Goal,
    /// Materializes as a Task subtree.
    Task,
    /// Materializes as a Commitment.
    ///
    /// This is how a repeating rule — a nightly "asleep by 23:00" — recurs: through the Habit
    /// machinery that already exists, rather than a second recurrence engine. Each iteration's
    /// verdict is a Modification row keyed by (flow item, iteration scope), reusing the
    /// overridden-status slot; see `docs/adr/0005-commitment-node-kind.md`.
    Commitment,
}

impl InstanceType {
    /// The database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Goal => "goal",
            Self::Task => "task",
            Self::Commitment => "commitment",
        }
    }

    /// Parses the database string representation, defaulting to `Task`.
    ///
    /// A default rather than an `Option` because the column is CHECK-constrained and every
    /// caller here is reading a stored row: `Task` is what the old two-way `== "goal"` test
    /// already fell back to, kept so a corrupt row renders as something rather than nothing.
    pub fn from_db(value: &str) -> Self {
        match value {
            "goal" => Self::Goal,
            "commitment" => Self::Commitment,
            _ => Self::Task,
        }
    }
}

/// A flow (template) row.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Flow {
    /// Primary key.
    pub id: i64,
    /// Display title.
    pub title: String,
    /// What instances materialize as (`goal` or `task`).
    pub instance_type: String,
    /// Parent entity type (`aspect`/`project`/`domain`/`goal`).
    pub parent_type: String,
    /// Parent entity id.
    pub parent_id: i64,
    /// Explicit Target Node type for instances. `None` means "my parent" — the default is
    /// **derived** on read from `parent_type`/`parent_id`, never stored, so moving the flow moves
    /// its instances with it.
    pub target_type: Option<String>,
    /// Explicit Target Node id for instances; `None` alongside `target_type` means "my parent".
    pub target_id: Option<i64>,
    /// Flow-scope duration count (relative; anchored on start). For a Phase window this is 1.
    pub flow_duration_n: Option<i64>,
    /// Flow Window kind: a coarse **Span** (`day`/`week`/`month`/`season`) or a sub-day **Phase**
    /// (`part`/`exact`).
    pub flow_duration_kind: Option<String>,
    /// Phase-`part` band (e.g. `evening`); set iff kind is `part`.
    pub flow_window_part: Option<String>,
    /// Phase-`exact` window start time-of-day `HH:MM`; set iff kind is `exact`.
    pub flow_window_time_start: Option<String>,
    /// Phase-`exact` window end time-of-day `HH:MM`; set iff kind is `exact`.
    pub flow_window_time_end: Option<String>,
    /// Relative Cycle Plan for the **root** (task instance type only): plan window kind and
    /// start/end offsets within the flow window. All three set together, or all null (unplanned).
    pub root_plan_kind: Option<String>,
    /// Root Cycle Plan start offset within the flow window.
    pub root_plan_start: Option<i64>,
    /// Root Cycle Plan end offset within the flow window.
    pub root_plan_end: Option<i64>,
    /// **Verdict Window** count, for a commitment Habit: how long past the end of an iteration's
    /// window that iteration's verdict may still be recorded. Travels with
    /// [`Self::verdict_window_kind`]; `None` means iterations never stop being answerable.
    pub verdict_window_n: Option<i64>,
    /// Verdict Window kind (`day`/`week`/`month`/`season`), independent of the flow's own window
    /// kind — a monthly commitment habit may stay answerable for two days.
    pub verdict_window_kind: Option<String>,
    /// Whether this flow is a Habit (has a Recurrence) — derived, not stored on the flows row.
    #[sqlx(default)]
    pub is_habit: bool,
    /// Sort position among siblings.
    pub position: i64,
    /// Whether this flow is private (hidden unless Private Mode is on).
    pub is_private: bool,
}

/// A flow-goal (template item) row.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct FlowGoal {
    /// Primary key.
    pub id: i64,
    /// Owning flow.
    pub flow_id: i64,
    /// Display title.
    pub title: String,
    /// In-flow parent type (`flow` or `flow_goal`).
    pub parent_type: String,
    /// In-flow parent id (the flow, or a flow item).
    pub parent_id: i64,
    /// Sort position among siblings.
    pub position: i64,
    /// Whether this item is private (hidden unless Private Mode is on; propagates to its instances).
    pub is_private: bool,
}

/// A flow-task (template item) row.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct FlowTask {
    /// Primary key.
    pub id: i64,
    /// Owning flow.
    pub flow_id: i64,
    /// Display title.
    pub title: String,
    /// In-flow parent type (`flow`, `flow_goal`, or `flow_task`).
    pub parent_type: String,
    /// In-flow parent id (the flow, or a flow item).
    pub parent_id: i64,
    /// Sort position among siblings.
    pub position: i64,
    /// Whether this item is private (hidden unless Private Mode is on; propagates to its instances).
    pub is_private: bool,
}

/// Request body for creating a flow.
#[derive(Debug, Default, Deserialize)]
pub struct CreateFlowRequest {
    /// Display title.
    pub title: String,
    /// What instances materialize as.
    pub instance_type: Option<InstanceType>,
    /// Parent entity type.
    pub parent_type: String,
    /// Parent entity id.
    pub parent_id: i64,
    /// Explicit Target Node type; omit (or `None`) to leave the target derived from the parent.
    #[serde(default)]
    pub target_type: Option<String>,
    /// Explicit Target Node id; omit (or `None`) to leave the target derived from the parent.
    #[serde(default)]
    pub target_id: Option<i64>,
    /// Flow-scope duration count.
    #[serde(default)]
    pub flow_duration_n: Option<i64>,
    /// Flow Window kind (Span `day`/`week`/`month`/`season` or Phase `part`/`exact`).
    #[serde(default)]
    pub flow_duration_kind: Option<String>,
    /// Phase-`part` band, when kind is `part`.
    #[serde(default)]
    pub flow_window_part: Option<String>,
    /// Phase-`exact` window start time-of-day `HH:MM`, when kind is `exact`.
    #[serde(default)]
    pub flow_window_time_start: Option<String>,
    /// Phase-`exact` window end time-of-day `HH:MM`, when kind is `exact`.
    #[serde(default)]
    pub flow_window_time_end: Option<String>,
    /// Root Cycle Plan kind (task instance type only).
    #[serde(default)]
    pub root_plan_kind: Option<String>,
    /// Root Cycle Plan start offset within the flow window.
    #[serde(default)]
    pub root_plan_start: Option<i64>,
    /// Root Cycle Plan end offset within the flow window.
    #[serde(default)]
    pub root_plan_end: Option<i64>,
    /// Verdict Window count (commitment instance type only); set with `verdict_window_kind`.
    #[serde(default)]
    pub verdict_window_n: Option<i64>,
    /// Verdict Window kind; set with `verdict_window_n`.
    #[serde(default)]
    pub verdict_window_kind: Option<String>,
}

/// Deserialises an explicitly-null JSON field into `Some(None)` rather than `None`.
///
/// `Option<Option<T>>` is how an update request spells *absent = unchanged, null = clear*, but
/// serde collapses both spellings to `None` on its own — so a clear sent from the UI would be read
/// as "leave it alone" and swallowed without a word. Pair with `#[serde(default)]`, which restores
/// the absent case.
fn null_clears<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// Request body for updating a flow (fields left `None` are unchanged; `Some(None)` clears).
#[derive(Debug, Default, Deserialize)]
pub struct UpdateFlowRequest {
    /// New title.
    pub title: Option<String>,
    /// New instance type.
    pub instance_type: Option<InstanceType>,
    /// Target Node type (`Some(None)` clears it back to the derived parent default).
    #[serde(default, deserialize_with = "null_clears")]
    pub target_type: Option<Option<String>>,
    /// Target Node id (`Some(None)` clears it back to the derived parent default).
    #[serde(default, deserialize_with = "null_clears")]
    pub target_id: Option<Option<i64>>,
    /// Flow-scope duration count (Some(None) clears).
    pub flow_duration_n: Option<Option<i64>>,
    /// Flow Window kind (Some(None) clears).
    pub flow_duration_kind: Option<Option<String>>,
    /// Phase-`part` band (Some(None) clears).
    pub flow_window_part: Option<Option<String>>,
    /// Phase-`exact` window start time-of-day (Some(None) clears).
    pub flow_window_time_start: Option<Option<String>>,
    /// Phase-`exact` window end time-of-day (Some(None) clears).
    pub flow_window_time_end: Option<Option<String>>,
    /// Root Cycle Plan kind (Some(None) clears).
    pub root_plan_kind: Option<Option<String>>,
    /// Root Cycle Plan start offset (Some(None) clears).
    pub root_plan_start: Option<Option<i64>>,
    /// Root Cycle Plan end offset (Some(None) clears).
    pub root_plan_end: Option<Option<i64>>,
    /// Verdict Window count (`Some(None)` clears it, leaving iterations answerable indefinitely).
    #[serde(default, deserialize_with = "null_clears")]
    pub verdict_window_n: Option<Option<i64>>,
    /// Verdict Window kind (`Some(None)` clears).
    #[serde(default, deserialize_with = "null_clears")]
    pub verdict_window_kind: Option<Option<String>>,
    /// New parent type (with parent_id).
    pub parent_type: Option<String>,
    /// New parent id (with parent_type).
    pub parent_id: Option<i64>,
    /// New sort position.
    pub position: Option<i64>,
    /// New private flag, if changing.
    pub is_private: Option<bool>,
}

/// Request body for creating a flow item (goal or task).
#[derive(Debug, Default, Deserialize)]
pub struct CreateFlowItemRequest {
    /// Owning flow.
    pub flow_id: i64,
    /// Display title.
    pub title: String,
    /// In-flow parent type.
    pub parent_type: String,
    /// In-flow parent id.
    pub parent_id: i64,
}

/// Which flow-item table a row lives in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FlowItemType {
    /// A `flow_goals` row.
    FlowGoal,
    /// A `flow_tasks` row.
    FlowTask,
}

impl FlowItemType {
    /// The database string representation (`flow_goal` / `flow_task`).
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::FlowGoal => "flow_goal",
            Self::FlowTask => "flow_task",
        }
    }
}

/// Request body for updating a flow item (fields left `None` are unchanged; `Some(None)` clears).
#[derive(Debug, Default, Deserialize)]
pub struct UpdateFlowItemRequest {
    /// New title.
    pub title: Option<String>,
    /// New in-flow parent type (with parent_id).
    pub parent_type: Option<String>,
    /// New in-flow parent id (with parent_type).
    pub parent_id: Option<i64>,
    /// New sort position.
    pub position: Option<i64>,
    /// New private flag, if changing.
    pub is_private: Option<bool>,
}

/// A relative (Cycle Scope, Cycle Plan) pair carried by a flow item.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct FlowItemCycle {
    /// Primary key.
    pub id: i64,
    /// Owning flow.
    pub flow_id: i64,
    /// Which flow-item table the owner lives in (`flow_goal` / `flow_task`).
    pub item_type: String,
    /// Owning flow-item id.
    pub item_id: i64,
    /// Cycle-scope subkind (NULL = the whole flow scope).
    pub scope_kind: Option<String>,
    /// 1-based index of the cycle scope within the flow window.
    pub scope_index: Option<i64>,
    /// Cycle-plan subkind within the cycle scope (NULL = no plan).
    pub plan_kind: Option<String>,
    /// 1-based inclusive start of the cycle-plan range within the cycle scope.
    pub plan_start: Option<i64>,
    /// 1-based inclusive end of the cycle-plan range within the cycle scope.
    pub plan_end: Option<i64>,
    /// Sort position among the item's pairs.
    pub position: i64,
}

/// One (Cycle Scope, Cycle Plan) pair to persist for a flow item.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct FlowCycleInput {
    /// Cycle-scope subkind (None = the whole flow scope).
    #[serde(default)]
    pub scope_kind: Option<String>,
    /// 1-based index of the cycle scope within the flow window.
    #[serde(default)]
    pub scope_index: Option<i64>,
    /// Cycle-plan subkind (None = no plan).
    #[serde(default)]
    pub plan_kind: Option<String>,
    /// 1-based inclusive start of the cycle-plan range.
    #[serde(default)]
    pub plan_start: Option<i64>,
    /// 1-based inclusive end of the cycle-plan range.
    #[serde(default)]
    pub plan_end: Option<i64>,
}

/// Request body for starting a flow (materialising it under a target).
#[derive(Debug, Deserialize)]
pub struct StartFlowRequest {
    /// Title of the materialised root node.
    pub title: String,
    /// Target parent type the root is created under (`aspect`/`project`/`domain`/`goal`/`task`).
    pub target_type: String,
    /// Target parent id.
    pub target_id: i64,
    /// A date within the anchor scope of the flow's kind (the window's first period).
    pub anchor_date: chrono::NaiveDate,
}

/// The outcome of starting a flow: the materialised root node.
#[derive(Debug, Clone, Serialize)]
pub struct MaterializedFlow {
    /// Root node kind (`goal` or `task`).
    pub root_type: String,
    /// Root node id.
    pub root_id: i64,
}

/// A candidate target node for a flow, referenced by kind and id. Used by the target-picker
/// scope-validity check and the flow-origin lookup.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::FromRow)]
pub struct TargetRef {
    /// Node kind (`aspect`/`domain`/`project`/`goal`/`task`).
    pub node_type: String,
    /// Node id.
    pub node_id: i64,
}

/// A materialised node's originating flow: which real node it is and the flow it was started from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FlowOrigin {
    /// The real node's kind (`goal` / `task`).
    pub node_type: String,
    /// The real node's id.
    pub node_id: i64,
    /// Title of the flow this node was materialised from.
    pub flow_title: String,
}

/// An intra-flow dependency: `dependent` waits on `depends_on`.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct FlowDependency {
    /// Primary key.
    pub id: i64,
    /// Owning flow.
    pub flow_id: i64,
    /// The waiting item's type (`flow_goal` / `flow_task`).
    pub dependent_type: String,
    /// The waiting item's id.
    pub dependent_id: i64,
    /// The blocking item's type.
    pub depends_on_type: String,
    /// The blocking item's id.
    pub depends_on_id: i64,
}

/// How a Habit treats unfinished instances as their iterations pass.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConsumptionKind {
    /// Unfinished instances lapse (Archive-on-exit) once their iteration passes.
    Destructive,
    /// Unfinished instances survive past their iteration.
    Accumulating,
}

impl ConsumptionKind {
    /// The database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Destructive => "destructive",
            Self::Accumulating => "accumulating",
        }
    }
}

/// Whether an Accumulating Habit keeps generating iterations while unresolved instances exist.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockingMode {
    /// New iterations generate regardless of unresolved instances.
    Overlapping,
    /// New iterations are withheld while unresolved instances exist.
    Blocking,
}

impl BlockingMode {
    /// The database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Overlapping => "overlapping",
            Self::Blocking => "blocking",
        }
    }
}

/// When a Blocking Habit's open iteration completes, how it advances.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CatchupPolicy {
    /// Generate every missed iteration, in order.
    AllPending,
    /// Advance by a single iteration.
    Next,
    /// Jump to the current iteration, recording skipped ones as missed tombstones.
    Latest,
}

impl CatchupPolicy {
    /// The database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::AllPending => "all_pending",
            Self::Next => "next",
            Self::Latest => "latest",
        }
    }
}

/// A Habit's Recurrence: Repetition (Start, optional Gap, optional end) plus the Consumption config.
/// Its presence marks the owning flow as a Habit. Consumption fields follow the tree — `blocking_mode`
/// is set iff Accumulating, `catchup_policy` iff Blocking.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct FlowRecurrence {
    /// Owning flow (also the primary key — one recurrence per flow).
    pub flow_id: i64,
    /// The scope the recurrence starts on (of the flow's Duration kind).
    pub start_scope_id: i64,
    /// Idle span between one iteration window's end and the next's start; `None` = continuous.
    pub gap_n: Option<i64>,
    /// Kind of the Gap span (`day`/`week`/`month`/`season`); travels with `gap_n`.
    pub gap_kind: Option<String>,
    /// Optional end scope; `None` = open-ended.
    pub end_scope_id: Option<i64>,
    /// Destructive vs Accumulating.
    pub consumption_kind: String,
    /// Overlapping vs Blocking (set iff Accumulating).
    pub blocking_mode: Option<String>,
    /// Catch-up policy (set iff Blocking).
    pub catchup_policy: Option<String>,
}

/// Request to set (create or replace) a flow's Recurrence, making it a Habit.
#[derive(Debug, Clone, Deserialize)]
pub struct SetRecurrenceRequest {
    /// The scope the recurrence starts on (of the flow's Duration kind).
    pub start_scope_id: i64,
    /// Gap magnitude; `None` = continuous (no gap).
    pub gap_n: Option<i64>,
    /// Gap kind; must accompany `gap_n` and be no finer than the flow's Duration kind.
    pub gap_kind: Option<String>,
    /// Optional end scope; `None` = open-ended.
    pub end_scope_id: Option<i64>,
    /// Destructive vs Accumulating.
    pub consumption_kind: ConsumptionKind,
    /// Overlapping vs Blocking; required iff Accumulating.
    pub blocking_mode: Option<BlockingMode>,
    /// Catch-up policy; required iff Blocking.
    pub catchup_policy: Option<CatchupPolicy>,
}

/// The derived state of a Habit iteration on a given day (nothing is persisted — see the pure
/// classifier in `flows::habits`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IterationStatus {
    /// Open and awaiting completion.
    Active,
    /// Every instance in the iteration is complete.
    Done,
    /// Passed unfinished under a Destructive (Archive-on-exit) habit. Distinct from the deliberate
    /// goal `Archived` status — this is the derived "scope passed unfinished" state.
    Lapsed,
    /// Skipped by a Blocking `latest` catch-up.
    Missed,
    /// A **commitment** Habit's iteration whose Verdict Window ran out with no verdict recorded.
    ///
    /// Not a fifth verdict and not a failure: the Verdict stays unresolved for good, and only the
    /// Archival moves — the chance to say has gone. Distinct from [`Self::Lapsed`], which is a
    /// Destructive habit's unfinished *work* passing its window; a Commitment's work is never
    /// what passes, and nothing here ever concludes that one was broken.
    Expired,
}

/// Sentinel `cycle_id` for an occurrence that came from no cycle pair — an item that declares
/// none, and the flow root, which never has any. Zero rather than `NULL` because the value is part
/// of a UNIQUE key, and SQLite counts NULLs as distinct.
pub const NO_CYCLE: i64 = 0;

/// Where one occurrence sits relative to **its own** window at the reference instant.
///
/// One tri-state rather than a pair of booleans, because "its window has not come" and "its window
/// has gone" cannot both be true and a struct with two flags could say they were. It is exactly the
/// frontend's `Timing`, which it serializes to (`"pending"` / `"active"` / `"lapsed"`), so an
/// occurrence node is stamped with the value the backend derived rather than one re-derived from a
/// boolean on the other side of the wire.
///
/// `Pending` is not a statement about whether the occurrence is *actionable* — only about where the
/// clock stands. What it makes possible is the All preset showing this evening's item this morning,
/// which dropping the occurrence during generation made impossible for every preset at once.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InstanceTiming {
    /// Its window has not opened yet — this evening's item, seen at breakfast.
    Pending,
    /// Its window is open, or has passed without the Habit's Consumption closing it.
    Active,
    /// Its window has gone, under the Habit's Consumption — a Destructive Habit's Morning item is
    /// Lapsed from noon, while the iteration around it is still open.
    Lapsed,
}

/// One **virtual instance** of a flow item inside one Habit iteration: which item it draws, which
/// of that item's cycle pairs produced it, and the concrete window that pair resolves to within
/// this iteration.
///
/// An item with N pairs contributes N of these, exactly as `start` materialises N real nodes from
/// it. An item with no pairs contributes one, with `cycle_id` = [`NO_CYCLE`] and no window of its
/// own — it is relevant for as long as the iteration is.
///
/// The windows are resolved **here**, not in the frontend, because `start` resolves them here too
/// (`resolve_pair` / `offset_scope`, over the scope table) and a second implementation of the same
/// offset arithmetic would eventually disagree with this one about what "the 2nd day of week 3"
/// means.
///
/// An occurrence whose window has not opened yet is produced like any other, carrying
/// [`InstanceTiming::Pending`]: whether it is *visible* is a preset's decision, not generation's,
/// and All shows everything.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HabitInstance {
    /// Which flow-item table the instance draws (`flow_goal` / `flow_task`).
    pub item_type: String,
    /// The flow item's id.
    pub item_id: i64,
    /// The cycle pair that produced this occurrence, or [`NO_CYCLE`] when the item declares none.
    pub cycle_id: i64,
    /// The occurrence's resolved Cycle Scope, or `None` when it has no pair (it then inherits the
    /// iteration's own window).
    pub time_scope: Option<TimeScope>,
    /// The occurrence's resolved Cycle Plan, when its pair carries one.
    pub plan: Option<TimeScope>,
    /// Where the occurrence sits relative to its own window at the reference instant.
    pub timing: InstanceTiming,
}

/// One derived Habit iteration: its ordinal, the scope anchoring its window, current state, and the
/// instances it renders.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HabitIteration {
    /// Zero-based ordinal from the Repetition Start.
    pub index: i64,
    /// The scope anchoring the iteration window's first period (also the instance overlay key).
    pub anchor_scope_id: i64,
    /// The window's first day, ISO `YYYY-MM-DD` (drives the `{flow title} {start scope}` title).
    pub anchor_date: String,
    /// The window's **exclusive** end, ISO `YYYY-MM-DDTHH:MM:SS` — the iteration's window has
    /// passed once the reference instant has reached it.
    ///
    /// Sent because the frontend cannot derive it: the offset arithmetic that turns a Repetition
    /// into windows lives here, and a renderer redoing it is exactly the disagreement this module
    /// exists to prevent. It is what the Mindmap's collapse of passed iterations reads — under
    /// Overlapping Consumption nothing lapses, so [`IterationStatus`] alone cannot tell a window
    /// that has closed from one that is still open.
    pub window_end: String,
    /// Derived state on the reference day.
    pub status: IterationStatus,
    /// Every occurrence this iteration renders, in item order and then pair order. Empty from the
    /// pure classifier, which has no calendar; filled by [`generate_habit_iterations`].
    ///
    /// [`generate_habit_iterations`]: crate::flows::generate_habit_iterations
    pub instances: Vec<HabitInstance>,
}

/// Names one virtual Habit instance, as its Modification row is keyed: which item (or the
/// `flow_root` sentinel), which iteration, and which of the item's cycle pairs drew it.
///
/// The four travel together because they are one identity — an item with a morning and an evening
/// pair has two instances in the same iteration, and three of the four fields would name both.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct HabitInstanceRef {
    /// `flow_goal`, `flow_task`, or the `flow_root` sentinel.
    pub item_type: String,
    /// The flow item's id, or the flow id for the root.
    pub item_id: i64,
    /// The scope anchoring the iteration this instance belongs to.
    pub iteration_scope_id: i64,
    /// The cycle pair that drew it, or [`NO_CYCLE`] when the item declares none.
    #[serde(default)]
    pub cycle_id: i64,
}

/// One instance's divergent **status** for a Habit iteration — a non-tombstoned Modification (e.g.
/// `in_progress` or `done`). Lets the mindmap render each iteration instance's state; instances with
/// no Modification sit at their base status (task `todo` / goal `active`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, sqlx::FromRow)]
pub struct HabitItemStatus {
    /// Which instance the status is for (`flow_goal`, `flow_task`, or `flow_root`).
    pub item_type: String,
    /// The instance's id (a flow item id, or the flow id for `flow_root`).
    pub item_id: i64,
    /// The iteration scope the status applies to.
    pub iteration_scope_id: i64,
    /// Which of the item's cycle pairs the status belongs to, or [`NO_CYCLE`] for an item with
    /// none (and for the root). Two pairs on one item are two things to complete on the same day,
    /// so the iteration scope alone no longer identifies one instance.
    pub cycle_id: i64,
    /// The stored status (e.g. `in_progress`, `done`).
    pub status: String,
}

#[cfg(test)]
mod tests;
