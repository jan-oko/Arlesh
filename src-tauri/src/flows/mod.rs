//! Flows: templates for Goal/Task subtrees, materialized on demand.
//!
//! Single-resource SQL over the flow tables lives on [`FlowOperator`]. Everything that also has to
//! reach scopes, tasks or goals — [`start`], [`convert_to_flow`], [`valid_targets`],
//! [`generate_habit_iterations`] — is a **free function over a [`Db`] session** instead, as is
//! every operation whose write depends on a read it took first ([`update_flow`], [`delete_flow`],
//! [`convert_flow_item`], [`set_flow_recurrence`], [`set_iteration_done`], [`fork_flow`] and the
//! two item updates). Those take `&mut Db<Transactional>` specifically, so calling one
//! non-atomically is a compile error; the operator halves they drive are module-private. See
//! [`Db`]'s `# Where an operation lives`.
//!
//! The scope helpers — `offset_scope`, `resolve_pair`, `resolve_window`, `resolve_flow_window`,
//! `habit_slots` — take a single [`ScopeOperator`], not the session: they need exactly one
//! resource and ADR-0004 keeps that precision.

pub mod error;
pub mod habits;
pub mod model;
mod render;

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{Datelike, Duration, Months, NaiveDate, NaiveDateTime, NaiveTime};

use crate::database::session::{Db, SessionMode, Transactional};
use crate::scopes::model::{PartOfDay, Scope, ScopeId, ScopeKind};
use crate::scopes::resolve::{interval_contains, scope_bounds};
use crate::scopes::ScopeOperator;
use habits::{classify_iterations, Catchup, Consumption, SlotWindow};
use crate::tasks::model::{
    CommitmentId, CreateCommitmentRequest, CreateGoalRequest, CreateTaskRequest, Dependency,
    DurationSpec, GoalId, TaskId, TimeScope,
};
use crate::tasks::{
    add_task_dependency, create_commitment, create_goal, create_task, delete_goal, delete_task,
    nearest_scoped_ancestor_window, time_scope_window,
};
use error::FlowError;
use render::{
    render, FlowTemplate, NodeRef, PlannedSource, RenderedPlan, ResolvedPair, ScopeTable,
    TemplateItem,
};
use model::{
    BlockingMode, ConsumptionKind, CreateFlowItemRequest, CreateFlowRequest, Flow, FlowCycleInput,
    FlowDependency, FlowGoal, FlowId, FlowItemCycle, FlowItemType, FlowOrigin, FlowRecurrence,
    FlowTask, HabitIteration, HabitItemStatus, InstanceType, MaterializedFlow,
    SetRecurrenceRequest, StartFlowRequest, TargetRef, UpdateFlowItemRequest, UpdateFlowRequest,
};

/// Sentinel `item_type` for the flow **root** instance in `habit_instance_modifications`. The root is
/// an instance in its own right (not just an aggregate of items); its rows key `item_id` to the flow
/// id so they stay unique per flow on a shared iteration scope.
const ROOT_INSTANCE_TYPE: &str = "flow_root";

/// Advances `date` by `k` (possibly zero) periods of `kind`; `None` on calendar overflow.
fn advance(date: NaiveDate, k: i64, kind: &str) -> Option<NaiveDate> {
    match kind {
        "day" => date.checked_add_signed(Duration::days(k)),
        "week" => date.checked_add_signed(Duration::days(k * 7)),
        "month" => date.checked_add_months(Months::new(u32::try_from(k).ok()?)),
        "season" => date.checked_add_months(Months::new(u32::try_from(k * 3).ok()?)),
        _ => None,
    }
}

/// Maps a target node kind to the parent_type a real goal/task uses (domain-table kinds → project).
fn target_parent_type(kind: &str) -> String {
    match kind {
        "goal" => "goal",
        "task" => "task",
        _ => "project",
    }
    .to_string()
}

/// A safe lower bound, in days, on the shortest possible window a single period of `kind` can span
/// (Feb is the 28-day floor for months; the shortest 3-month run bounds seasons). Used by the
/// anchor-free coarse target filter to reject targets that could never hold the flow window.
fn min_period_days(kind: &str) -> Result<i64, FlowError> {
    Ok(match kind {
        // Phase windows are sub-day, so they impose no day-floor on a candidate target — the exact
        // containment check at start does the real work.
        "part" | "exact" => 0,
        "day" => 1,
        "week" => 7,
        "month" => 28,
        "season" => 89,
        other => return Err(FlowError::Invalid(format!("unsupported flow kind {other}"))),
    })
}

/// A resolved Flow Window shape, ready to materialize per anchor: a coarse **Span** of canonical
/// scopes, or a sub-day **Phase** (a part-of-day band, or an exact time-of-day range).
enum WindowSpec {
    /// Coarse: `n` periods of a canonical `kind`; windows tile contiguously (before the Gap).
    Span {
        /// Number of periods per window.
        n: i64,
        /// Canonical scope kind.
        kind: ScopeKind,
        /// The kind string (for `advance`).
        kind_str: String,
    },
    /// Sub-day part-of-day band, at the same band each occurrence.
    Part(PartOfDay),
    /// Sub-day exact time-of-day range `[start, end)`, at the same clock times each occurrence.
    Exact {
        /// Window start time-of-day.
        start: NaiveTime,
        /// Window end time-of-day.
        end: NaiveTime,
    },
}

/// Parses an `HH:MM` time-of-day for an exact Phase window.
fn parse_hhmm(value: Option<&str>) -> Result<NaiveTime, FlowError> {
    let value =
        value.ok_or_else(|| FlowError::Invalid("exact flow window needs a time range".to_string()))?;
    NaiveTime::parse_from_str(value, "%H:%M").map_err(|e| FlowError::Invalid(e.to_string()))
}

/// Reads a flow's Flow Window into a [`WindowSpec`]. Phase kinds draw their band/time from the
/// date-free descriptor columns; Span kinds use the `n`/canonical-kind Duration.
fn window_spec(flow: &Flow, kind: &str, n: i64) -> Result<WindowSpec, FlowError> {
    match kind {
        "part" => {
            let band = flow
                .flow_window_part
                .as_deref()
                .and_then(PartOfDay::parse_db)
                .ok_or_else(|| FlowError::Invalid("part flow window needs a valid band".to_string()))?;
            Ok(WindowSpec::Part(band))
        }
        "exact" => Ok(WindowSpec::Exact {
            start: parse_hhmm(flow.flow_window_time_start.as_deref())?,
            end: parse_hhmm(flow.flow_window_time_end.as_deref())?,
        }),
        _ => Ok(WindowSpec::Span { n, kind: flow_scope_kind(kind)?, kind_str: kind.to_string() }),
    }
}

/// Whole `kind` periods from `from` to `to` (period starts), or `None` for an unsupported kind.
/// Non-negative whenever `to >= from` (guaranteed here by scope containment). Used to turn a
/// descendant's absolute Time Scope into a relative Cycle Scope offset within the flow window.
fn periods_between(from: NaiveDate, to: NaiveDate, kind: &str) -> Option<i64> {
    let month_delta =
        (i64::from(to.year()) - i64::from(from.year())) * 12 + i64::from(to.month()) - i64::from(from.month());
    match kind {
        "day" => Some((to - from).num_days()),
        "week" => Some((to - from).num_days() / 7),
        "month" => Some(month_delta),
        "season" => Some(month_delta / 3),
        _ => None,
    }
}

/// Parses the start-date string of a scope row into a `NaiveDate`.
fn scope_start_date(scope: &Scope) -> Result<NaiveDate, FlowError> {
    NaiveDate::parse_from_str(&scope.start_date, "%Y-%m-%d")
        .map_err(|e| FlowError::Invalid(e.to_string()))
}

/// Reduces a stored Recurrence to the pure `Consumption` behavior its Consumption tree encodes.
fn parse_consumption(recurrence: &FlowRecurrence) -> Result<Consumption, FlowError> {
    match recurrence.consumption_kind.as_str() {
        "destructive" => Ok(Consumption::Destructive),
        "accumulating" => match recurrence.blocking_mode.as_deref() {
            Some("overlapping") => Ok(Consumption::Overlapping),
            Some("blocking") => {
                let catchup = match recurrence.catchup_policy.as_deref() {
                    Some("all_pending") => Catchup::AllPending,
                    Some("next") => Catchup::Next,
                    Some("latest") => Catchup::Latest,
                    other => {
                        return Err(FlowError::Invalid(format!("bad catch-up policy {other:?}")))
                    }
                };
                Ok(Consumption::Blocking(catchup))
            }
            other => Err(FlowError::Invalid(format!("bad blocking mode {other:?}"))),
        },
        other => Err(FlowError::Invalid(format!("bad consumption kind {other}"))),
    }
}

/// Fine-to-coarse ordinal for a scope kind (`exact` < `part` < `day` < `week` < `month` <
/// `season`), used to check a Habit's Gap kind is no finer than its habit scope.
fn scope_kind_rank(kind: &str) -> Result<i64, FlowError> {
    Ok(match kind {
        "exact" => 0,
        "part" => 1,
        "day" => 2,
        "week" => 3,
        "month" => 4,
        "season" => 5,
        other => return Err(FlowError::Invalid(format!("unsupported scope kind {other}"))),
    })
}

/// The `ScopeKind` for a flow-scope kind string (Span or Phase).
fn flow_scope_kind(kind: &str) -> Result<ScopeKind, FlowError> {
    match kind {
        "day" => Ok(ScopeKind::Day),
        "week" => Ok(ScopeKind::Week),
        "month" => Ok(ScopeKind::Month),
        "season" => Ok(ScopeKind::Season),
        "part" => Ok(ScopeKind::PartOfDay),
        "exact" => Ok(ScopeKind::Exact),
        other => Err(FlowError::Invalid(format!("unsupported flow kind {other}"))),
    }
}

/// Millisecond timestamp used to seed sort position (matches the tasks/goals convention).
fn now_position() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// Resolves the `index`-th (1-based) `kind` subscope beginning at `base`, by offset.
async fn offset_scope(
    scopes: &mut ScopeOperator<'_>,
    base: NaiveDate,
    index: i64,
    kind: &str,
) -> Result<Scope, FlowError> {
    let off = index - 1;
    let bad_date = || FlowError::Invalid("cycle resolves outside the calendar".to_string());
    match kind {
        "season" | "month" | "week" | "day" => {
            let date = advance(base, off, kind).ok_or_else(bad_date)?;
            Ok(scopes.get_or_create(flow_scope_kind(kind)?, date).await?)
        }
        "part_of_day" => {
            let date = advance(base, off / 6, "day").ok_or_else(bad_date)?;
            let part = PartOfDay::CYCLE[usize::try_from(off % 6).unwrap_or(0)];
            Ok(scopes.get_or_create_part(date, part).await?)
        }
        other => Err(FlowError::Invalid(format!("unsupported cycle kind {other}"))),
    }
}

/// Resolves a cycle pair into a concrete (Time Scope, Plan) against the window start.
/// A null-scope pair (or an unscoped flow) yields `(None, None)` — the item inherits the root.
async fn resolve_pair(
    scopes: &mut ScopeOperator<'_>,
    pair: Option<&FlowItemCycle>,
    window_start: Option<NaiveDate>,
) -> Result<(Option<TimeScope>, Option<TimeScope>), FlowError> {
    let (Some(pair), Some(base)) = (pair, window_start) else { return Ok((None, None)) };
    let (Some(kind), Some(index)) = (pair.scope_kind.as_deref(), pair.scope_index) else {
        return Ok((None, None));
    };
    let scope = offset_scope(scopes, base, index, kind).await?;
    let cycle_start = NaiveDate::parse_from_str(&scope.start_date, "%Y-%m-%d")
        .map_err(|e| FlowError::Invalid(e.to_string()))?;
    let time_scope = Some(TimeScope { start_id: scope.id, end_id: scope.id, duration: None });

    let plan = match (pair.plan_kind.as_deref(), pair.plan_start, pair.plan_end) {
        (Some(pk), Some(ps), Some(pe)) => {
            let start = offset_scope(scopes, cycle_start, ps, pk).await?;
            let end = offset_scope(scopes, cycle_start, pe, pk).await?;
            Some(TimeScope { start_id: start.id, end_id: end.id, duration: None })
        }
        _ => None,
    };
    Ok((time_scope, plan))
}

/// Resolves the concrete flow window `[anchor, anchor + (n-1) periods]` of `kind`, returning
/// the Time Scope and its start date. The anchor is snapped to the start of its canonical scope.
async fn resolve_window(
    scopes: &mut ScopeOperator<'_>,
    n: i64,
    kind: &str,
    anchor: NaiveDate,
) -> Result<(TimeScope, NaiveDate), FlowError> {
    let start_scope = scopes.get_or_create(flow_scope_kind(kind)?, anchor).await?;
    let start_date = NaiveDate::parse_from_str(&start_scope.start_date, "%Y-%m-%d")
        .map_err(|e| FlowError::Invalid(e.to_string()))?;
    let end_date = advance(start_date, n - 1, kind)
        .ok_or_else(|| FlowError::Invalid("window exceeds the calendar".to_string()))?;
    let end_scope = scopes.get_or_create(flow_scope_kind(kind)?, end_date).await?;
    Ok((
        TimeScope {
            start_id: start_scope.id,
            end_id: end_scope.id,
            duration: Some(DurationSpec { n, kind: kind.to_string() }),
        },
        start_date,
    ))
}

/// Resolves a flow's Flow Window against a concrete `anchor` date into a Time Scope: a coarse
/// **Span** yields a `[start, end]` boundary of canonical scopes; a sub-day **Phase** yields a
/// single part/exact scope built on the anchor day. Returns the window and its first day.
async fn resolve_flow_window(
    scopes: &mut ScopeOperator<'_>,
    flow: &Flow,
    anchor: NaiveDate,
) -> Result<(TimeScope, NaiveDate), FlowError> {
    let kind = flow
        .flow_duration_kind
        .as_deref()
        .ok_or_else(|| FlowError::Invalid("flow has no window".to_string()))?;
    let n = flow.flow_duration_n.unwrap_or(1);
    match window_spec(flow, kind, n)? {
        WindowSpec::Span { .. } => resolve_window(scopes, n, kind, anchor).await,
        WindowSpec::Part(band) => {
            let scope = scopes.get_or_create_part(anchor, band).await?;
            Ok((TimeScope { start_id: scope.id, end_id: scope.id, duration: None }, anchor))
        }
        WindowSpec::Exact { start, end } => {
            let scope =
                scopes.get_or_create_exact(anchor.and_time(start), anchor.and_time(end)).await?;
            Ok((TimeScope { start_id: scope.id, end_id: scope.id, duration: None }, anchor))
        }
    }
}

/// Builds the iteration windows from the Repetition Start up to (and including the one covering)
/// `now`, bounded by any end. A **Span** window spans `n` canonical periods and tiles
/// contiguously; a **Phase** window is the fixed band / clock-range on its anchor day. Each next
/// anchor advances by the Gap — for a Phase window that Gap is the whole-day stride between
/// occurrence days (defaulting to daily), keeping the time-of-day fixed.
async fn habit_slots(
    scopes: &mut ScopeOperator<'_>,
    start_date: NaiveDate,
    spec: WindowSpec,
    gap: Option<&(i64, String)>,
    end_date: Option<NaiveDate>,
    now: NaiveDateTime,
) -> Result<Vec<SlotWindow>, FlowError> {
    let overflow = || FlowError::Invalid("iteration exceeds the calendar".to_string());
    let mut slots = Vec::new();
    let mut anchor = start_date;
    let mut index = 0i64;
    loop {
        // Materialize the window at this anchor and find where the next anchor tiles (Span only).
        let (scope_id, start, end, span_next) = match &spec {
            WindowSpec::Span { n, kind, kind_str } => {
                let scope = scopes.get_or_create(*kind, anchor).await?;
                let window_start = scope_start_date(&scope)?;
                let next_contiguous = advance(window_start, *n, kind_str).ok_or_else(overflow)?;
                (
                    scope.id,
                    window_start.and_time(NaiveTime::MIN),
                    next_contiguous.and_time(NaiveTime::MIN),
                    Some(next_contiguous),
                )
            }
            WindowSpec::Part(band) => {
                let scope = scopes.get_or_create_part(anchor, *band).await?;
                let (start, end) = scope_bounds(&scope)?;
                (scope.id, start, end, None)
            }
            WindowSpec::Exact { start: ts, end: te } => {
                let scope = scopes
                    .get_or_create_exact(anchor.and_time(*ts), anchor.and_time(*te))
                    .await?;
                let (start, end) = scope_bounds(&scope)?;
                (scope.id, start, end, None)
            }
        };

        // A window counts as started once its first instant is at or before `now`.
        if start > now || end_date.is_some_and(|last| start.date() > last) {
            break;
        }
        slots.push(SlotWindow { index, scope_id, start, end });

        // Advance the anchor. A Span defaults to its contiguous next start; a Phase defaults to
        // the next day. Either is then stepped by the Gap when one is set.
        anchor = match (span_next, gap) {
            (_, Some((n, gap_kind))) => {
                let base = span_next.unwrap_or(anchor);
                advance(base, *n, gap_kind)
            }
            (Some(next), None) => Some(next),
            (None, None) => advance(anchor, 1, "day"),
        }
        .ok_or_else(overflow)?;
        index += 1;
    }
    Ok(slots)
}

/// Reads and writes flow templates — and their items, cycles, recurrences and instances —
/// on a session's connection.
///
/// Obtained as `db.flows()` and used inline; see [`Db`] for the borrow rules and for where an
/// operation belongs.
///
/// Everything here touches the flow tables only. The methods that first **read** and then write
/// what they read — `update`, `delete`, `update_goal`, `update_task`, `convert_item`,
/// `set_recurrence`, `set_iteration_done` and `fork_flow` — are **module-private**, because an
/// operator wraps a bare connection and so cannot demand a transaction in its signature. Their
/// public entry points are the free functions below ([`update_flow`], [`delete_flow`], …), which
/// take `&mut Db<Transactional>` and therefore make a non-atomic call a compile error. See
/// [`Db`]'s `# Where an operation lives`.
pub struct FlowOperator<'session> {
    /// The session's connection, borrowed for the duration of this operator's life.
    connection: &'session mut sqlx::SqliteConnection,
}

impl<'session> FlowOperator<'session> {
    /// Wraps the connection a session is lending.
    pub(crate) fn new(connection: &'session mut sqlx::SqliteConnection) -> Self {
        Self { connection }
    }

    /// Opens a flow **instance** row — one materialisation of a flow — and returns its id.
    ///
    /// Private: an instance with no nodes recorded against it is meaningless, so the row is only
    /// ever opened from [`start`], which goes on to record them.
    async fn open_instance(
        &mut self,
        flow_id: FlowId,
        root_type: &str,
        root_id: i64,
    ) -> Result<i64, FlowError> {
        Ok(sqlx::query(
            "INSERT INTO flow_instances (flow_id, root_type, root_id, started_at) VALUES (?, ?, ?, ?)",
        )
        .bind(flow_id.0)
        .bind(root_type)
        .bind(root_id)
        .bind(now_position())
        .execute(&mut *self.connection)
        .await?
        .last_insert_rowid())
    }

    /// Creates a new flow.
    pub async fn create(&mut self, request: CreateFlowRequest) -> Result<Flow, FlowError> {
        let instance_type = request.instance_type.map(|it| it.as_str()).unwrap_or("task");
        let id = sqlx::query(
            "INSERT INTO flows
                (title, instance_type, parent_type, parent_id, target_type, target_id,
                 flow_duration_n, flow_duration_kind,
                 flow_window_part, flow_window_time_start, flow_window_time_end,
                 root_plan_kind, root_plan_start, root_plan_end, position)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&request.title)
        .bind(instance_type)
        .bind(&request.parent_type)
        .bind(request.parent_id)
        .bind(&request.target_type)
        .bind(request.target_id)
        .bind(request.flow_duration_n)
        .bind(&request.flow_duration_kind)
        .bind(&request.flow_window_part)
        .bind(&request.flow_window_time_start)
        .bind(&request.flow_window_time_end)
        .bind(&request.root_plan_kind)
        .bind(request.root_plan_start)
        .bind(request.root_plan_end)
        .bind(now_position())
        .execute(&mut *self.connection)
        .await?
        .last_insert_rowid();
        self.get(FlowId(id)).await
    }

    /// Fetches a flow by id.
    pub async fn get(&mut self, id: FlowId) -> Result<Flow, FlowError> {
        sqlx::query_as::<_, Flow>(
            "SELECT flows.*, EXISTS(SELECT 1 FROM flow_recurrences WHERE flow_recurrences.flow_id = flows.id) AS is_habit
             FROM flows WHERE id = ?",
        )
        .bind(id.0)
        .fetch_optional(&mut *self.connection)
        .await?
        .ok_or(FlowError::NotFound(id.0))
    }

    /// Lists all flows in sort order.
    pub async fn list(&mut self) -> Result<Vec<Flow>, FlowError> {
        Ok(sqlx::query_as::<_, Flow>(
            "SELECT flows.*, EXISTS(SELECT 1 FROM flow_recurrences WHERE flow_recurrences.flow_id = flows.id) AS is_habit
             FROM flows ORDER BY position ASC",
        )
        .fetch_all(&mut *self.connection)
        .await?)
    }

    /// Updates a flow.
    ///
    /// **Module-private.** It reads the stored row and writes values derived from it, so it is
    /// only correct inside a transaction — and an operator wraps a bare connection, which cannot
    /// demand one in its signature. [`update_flow`] is the entry point; it takes
    /// `&mut Db<Transactional>` and is this method's only caller.
    async fn update(&mut self, id: FlowId, request: UpdateFlowRequest) -> Result<Flow, FlowError> {
        let flow = self.get(id).await?;
        let title = request.title.unwrap_or(flow.title);
        let instance_type = request
            .instance_type
            .map(|it| it.as_str().to_string())
            .unwrap_or(flow.instance_type);
        let target_type = request.target_type.unwrap_or(flow.target_type);
        let target_id = request.target_id.unwrap_or(flow.target_id);
        let flow_duration_n = request.flow_duration_n.unwrap_or(flow.flow_duration_n);
        let flow_duration_kind = request.flow_duration_kind.unwrap_or(flow.flow_duration_kind);
        let flow_window_part = request.flow_window_part.unwrap_or(flow.flow_window_part);
        let flow_window_time_start =
            request.flow_window_time_start.unwrap_or(flow.flow_window_time_start);
        let flow_window_time_end =
            request.flow_window_time_end.unwrap_or(flow.flow_window_time_end);
        let root_plan_kind = request.root_plan_kind.unwrap_or(flow.root_plan_kind);
        let root_plan_start = request.root_plan_start.unwrap_or(flow.root_plan_start);
        let root_plan_end = request.root_plan_end.unwrap_or(flow.root_plan_end);
        let parent_type = request.parent_type.unwrap_or(flow.parent_type);
        let parent_id = request.parent_id.unwrap_or(flow.parent_id);
        let position = request.position.unwrap_or(flow.position);
        let is_private = request.is_private.unwrap_or(flow.is_private);
        sqlx::query(
            "UPDATE flows SET title=?, instance_type=?, parent_type=?, parent_id=?,
                target_type=?, target_id=?, flow_duration_n=?, flow_duration_kind=?,
                flow_window_part=?, flow_window_time_start=?, flow_window_time_end=?,
                root_plan_kind=?, root_plan_start=?, root_plan_end=?, position=?, is_private=?
             WHERE id=?",
        )
        .bind(&title)
        .bind(&instance_type)
        .bind(&parent_type)
        .bind(parent_id)
        .bind(&target_type)
        .bind(target_id)
        .bind(flow_duration_n)
        .bind(&flow_duration_kind)
        .bind(&flow_window_part)
        .bind(&flow_window_time_start)
        .bind(&flow_window_time_end)
        .bind(&root_plan_kind)
        .bind(root_plan_start)
        .bind(root_plan_end)
        .bind(position)
        .bind(is_private)
        .bind(id.0)
        .execute(&mut *self.connection)
        .await?;
        self.get(id).await
    }

    /// Deletes a flow and (via cascade) its items.
    ///
    /// **Module-private.** It reads the stored row and writes values derived from it, so it is
    /// only correct inside a transaction — and an operator wraps a bare connection, which cannot
    /// demand one in its signature. [`delete_flow`] is the entry point; it takes
    /// `&mut Db<Transactional>` and is this method's only caller.
    async fn delete(&mut self, id: FlowId) -> Result<(), FlowError> {
        self.get(id).await?;
        sqlx::query("DELETE FROM flows WHERE id = ?")
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Creates a flow-goal item.
    pub async fn create_goal(&mut self, request: CreateFlowItemRequest) -> Result<FlowGoal, FlowError> {
        let id = sqlx::query(
            "INSERT INTO flow_goals (flow_id, title, parent_type, parent_id, position)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(request.flow_id)
        .bind(&request.title)
        .bind(&request.parent_type)
        .bind(request.parent_id)
        .bind(now_position())
        .execute(&mut *self.connection)
        .await?
        .last_insert_rowid();
        sqlx::query_as::<_, FlowGoal>("SELECT * FROM flow_goals WHERE id = ?")
            .bind(id)
            .fetch_one(&mut *self.connection)
            .await
            .map_err(FlowError::from)
    }

    /// Creates a flow-task item.
    pub async fn create_task(&mut self, request: CreateFlowItemRequest) -> Result<FlowTask, FlowError> {
        let id = sqlx::query(
            "INSERT INTO flow_tasks (flow_id, title, parent_type, parent_id, position)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(request.flow_id)
        .bind(&request.title)
        .bind(&request.parent_type)
        .bind(request.parent_id)
        .bind(now_position())
        .execute(&mut *self.connection)
        .await?
        .last_insert_rowid();
        sqlx::query_as::<_, FlowTask>("SELECT * FROM flow_tasks WHERE id = ?")
            .bind(id)
            .fetch_one(&mut *self.connection)
            .await
            .map_err(FlowError::from)
    }

    /// Lists a flow's goal items.
    pub async fn list_goals(&mut self, flow_id: FlowId) -> Result<Vec<FlowGoal>, FlowError> {
        Ok(
            sqlx::query_as::<_, FlowGoal>("SELECT * FROM flow_goals WHERE flow_id = ? ORDER BY position ASC")
                .bind(flow_id.0)
                .fetch_all(&mut *self.connection)
                .await?,
        )
    }

    /// Lists a flow's task items.
    pub async fn list_tasks(&mut self, flow_id: FlowId) -> Result<Vec<FlowTask>, FlowError> {
        Ok(
            sqlx::query_as::<_, FlowTask>("SELECT * FROM flow_tasks WHERE flow_id = ? ORDER BY position ASC")
                .bind(flow_id.0)
                .fetch_all(&mut *self.connection)
                .await?,
        )
    }

    /// Lists every flow's goal items (for the mindmap load).
    pub async fn list_all_goals(&mut self) -> Result<Vec<FlowGoal>, FlowError> {
        Ok(sqlx::query_as::<_, FlowGoal>("SELECT * FROM flow_goals ORDER BY position ASC")
            .fetch_all(&mut *self.connection)
            .await?)
    }

    /// Lists every flow's task items (for the mindmap load).
    pub async fn list_all_tasks(&mut self) -> Result<Vec<FlowTask>, FlowError> {
        Ok(sqlx::query_as::<_, FlowTask>("SELECT * FROM flow_tasks ORDER BY position ASC")
            .fetch_all(&mut *self.connection)
            .await?)
    }

    /// Updates a flow-goal item.
    ///
    /// **Module-private.** It reads the stored row and writes values derived from it, so it is
    /// only correct inside a transaction — and an operator wraps a bare connection, which cannot
    /// demand one in its signature. [`update_flow_goal`] is the entry point; it takes
    /// `&mut Db<Transactional>` and is this method's only caller.
    async fn update_goal(
        &mut self,
        id: i64,
        request: UpdateFlowItemRequest,
    ) -> Result<FlowGoal, FlowError> {
        let goal = sqlx::query_as::<_, FlowGoal>("SELECT * FROM flow_goals WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut *self.connection)
            .await?
            .ok_or(FlowError::NotFound(id))?;
        let title = request.title.unwrap_or(goal.title);
        let parent_type = request.parent_type.unwrap_or(goal.parent_type);
        let parent_id = request.parent_id.unwrap_or(goal.parent_id);
        let position = request.position.unwrap_or(goal.position);
        let is_private = request.is_private.unwrap_or(goal.is_private);
        sqlx::query(
            "UPDATE flow_goals SET title=?, parent_type=?, parent_id=?, position=?, is_private=?
             WHERE id=?",
        )
        .bind(&title)
        .bind(&parent_type)
        .bind(parent_id)
        .bind(position)
        .bind(is_private)
        .bind(id)
        .execute(&mut *self.connection)
        .await?;
        sqlx::query_as::<_, FlowGoal>("SELECT * FROM flow_goals WHERE id = ?")
            .bind(id)
            .fetch_one(&mut *self.connection)
            .await
            .map_err(FlowError::from)
    }

    /// Updates a flow-task item.
    ///
    /// **Module-private.** It reads the stored row and writes values derived from it, so it is
    /// only correct inside a transaction — and an operator wraps a bare connection, which cannot
    /// demand one in its signature. [`update_flow_task`] is the entry point; it takes
    /// `&mut Db<Transactional>` and is this method's only caller.
    async fn update_task(
        &mut self,
        id: i64,
        request: UpdateFlowItemRequest,
    ) -> Result<FlowTask, FlowError> {
        let task = sqlx::query_as::<_, FlowTask>("SELECT * FROM flow_tasks WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut *self.connection)
            .await?
            .ok_or(FlowError::NotFound(id))?;
        let title = request.title.unwrap_or(task.title);
        let parent_type = request.parent_type.unwrap_or(task.parent_type);
        let parent_id = request.parent_id.unwrap_or(task.parent_id);
        let position = request.position.unwrap_or(task.position);
        let is_private = request.is_private.unwrap_or(task.is_private);
        sqlx::query(
            "UPDATE flow_tasks SET title=?, parent_type=?, parent_id=?, position=?, is_private=?
             WHERE id=?",
        )
        .bind(&title)
        .bind(&parent_type)
        .bind(parent_id)
        .bind(position)
        .bind(is_private)
        .bind(id)
        .execute(&mut *self.connection)
        .await?;
        sqlx::query_as::<_, FlowTask>("SELECT * FROM flow_tasks WHERE id = ?")
            .bind(id)
            .fetch_one(&mut *self.connection)
            .await
            .map_err(FlowError::from)
    }

    /// Deletes a flow item and its cycles and dependency links.
    ///
    /// Three statements — the item's cycle pairs, its dependency edges, then the row — and so
    /// **not atomic on its own**. It opens no transaction: per ADR-0004 only the outermost caller
    /// decides the boundary, and a method that began its own could never join one. It reads
    /// nothing first, which is why it stays on the operator rather than becoming a free function.
    ///
    /// ```no_run
    /// # use arlesh_lib::database::session::SessionFactory;
    /// # use arlesh_lib::flows::{error::FlowError, model::FlowItemType};
    /// # async fn remove(factory: &SessionFactory) -> Result<(), FlowError> {
    /// let mut db = factory.begin().await?;
    /// db.flows().delete_item(FlowItemType::FlowTask, 1).await?;
    /// db.commit().await?;
    /// # Ok(())
    /// # }
    /// ```
    pub async fn delete_item(&mut self, item_type: FlowItemType, id: i64) -> Result<(), FlowError> {
        let table = match item_type {
            FlowItemType::FlowGoal => "flow_goals",
            FlowItemType::FlowTask => "flow_tasks",
        };
        self.clear_item_links(item_type, id).await?;
        sqlx::query(&format!("DELETE FROM {table} WHERE id = ?"))
            .bind(id)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Removes an item's cycle pairs and any dependency it participates in.
    async fn clear_item_links(&mut self, item_type: FlowItemType, id: i64) -> Result<(), FlowError> {
        sqlx::query("DELETE FROM flow_item_cycles WHERE item_type = ? AND item_id = ?")
            .bind(item_type.as_str())
            .bind(id)
            .execute(&mut *self.connection)
            .await?;
        sqlx::query(
            "DELETE FROM flow_dependencies
             WHERE (dependent_type = ?1 AND dependent_id = ?2)
                OR (depends_on_type = ?1 AND depends_on_id = ?2)",
        )
        .bind(item_type.as_str())
        .bind(id)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Converts a flow item to the other kind (goal↔task), moving it to the other table.
    ///
    /// The item's cycle pairs and dependency edges (both directions) are re-pointed to the new
    /// row, and children still parented on it are reparented onto it where the nesting rules allow
    /// (a flow-goal child cannot sit under a flow-task, so the caller must move or delete those
    /// first). Returns the new item id.
    ///
    /// **Module-private.** It reads the stored row and writes values derived from it, so it is
    /// only correct inside a transaction — and an operator wraps a bare connection, which cannot
    /// demand one in its signature. [`convert_flow_item`] is the entry point; it takes
    /// `&mut Db<Transactional>` and is this method's only caller.
    async fn convert_item(
        &mut self,
        from: FlowItemType,
        id: i64,
        to: FlowItemType,
    ) -> Result<i64, FlowError> {
        if from == to {
            return Ok(id);
        }
        // Common fields carry over regardless of which table the item lives in.
        let (flow_id, title, parent_type, parent_id, position, is_private) = match from {
            FlowItemType::FlowGoal => {
                let g = sqlx::query_as::<_, FlowGoal>("SELECT * FROM flow_goals WHERE id = ?")
                    .bind(id)
                    .fetch_optional(&mut *self.connection)
                    .await?
                    .ok_or(FlowError::NotFound(id))?;
                (
                    g.flow_id,
                    g.title,
                    g.parent_type,
                    g.parent_id,
                    g.position,
                    g.is_private,
                )
            }
            FlowItemType::FlowTask => {
                let t = sqlx::query_as::<_, FlowTask>("SELECT * FROM flow_tasks WHERE id = ?")
                    .bind(id)
                    .fetch_optional(&mut *self.connection)
                    .await?
                    .ok_or(FlowError::NotFound(id))?;
                (
                    t.flow_id,
                    t.title,
                    t.parent_type,
                    t.parent_id,
                    t.position,
                    t.is_private,
                )
            }
        };

        let new_table = match to {
            FlowItemType::FlowGoal => "flow_goals",
            FlowItemType::FlowTask => "flow_tasks",
        };
        let new_id = sqlx::query(&format!(
            "INSERT INTO {new_table} (flow_id, title, parent_type, parent_id, position, is_private)
             VALUES (?, ?, ?, ?, ?, ?)"
        ))
        .bind(flow_id)
        .bind(&title)
        .bind(&parent_type)
        .bind(parent_id)
        .bind(position)
        .bind(is_private)
        .execute(&mut *self.connection)
        .await?
        .last_insert_rowid();

        // Re-point this item's cycles and dependency edges (both directions) to the new row.
        sqlx::query("UPDATE flow_item_cycles SET item_type = ?, item_id = ? WHERE item_type = ? AND item_id = ?")
            .bind(to.as_str()).bind(new_id).bind(from.as_str()).bind(id)
            .execute(&mut *self.connection).await?;
        sqlx::query("UPDATE flow_dependencies SET dependent_type = ?, dependent_id = ? WHERE dependent_type = ? AND dependent_id = ?")
            .bind(to.as_str()).bind(new_id).bind(from.as_str()).bind(id)
            .execute(&mut *self.connection).await?;
        sqlx::query("UPDATE flow_dependencies SET depends_on_type = ?, depends_on_id = ? WHERE depends_on_type = ? AND depends_on_id = ?")
            .bind(to.as_str()).bind(new_id).bind(from.as_str()).bind(id)
            .execute(&mut *self.connection).await?;

        // Reparent children onto the new row where nesting allows. Task children are valid under
        // both kinds; goal children only under a goal.
        sqlx::query("UPDATE flow_tasks SET parent_type = ?, parent_id = ? WHERE parent_type = ? AND parent_id = ?")
            .bind(to.as_str()).bind(new_id).bind(from.as_str()).bind(id)
            .execute(&mut *self.connection).await?;
        if to == FlowItemType::FlowGoal {
            sqlx::query("UPDATE flow_goals SET parent_type = ?, parent_id = ? WHERE parent_type = ? AND parent_id = ?")
                .bind(to.as_str()).bind(new_id).bind(from.as_str()).bind(id)
                .execute(&mut *self.connection).await?;
        }

        // The old row's links were re-pointed, so a plain delete orphans nothing.
        let old_table = match from {
            FlowItemType::FlowGoal => "flow_goals",
            FlowItemType::FlowTask => "flow_tasks",
        };
        sqlx::query(&format!("DELETE FROM {old_table} WHERE id = ?"))
            .bind(id)
            .execute(&mut *self.connection)
            .await?;
        Ok(new_id)
    }

    /// Replaces a flow item's (Cycle Scope, Cycle Plan) pairs with `cycles`.
    ///
    /// A `DELETE` followed by one `INSERT` per pair, and so **not atomic on its own**: interrupted
    /// part-way it leaves the item with some of its old pairs gone and some of its new ones
    /// missing. It opens no transaction — per ADR-0004 only the outermost caller decides the
    /// boundary. Nothing is read first, which is why this stays on the operator.
    ///
    /// ```no_run
    /// # use arlesh_lib::database::session::SessionFactory;
    /// # use arlesh_lib::flows::{error::FlowError, model::FlowItemType};
    /// # async fn replace(factory: &SessionFactory) -> Result<(), FlowError> {
    /// let mut db = factory.begin().await?;
    /// db.flows().set_cycles(1, FlowItemType::FlowTask, 2, &[]).await?;
    /// db.commit().await?;
    /// # Ok(())
    /// # }
    /// ```
    pub async fn set_cycles(
        &mut self,
        flow_id: i64,
        item_type: FlowItemType,
        item_id: i64,
        cycles: &[FlowCycleInput],
    ) -> Result<(), FlowError> {
        sqlx::query("DELETE FROM flow_item_cycles WHERE item_type = ? AND item_id = ?")
            .bind(item_type.as_str())
            .bind(item_id)
            .execute(&mut *self.connection)
            .await?;
        for (position, cycle) in cycles.iter().enumerate() {
            sqlx::query(
                "INSERT INTO flow_item_cycles
                    (flow_id, item_type, item_id, scope_kind, scope_index,
                     plan_kind, plan_start, plan_end, position)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(flow_id)
            .bind(item_type.as_str())
            .bind(item_id)
            .bind(&cycle.scope_kind)
            .bind(cycle.scope_index)
            .bind(&cycle.plan_kind)
            .bind(cycle.plan_start)
            .bind(cycle.plan_end)
            .bind(position as i64)
            .execute(&mut *self.connection)
            .await?;
        }
        Ok(())
    }

    /// Lists every flow's cycle pairs (for the mindmap load).
    pub async fn list_all_cycles(&mut self) -> Result<Vec<FlowItemCycle>, FlowError> {
        Ok(sqlx::query_as::<_, FlowItemCycle>(
            "SELECT * FROM flow_item_cycles ORDER BY item_type, item_id, position ASC",
        )
        .fetch_all(&mut *self.connection)
        .await?)
    }

    /// Adds an intra-flow dependency (`dependent` waits on `depends_on`); a no-op if it exists.
    pub async fn add_dependency(
        &mut self,
        flow_id: i64,
        dependent_type: FlowItemType,
        dependent_id: i64,
        depends_on_type: FlowItemType,
        depends_on_id: i64,
    ) -> Result<(), FlowError> {
        sqlx::query(
            "INSERT OR IGNORE INTO flow_dependencies
                (flow_id, dependent_type, dependent_id, depends_on_type, depends_on_id)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(flow_id)
        .bind(dependent_type.as_str())
        .bind(dependent_id)
        .bind(depends_on_type.as_str())
        .bind(depends_on_id)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Removes an intra-flow dependency.
    pub async fn remove_dependency(
        &mut self,
        dependent_type: FlowItemType,
        dependent_id: i64,
        depends_on_type: FlowItemType,
        depends_on_id: i64,
    ) -> Result<(), FlowError> {
        sqlx::query(
            "DELETE FROM flow_dependencies
             WHERE dependent_type = ? AND dependent_id = ?
               AND depends_on_type = ? AND depends_on_id = ?",
        )
        .bind(dependent_type.as_str())
        .bind(dependent_id)
        .bind(depends_on_type.as_str())
        .bind(depends_on_id)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Lists every flow's dependencies (for the mindmap load).
    pub async fn list_all_dependencies(&mut self) -> Result<Vec<FlowDependency>, FlowError> {
        Ok(sqlx::query_as::<_, FlowDependency>("SELECT * FROM flow_dependencies")
            .fetch_all(&mut *self.connection)
            .await?)
    }

    /// Records a materialised node against a flow instance. Each `(type, id)` pair identifies the
    /// real node, the flow item it came from, and the parent it was created under.
    async fn record_node(
        &mut self,
        instance_id: i64,
        node: (&str, i64),
        source: (&str, i64),
        parent: (&str, i64),
    ) -> Result<(), FlowError> {
        sqlx::query(
            "INSERT INTO flow_instance_nodes
                (flow_instance_id, node_type, node_id, source_item_type, source_item_id,
                 original_parent_type, original_parent_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(instance_id).bind(node.0).bind(node.1).bind(source.0).bind(source.1)
        .bind(parent.0).bind(parent.1)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Sets (creates or replaces) a flow's Recurrence, making it a Habit. Requires a scoped flow;
    /// validates that the Gap kind is no finer than the habit scope and that the Consumption tree is
    /// consistent (a blocking mode iff Accumulating; a catch-up policy iff Blocking).
    ///
    /// **Module-private.** It reads the stored row and writes values derived from it, so it is
    /// only correct inside a transaction — and an operator wraps a bare connection, which cannot
    /// demand one in its signature. [`set_flow_recurrence`] is the entry point; it takes
    /// `&mut Db<Transactional>` and is this method's only caller.
    async fn set_recurrence(
        &mut self,
        flow_id: FlowId,
        request: SetRecurrenceRequest,
    ) -> Result<FlowRecurrence, FlowError> {
        let flow = self.get(flow_id).await?;
        let habit_kind = flow
            .flow_duration_kind
            .as_deref()
            .ok_or_else(|| FlowError::Invalid("a habit requires a scoped flow".to_string()))?;

        match (request.gap_n, request.gap_kind.as_deref()) {
            (Some(n), Some(kind)) => {
                if n < 1 {
                    return Err(FlowError::Invalid("gap must be at least 1".to_string()));
                }
                if scope_kind_rank(kind)? < scope_kind_rank(habit_kind)? {
                    return Err(FlowError::Invalid(
                        "gap kind must be no finer than the habit scope".to_string(),
                    ));
                }
            }
            (None, None) => {}
            _ => {
                return Err(FlowError::Invalid(
                    "gap magnitude and kind must be set together".to_string(),
                ))
            }
        }

        let accumulating = matches!(request.consumption_kind, ConsumptionKind::Accumulating);
        if accumulating != request.blocking_mode.is_some() {
            return Err(FlowError::Invalid(
                "a blocking mode is set exactly when accumulating".to_string(),
            ));
        }
        let blocking = matches!(request.blocking_mode, Some(BlockingMode::Blocking));
        if blocking != request.catchup_policy.is_some() {
            return Err(FlowError::Invalid(
                "a catch-up policy is set exactly when blocking".to_string(),
            ));
        }

        sqlx::query(
            "INSERT INTO flow_recurrences
                (flow_id, start_scope_id, gap_n, gap_kind, end_scope_id,
                 consumption_kind, blocking_mode, catchup_policy)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(flow_id) DO UPDATE SET
                start_scope_id = excluded.start_scope_id, gap_n = excluded.gap_n,
                gap_kind = excluded.gap_kind, end_scope_id = excluded.end_scope_id,
                consumption_kind = excluded.consumption_kind,
                blocking_mode = excluded.blocking_mode, catchup_policy = excluded.catchup_policy",
        )
        .bind(flow_id.0)
        .bind(request.start_scope_id)
        .bind(request.gap_n)
        .bind(&request.gap_kind)
        .bind(request.end_scope_id)
        .bind(request.consumption_kind.as_str())
        .bind(request.blocking_mode.map(|mode| mode.as_str()))
        .bind(request.catchup_policy.map(|policy| policy.as_str()))
        .execute(&mut *self.connection)
        .await?;

        self.get_recurrence(flow_id)
            .await?
            .ok_or(FlowError::NotFound(flow_id.0))
    }

    /// Fetches a flow's Recurrence, or `None` if the flow is a plain (non-habit) flow.
    pub async fn get_recurrence(&mut self, flow_id: FlowId) -> Result<Option<FlowRecurrence>, FlowError> {
        let recurrence = sqlx::query_as::<_, FlowRecurrence>(
            "SELECT flow_id, start_scope_id, gap_n, gap_kind, end_scope_id,
                    consumption_kind, blocking_mode, catchup_policy
             FROM flow_recurrences WHERE flow_id = ?",
        )
        .bind(flow_id.0)
        .fetch_optional(&mut *self.connection)
        .await?;
        Ok(recurrence)
    }

    /// Deletes a flow's Recurrence, demoting the Habit back to a plain flow.
    pub async fn delete_recurrence(&mut self, flow_id: FlowId) -> Result<(), FlowError> {
        sqlx::query("DELETE FROM flow_recurrences WHERE flow_id = ?")
            .bind(flow_id.0)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Resolves (or un-resolves) a whole Habit iteration by writing/clearing a `done` **Modification**
    /// for **every** instance at that scope — the flow root plus every flow item. `resolved_at_ms` is
    /// the completion instant (epoch ms) recorded on each row, so Blocking catch-up jumps are
    /// reproducible. Individual instances are toggled with [`Self::set_item_status`].
    ///
    /// **Module-private.** It reads the stored row and writes values derived from it, so it is
    /// only correct inside a transaction — and an operator wraps a bare connection, which cannot
    /// demand one in its signature. [`set_iteration_done`] is the entry point; it takes
    /// `&mut Db<Transactional>` and is this method's only caller.
    async fn set_iteration_done(
        &mut self,
        flow_id: FlowId,
        iteration_scope_id: i64,
        done: bool,
        resolved_at_ms: i64,
    ) -> Result<(), FlowError> {
        if !done {
            sqlx::query(
                "DELETE FROM habit_instance_modifications
                 WHERE flow_id = ? AND iteration_scope_id = ? AND status = 'done' AND tombstone_kind IS NULL",
            )
            .bind(flow_id.0)
            .bind(iteration_scope_id)
            .execute(&mut *self.connection)
            .await?;
            return Ok(());
        }
        let goals = self.list_goals(flow_id).await?;
        let tasks = self.list_tasks(flow_id).await?;
        // The root is an instance too — keyed `(flow_root, flow_id)` so it stays unique per flow.
        let items = std::iter::once((ROOT_INSTANCE_TYPE, flow_id.0))
            .chain(goals.iter().map(|g| ("flow_goal", g.id)))
            .chain(tasks.iter().map(|t| ("flow_task", t.id)));
        for (item_type, item_id) in items {
            sqlx::query(
                "INSERT INTO habit_instance_modifications
                    (flow_id, item_type, item_id, iteration_scope_id, status, resolved_at)
                 VALUES (?, ?, ?, ?, 'done', ?)
                 ON CONFLICT(item_type, item_id, iteration_scope_id)
                 DO UPDATE SET status = 'done', resolved_at = excluded.resolved_at, tombstone_kind = NULL",
            )
            .bind(flow_id.0)
            .bind(item_type)
            .bind(item_id)
            .bind(iteration_scope_id)
            .bind(resolved_at_ms)
            .execute(&mut *self.connection)
            .await?;
        }
        Ok(())
    }

    /// Lists every instance with a divergent (non-tombstoned) status Modification for this flow, and
    /// the iteration scope it applies to — the per-instance state the mindmap renders (instances with
    /// no row sit at their base status).
    pub async fn list_item_statuses(
        &mut self,
        flow_id: FlowId,
    ) -> Result<Vec<HabitItemStatus>, FlowError> {
        Ok(sqlx::query_as::<_, HabitItemStatus>(
            "SELECT item_type, item_id, iteration_scope_id, status
             FROM habit_instance_modifications
             WHERE flow_id = ? AND status IS NOT NULL AND tombstone_kind IS NULL",
        )
        .bind(flow_id.0)
        .fetch_all(&mut *self.connection)
        .await?)
    }

    /// Sets a **single** instance's status at one iteration scope. `status` `None` clears the
    /// Modification (back to the base status); `Some(s)` upserts it (e.g. `in_progress`, `done`).
    /// `resolved_at_ms` is recorded only for a `done` status (the completion instant that makes
    /// Blocking catch-up reproducible). Unlike `set_iteration_done` (every instance at once), this
    /// toggles one — so a Habit iteration can be advanced instance by instance.
    pub async fn set_item_status(
        &mut self,
        flow_id: FlowId,
        item_type: &str,
        item_id: i64,
        iteration_scope_id: i64,
        status: Option<&str>,
        resolved_at_ms: i64,
    ) -> Result<(), FlowError> {
        match status {
            Some(status) => {
                let resolved_at = if status == "done" { Some(resolved_at_ms) } else { None };
                sqlx::query(
                    "INSERT INTO habit_instance_modifications
                        (flow_id, item_type, item_id, iteration_scope_id, status, resolved_at)
                     VALUES (?, ?, ?, ?, ?, ?)
                     ON CONFLICT(item_type, item_id, iteration_scope_id)
                     DO UPDATE SET status = excluded.status, resolved_at = excluded.resolved_at, tombstone_kind = NULL",
                )
                .bind(flow_id.0)
                .bind(item_type)
                .bind(item_id)
                .bind(iteration_scope_id)
                .bind(status)
                .bind(resolved_at)
                .execute(&mut *self.connection)
                .await?;
            }
            None => {
                sqlx::query(
                    "DELETE FROM habit_instance_modifications
                     WHERE flow_id = ? AND item_type = ? AND item_id = ? AND iteration_scope_id = ?
                       AND tombstone_kind IS NULL",
                )
                .bind(flow_id.0)
                .bind(item_type)
                .bind(item_id)
                .bind(iteration_scope_id)
                .execute(&mut *self.connection)
                .await?;
            }
        }
        Ok(())
    }

    /// Number of distinct **completed** iterations of a Habit (used to detect divergent instances
    /// before an edit-habit reconciliation).
    pub async fn habit_completion_count(&mut self, flow_id: FlowId) -> Result<i64, FlowError> {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(DISTINCT iteration_scope_id) FROM habit_instance_modifications
             WHERE flow_id = ? AND status = 'done' AND tombstone_kind IS NULL",
        )
        .bind(flow_id.0)
        .fetch_one(&mut *self.connection)
        .await?;
        Ok(count)
    }

    /// Clears every Habit Modification for a flow (drops all completion history) — the
    /// delete-and-regenerate arm of edit-habit reconciliation.
    pub async fn clear_habit_modifications(&mut self, flow_id: FlowId) -> Result<(), FlowError> {
        sqlx::query("DELETE FROM habit_instance_modifications WHERE flow_id = ?")
            .bind(flow_id.0)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Deep-clones a flow's **template** — the flow row, its items, cycle pairs, and intra-flow
    /// dependencies (remapped to the clone), but **not** its Recurrence or completion Modifications —
    /// into a brand-new flow. The edit-habit "archive & new" reconciliation applies the edited
    /// schedule to the clone, leaving the original habit (and its history) untouched.
    ///
    /// **Module-private.** It reads the stored row and writes values derived from it, so it is
    /// only correct inside a transaction — and an operator wraps a bare connection, which cannot
    /// demand one in its signature. [`fork_flow`] is the entry point; it takes
    /// `&mut Db<Transactional>` and is this method's only caller.
    async fn fork_flow(&mut self, flow_id: FlowId) -> Result<Flow, FlowError> {
        let flow = self.get(flow_id).await?;
        let new_id = sqlx::query(
            "INSERT INTO flows
                (title, instance_type, parent_type, parent_id, target_type, target_id,
                 flow_duration_n, flow_duration_kind,
                 flow_window_part, flow_window_time_start, flow_window_time_end,
                 root_plan_kind, root_plan_start, root_plan_end, position)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&flow.title)
        .bind(&flow.instance_type)
        .bind(&flow.parent_type)
        .bind(flow.parent_id)
        .bind(&flow.target_type)
        .bind(flow.target_id)
        .bind(flow.flow_duration_n)
        .bind(&flow.flow_duration_kind)
        .bind(&flow.flow_window_part)
        .bind(&flow.flow_window_time_start)
        .bind(&flow.flow_window_time_end)
        .bind(&flow.root_plan_kind)
        .bind(flow.root_plan_start)
        .bind(flow.root_plan_end)
        .bind(now_position())
        .execute(&mut *self.connection)
        .await?
        .last_insert_rowid();

        let goals = self.list_goals(flow_id).await?;
        let tasks = self.list_tasks(flow_id).await?;
        let mut goal_map: HashMap<i64, i64> = HashMap::new();
        let mut task_map: HashMap<i64, i64> = HashMap::new();
        // Pass 1: clone every item under the new flow (temporary parent), recording old->new ids.
        for g in &goals {
            let id = sqlx::query(
                "INSERT INTO flow_goals (flow_id, title, parent_type, parent_id, position) VALUES (?, ?, 'flow', ?, ?)",
            )
            .bind(new_id).bind(&g.title).bind(new_id).bind(g.position)
            .execute(&mut *self.connection).await?.last_insert_rowid();
            goal_map.insert(g.id, id);
        }
        for t in &tasks {
            let id = sqlx::query(
                "INSERT INTO flow_tasks (flow_id, title, parent_type, parent_id, position) VALUES (?, ?, 'flow', ?, ?)",
            )
            .bind(new_id).bind(&t.title).bind(new_id).bind(t.position)
            .execute(&mut *self.connection).await?.last_insert_rowid();
            task_map.insert(t.id, id);
        }
        // Item-id remap for parent/cycle/dependency references.
        let map_item = |item_type: &str, item_id: i64| -> Result<i64, FlowError> {
            match item_type {
                "flow_goal" => goal_map.get(&item_id).copied(),
                "flow_task" => task_map.get(&item_id).copied(),
                _ => None,
            }
            .ok_or_else(|| FlowError::Invalid("dangling flow-item reference in fork".to_string()))
        };
        // Pass 2: repoint each clone's parent now that all new ids exist.
        for g in &goals {
            let (pt, pid) = match g.parent_type.as_str() {
                "flow" => ("flow".to_string(), new_id),
                other => (other.to_string(), map_item(other, g.parent_id)?),
            };
            sqlx::query("UPDATE flow_goals SET parent_type = ?, parent_id = ? WHERE id = ?")
                .bind(&pt).bind(pid).bind(map_item("flow_goal", g.id)?)
                .execute(&mut *self.connection).await?;
        }
        for t in &tasks {
            let (pt, pid) = match t.parent_type.as_str() {
                "flow" => ("flow".to_string(), new_id),
                other => (other.to_string(), map_item(other, t.parent_id)?),
            };
            sqlx::query("UPDATE flow_tasks SET parent_type = ?, parent_id = ? WHERE id = ?")
                .bind(&pt).bind(pid).bind(map_item("flow_task", t.id)?)
                .execute(&mut *self.connection).await?;
        }
        // Clone cycle pairs and dependencies, remapped to the new items.
        for c in self.list_all_cycles().await?.iter().filter(|c| c.flow_id == flow_id.0) {
            sqlx::query(
                "INSERT INTO flow_item_cycles
                    (flow_id, item_type, item_id, scope_kind, scope_index, plan_kind, plan_start, plan_end, position)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(new_id).bind(&c.item_type).bind(map_item(&c.item_type, c.item_id)?)
            .bind(&c.scope_kind).bind(c.scope_index).bind(&c.plan_kind).bind(c.plan_start).bind(c.plan_end).bind(c.position)
            .execute(&mut *self.connection).await?;
        }
        for d in self.list_all_dependencies().await?.iter().filter(|d| d.flow_id == flow_id.0) {
            sqlx::query(
                "INSERT INTO flow_dependencies (flow_id, dependent_type, dependent_id, depends_on_type, depends_on_id) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(new_id).bind(&d.dependent_type).bind(map_item(&d.dependent_type, d.dependent_id)?)
            .bind(&d.depends_on_type).bind(map_item(&d.depends_on_type, d.depends_on_id)?)
            .execute(&mut *self.connection).await?;
        }
        self.get(FlowId(new_id)).await
    }

    /// Maps each slot index to the day its iteration was completed — present only when **every**
    /// instance (the flow root plus every flow item) has a `done` Modification (not tombstoned) for
    /// that iteration scope. An item-less flow still has one instance: its root.
    async fn iteration_resolutions(
        &mut self,
        flow_id: FlowId,
        slots: &[SlotWindow],
    ) -> Result<HashMap<i64, NaiveDateTime>, FlowError> {
        // Instances = the flow root + each flow item.
        let instance_count = 1 + self.list_goals(flow_id).await?.len() + self.list_tasks(flow_id).await?.len();
        let rows: Vec<(i64, i64, Option<i64>)> = sqlx::query_as(
            "SELECT iteration_scope_id, COUNT(*), MAX(resolved_at)
             FROM habit_instance_modifications
             WHERE flow_id = ? AND status = 'done' AND tombstone_kind IS NULL
             GROUP BY iteration_scope_id",
        )
        .bind(flow_id.0)
        .fetch_all(&mut *self.connection)
        .await?;
        let by_scope: HashMap<i64, (i64, Option<i64>)> =
            rows.into_iter().map(|(scope, done, last)| (scope, (done, last))).collect();

        let mut resolved = HashMap::new();
        for slot in slots {
            if let Some((done, last)) = by_scope.get(&slot.scope_id) {
                if *done as usize == instance_count {
                    // `resolved_at` is epoch-ms; treated as a UTC-naive instant for classification.
                    // Sub-day-precision timezone reconciliation is deferred to the 8.4 write path.
                    let instant = last
                        .and_then(chrono::DateTime::from_timestamp_millis)
                        .map(|dt| dt.naive_utc())
                        .unwrap_or(slot.end);
                    resolved.insert(slot.index, instant);
                }
            }
        }
        Ok(resolved)
    }

    /// For each of `nodes` that was materialised from a flow, returns its originating flow title
    /// (nodes with no flow origin, or whose flow was since deleted, are omitted). Drives the
    /// scope-clamp prompt's "from flow X" annotation.
    pub async fn origins(&mut self, nodes: Vec<TargetRef>) -> Result<Vec<FlowOrigin>, FlowError> {
        let mut origins = Vec::new();
        for node in nodes {
            let title: Option<String> = sqlx::query_scalar(
                "SELECT f.title FROM flow_instance_nodes n \
                 JOIN flow_instances i ON i.id = n.flow_instance_id \
                 JOIN flows f ON f.id = i.flow_id \
                 WHERE n.node_type = ? AND n.node_id = ? LIMIT 1",
            )
            .bind(&node.node_type)
            .bind(node.node_id)
            .fetch_optional(&mut *self.connection)
            .await?;
            if let Some(flow_title) = title {
                origins.push(FlowOrigin {
                    node_type: node.node_type,
                    node_id: node.node_id,
                    flow_title,
                });
            }
        }
        Ok(origins)
    }

    /// Every real node materialised by a started flow, as `(node_type, node_id)` refs. Lets the
    /// mindmap flag flow-originated Goals/Tasks (e.g. with a flow-instance badge) without a
    /// per-node origin lookup.
    pub async fn list_instance_node_refs(&mut self) -> Result<Vec<TargetRef>, FlowError> {
        sqlx::query_as::<_, TargetRef>("SELECT node_type, node_id FROM flow_instance_nodes")
            .fetch_all(&mut *self.connection)
            .await
            .map_err(Into::into)
    }

}

/// The task/goal children of a **real** node, as `(kind, id)` pairs — tasks first, then goals.
///
/// Reads two resources (tasks and goals), so it takes the session rather than one operator. It
/// writes nothing, so it serves a pooled and a transactional session alike.
async fn task_goal_children<M: SessionMode>(
    db: &mut Db<M>,
    parent_type: &str,
    parent_id: i64,
) -> Result<Vec<(String, i64)>, FlowError> {
    let mut children = Vec::new();
    let tasks = db.tasks().child_ids(parent_type, parent_id).await?;
    children.extend(tasks.into_iter().map(|id| ("task".to_string(), id)));
    let goals = db.goals().child_ids(parent_type, parent_id).await?;
    children.extend(goals.into_iter().map(|id| ("goal".to_string(), id)));
    Ok(children)
}

/// Updates a flow.
///
/// Transactional because the write is a **merge over the stored row**: the `UPDATE` binds values
/// read a moment earlier, so two concurrent updates on a pooled session would lose one of them.
/// That read-then-write is why this is a free function rather than a `FlowOperator` method — an
/// operator wraps a bare connection and cannot demand a transaction in its signature.
#[tracing::instrument(skip(db))]
pub async fn update_flow(
    db: &mut Db<Transactional>,
    id: FlowId,
    request: UpdateFlowRequest,
) -> Result<Flow, FlowError> {
    db.flows().update(id, request).await
}

/// Deletes a flow (and, by cascade, its items, cycles, dependencies and recurrence).
///
/// Transactional: the delete is guarded by an existence read taken just before it.
#[tracing::instrument(skip(db))]
pub async fn delete_flow(db: &mut Db<Transactional>, id: FlowId) -> Result<(), FlowError> {
    db.flows().delete(id).await
}

/// Updates a flow-goal item. Transactional for the same reason as [`update_flow`].
#[tracing::instrument(skip(db))]
pub async fn update_flow_goal(
    db: &mut Db<Transactional>,
    id: i64,
    request: UpdateFlowItemRequest,
) -> Result<FlowGoal, FlowError> {
    db.flows().update_goal(id, request).await
}

/// Updates a flow-task item. Transactional for the same reason as [`update_flow`].
#[tracing::instrument(skip(db))]
pub async fn update_flow_task(
    db: &mut Db<Transactional>,
    id: i64,
    request: UpdateFlowItemRequest,
) -> Result<FlowTask, FlowError> {
    db.flows().update_task(id, request).await
}

/// Converts a flow item to the other kind (goal↔task), moving it to the other table and
/// re-pointing its cycles, dependencies and children. Returns the new item id.
///
/// Transactional: the new row is written from values read off the old one, and the old row is
/// deleted afterwards — a failure in between would duplicate or orphan the item.
#[tracing::instrument(skip(db))]
pub async fn convert_flow_item(
    db: &mut Db<Transactional>,
    from: FlowItemType,
    id: i64,
    to: FlowItemType,
) -> Result<i64, FlowError> {
    db.flows().convert_item(from, id, to).await
}

/// Sets (creates or replaces) a flow's Recurrence, making it a Habit.
///
/// Transactional: the Gap and Consumption rules are checked against the flow row read first, so
/// the write depends on that read.
#[tracing::instrument(skip(db))]
pub async fn set_flow_recurrence(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    request: SetRecurrenceRequest,
) -> Result<FlowRecurrence, FlowError> {
    db.flows().set_recurrence(flow_id, request).await
}

/// Resolves (or un-resolves) a whole Habit iteration by writing/clearing a `done` **Modification**
/// for **every** instance at that scope — the flow root plus every flow item.
///
/// Transactional: the set of instances is read first and one row is written per instance, so a
/// half-applied run would leave the iteration neither done nor undone.
///
/// Exposed as the `set_habit_iteration_done` Tauri command (registered in `lib.rs`); the frontend
/// does not call it yet. It is the whole-iteration
/// counterpart of `set_habit_item_status`: SPEC defines an iteration as resolved when every one of
/// its non-tombstoned instances is done, and this is the operation that says so in one step.
#[tracing::instrument(skip(db))]
pub async fn set_iteration_done(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    iteration_scope_id: i64,
    done: bool,
    resolved_at_ms: i64,
) -> Result<(), FlowError> {
    db.flows().set_iteration_done(flow_id, iteration_scope_id, done, resolved_at_ms).await
}

/// Deep-clones a flow's **template** — the flow row, its items, cycle pairs, and intra-flow
/// dependencies (remapped to the clone), but **not** its Recurrence or completion Modifications —
/// into a brand-new flow.
///
/// Transactional: a fork is dozens of inserts whose parent/cycle/dependency remaps only make sense
/// together, and every id it remaps comes from a read taken inside the same run.
#[tracing::instrument(skip(db))]
pub async fn fork_flow(db: &mut Db<Transactional>, flow_id: FlowId) -> Result<Flow, FlowError> {
    db.flows().fork_flow(flow_id).await
}

/// Derives a Habit's iterations at `now` (local wall-clock): the ordered schedule of started
/// iterations, each classified per the Consumption behavior (`flows::habits`). Future iterations
/// are omitted (an ellipsis stands in for them). Errors if the flow is not a Habit.
///
/// Reads flows and scopes, so it takes the session. It is transactional despite reading like a
/// query: materialising each iteration window **creates** the canonical scopes it lands on, which
/// is many writes derived from reads taken along the way.
#[tracing::instrument(skip(db))]
pub async fn generate_habit_iterations(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    now: NaiveDateTime,
) -> Result<Vec<HabitIteration>, FlowError> {
    let recurrence = db
        .flows()
        .get_recurrence(flow_id)
        .await?
        .ok_or_else(|| FlowError::Invalid("flow is not a habit".to_string()))?;
    let flow = db.flows().get(flow_id).await?;
    let flow_kind = flow
        .flow_duration_kind
        .clone()
        .ok_or_else(|| FlowError::Invalid("a habit requires a scoped flow".to_string()))?;
    // `n` is only meaningful for a coarse Span; a Phase window carries its own band/time.
    let flow_n = flow.flow_duration_n.unwrap_or(1);
    let spec = window_spec(&flow, &flow_kind, flow_n)?;
    let consumption = parse_consumption(&recurrence)?;

    let start_scope = db.scopes().get(ScopeId(recurrence.start_scope_id)).await?;
    let start_date = scope_start_date(&start_scope)?;
    let end_date = match recurrence.end_scope_id {
        Some(id) => {
            let end_scope = db.scopes().get(ScopeId(id)).await?;
            Some(scope_start_date(&end_scope)?)
        }
        None => None,
    };
    let gap = recurrence.gap_n.zip(recurrence.gap_kind);

    let slots =
        habit_slots(&mut db.scopes(), start_date, spec, gap.as_ref(), end_date, now).await?;
    let resolved = db.flows().iteration_resolutions(flow_id, &slots).await?;
    Ok(classify_iterations(&slots, consumption, &resolved, now))
}

/// Filters `candidates` to the targets a flow of the given `duration` may materialise under.
///
/// A target is valid when its effective Time Scope window (its own, or the nearest scoped
/// ancestor's) wholly contains the flow window; a target with no scoped ancestor — and any
/// Unscoped flow (`duration` = `None`) — is always valid. With a concrete `anchor`, the window
/// is resolved and containment is exact; without one (template edit, before the anchor is
/// known), a coarse necessary check keeps only targets at least as long as the flow's shortest
/// possible window. The backend [`start`] still hard-rejects anything that slips through.
///
/// Reads scopes, tasks and goals, so it takes the session. Transactional for the reason
/// [`generate_habit_iterations`] is: resolving a concrete window creates the scopes it names.
#[tracing::instrument(skip(db))]
pub async fn valid_targets(
    db: &mut Db<Transactional>,
    duration: Option<(i64, String)>,
    anchor: Option<NaiveDate>,
    candidates: Vec<TargetRef>,
) -> Result<Vec<TargetRef>, FlowError> {
    let Some((n, kind)) = duration else {
        return Ok(candidates); // Unscoped flow: no window, no constraint.
    };
    // A Phase window can't be resolved from `(n, kind)` alone (its band/time isn't carried here),
    // so it always uses the coarse filter — where `min_period_days` is 0, i.e. every target
    // passes and the exact check is deferred to `start`.
    let concrete = match anchor {
        Some(date) if !matches!(kind.as_str(), "part" | "exact") => {
            let (window, _) = resolve_window(&mut db.scopes(), n, &kind, date).await?;
            Some(time_scope_window(db, &window).await?)
        }
        _ => None,
    };
    let min_days = n * min_period_days(&kind)?;

    let mut valid = Vec::new();
    for candidate in candidates {
        let effective =
            nearest_scoped_ancestor_window(db, &candidate.node_type, candidate.node_id).await?;
        let fits = match (concrete, effective) {
            (_, None) => true, // Unconstrained target.
            (Some(window), Some(target)) => interval_contains(target, window),
            (None, Some(target)) => (target.1 - target.0).num_days() >= min_days,
        };
        if fits {
            valid.push(candidate);
        }
    }
    Ok(valid)
}

/// Converts a real Task/Goal subtree into a **Flow** template of the same Instance Type: the root
/// becomes the flow, every descendant goal/task becomes a flow item mirroring the hierarchy, and
/// the original subtree is deleted. When `keep_dependencies`, intra-subtree task dependencies are
/// remapped to flow dependencies. When `map_scopes`, the root's Time Scope becomes the flow Window
/// and each descendant's Time Scope becomes a relative Cycle Scope (offset within the window;
/// canonical kinds only — part/exact and Plans are dropped). Errors if the root's parent can't
/// hold a flow (i.e. it is a task).
///
/// Reads and writes flows, tasks, goals and scopes, and **deletes the original subtree after
/// ~150 lines of inserts** — the operation ADR-0004 was written for. Its signature demands a
/// transactional session so that a failure part-way cannot leave both a partial template and a
/// half-deleted subtree.
#[tracing::instrument(skip(db))]
pub async fn convert_to_flow(
    db: &mut Db<Transactional>,
    root_type: &str,
    root_id: i64,
    keep_dependencies: bool,
    map_scopes: bool,
) -> Result<Flow, FlowError> {
    // Read the root, and reject placements a flow can't occupy.
    let (title, parent_type, parent_id, root_ts) = match root_type {
        "goal" => {
            let g = db.goals().get(GoalId(root_id)).await?;
            (g.title, g.parent_type, g.parent_id, g.time_scope)
        }
        "task" => {
            let t = db.tasks().get(TaskId(root_id)).await?;
            (t.title, t.parent_type, t.parent_id, t.time_scope)
        }
        _ => {
            return Err(FlowError::Invalid(
                "only a task or goal can convert to a flow".to_string(),
            ))
        }
    };
    if !matches!(parent_type.as_str(), "aspect" | "project" | "domain" | "goal") {
        return Err(FlowError::Invalid("a flow cannot be parented under a task".to_string()));
    }

    // Map the root's Time Scope to the flow Window (Span / Phase) and note the window start date.
    let mut win_n: Option<i64> = None;
    let mut win_kind: Option<String> = None;
    let mut win_part: Option<String> = None;
    let mut win_time_start: Option<String> = None;
    let mut win_time_end: Option<String> = None;
    let mut window_start: Option<NaiveDate> = None;
    if map_scopes {
        if let Some(ts) = &root_ts {
            let start = db.scopes().get(ScopeId(ts.start_id)).await?;
            if let Some(dur) = &ts.duration {
                win_n = Some(dur.n);
                win_kind = Some(dur.kind.clone());
                window_start = Some(scope_start_date(&start)?);
            } else {
                match start.kind.as_str() {
                    "day" | "week" | "month" | "season" => {
                        win_n = Some(1);
                        win_kind = Some(start.kind.clone());
                        window_start = Some(scope_start_date(&start)?);
                    }
                    "part_of_day" => {
                        win_n = Some(1);
                        win_kind = Some("part".to_string());
                        win_part = start.part.clone();
                        window_start = Some(scope_start_date(&start)?);
                    }
                    "exact" => {
                        if let Some(sdt) = &start.start_datetime {
                            let dt = NaiveDateTime::parse_from_str(sdt, "%Y-%m-%dT%H:%M:%S")
                                .map_err(|e| FlowError::Invalid(e.to_string()))?;
                            win_n = Some(1);
                            win_kind = Some("exact".to_string());
                            win_time_start = Some(dt.format("%H:%M").to_string());
                            win_time_end = start
                                .end_datetime
                                .as_deref()
                                .and_then(|e| {
                                    NaiveDateTime::parse_from_str(e, "%Y-%m-%dT%H:%M:%S").ok()
                                })
                                .map(|e| e.format("%H:%M").to_string());
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    // Create the flow, targeting the root's former parent (a scope-valid default).
    let flow_id = db
        .flows()
        .create(CreateFlowRequest {
            title: title.clone(),
            instance_type: Some(if root_type == "goal" {
                InstanceType::Goal
            } else {
                InstanceType::Task
            }),
            parent_type: parent_type.clone(),
            parent_id,
            target_type: Some(parent_type.clone()),
            target_id: Some(parent_id),
            flow_duration_n: win_n,
            flow_duration_kind: win_kind.clone(),
            flow_window_part: win_part.clone(),
            flow_window_time_start: win_time_start.clone(),
            flow_window_time_end: win_time_end.clone(),
            ..Default::default()
        })
        .await?
        .id;

    // BFS the subtree (parents before children), tracking each node's real parent.
    let root_key = (root_type.to_string(), root_id);
    let mut order: Vec<(String, i64)> = task_goal_children(db, root_type, root_id).await?;
    let mut parent_of: HashMap<(String, i64), (String, i64)> = HashMap::new();
    for child in &order {
        parent_of.insert(child.clone(), root_key.clone());
    }
    let mut i = 0;
    while i < order.len() {
        let (kind, id) = order[i].clone();
        let children = task_goal_children(db, &kind, id).await?;
        for child in children {
            parent_of.insert(child.clone(), (kind.clone(), id));
            order.push(child);
        }
        i += 1;
    }

    // Create a flow item per subtree node, mirroring the hierarchy.
    let mut item_map: HashMap<(String, i64), (FlowItemType, i64)> = HashMap::new();
    for (kind, id) in &order {
        let (item_title, node_ts) = match kind.as_str() {
            "goal" => {
                let g = db.goals().get(GoalId(*id)).await?;
                (g.title, g.time_scope)
            }
            _ => {
                let t = db.tasks().get(TaskId(*id)).await?;
                (t.title, t.time_scope)
            }
        };
        let item_type =
            if kind == "goal" { FlowItemType::FlowGoal } else { FlowItemType::FlowTask };
        let (parent_item_type, parent_item_id) = {
            let parent = &parent_of[&(kind.clone(), *id)];
            if parent == &root_key {
                ("flow".to_string(), flow_id)
            } else {
                let (pit, pid) = &item_map[parent];
                (pit.as_str().to_string(), *pid)
            }
        };
        let item_request = CreateFlowItemRequest {
            flow_id,
            title: item_title,
            parent_type: parent_item_type,
            parent_id: parent_item_id,
        };
        let new_id = if kind == "goal" {
            db.flows().create_goal(item_request).await?.id
        } else {
            db.flows().create_task(item_request).await?.id
        };
        item_map.insert((kind.clone(), *id), (item_type, new_id));

        // Map the descendant's Time Scope to a relative Cycle Scope (canonical kinds only).
        if map_scopes {
            if let (Some(ws), Some(ts)) = (window_start, &node_ts) {
                let ds = db.scopes().get(ScopeId(ts.start_id)).await?;
                if matches!(ds.kind.as_str(), "day" | "week" | "month" | "season") {
                    if let Some(offset) = periods_between(ws, scope_start_date(&ds)?, &ds.kind) {
                        db.flows()
                            .set_cycles(
                                flow_id,
                                item_type,
                                new_id,
                                &[FlowCycleInput {
                                    scope_kind: Some(ds.kind.clone()),
                                    scope_index: Some(offset + 1),
                                    plan_kind: None,
                                    plan_start: None,
                                    plan_end: None,
                                }],
                            )
                            .await?;
                    }
                }
            }
        }
    }

    // Remap intra-subtree task dependencies to flow dependencies.
    if keep_dependencies {
        for (kind, id) in std::iter::once(&root_key).chain(order.iter()) {
            if kind.as_str() != "task" {
                continue;
            }
            let dependent = match item_map.get(&(kind.clone(), *id)) {
                Some(m) => *m,
                None => continue, // the root is not a flow item
            };
            let dependencies = db.tasks().list_dependencies(TaskId(*id)).await?;
            for dep in dependencies {
                let dep_key = match dep {
                    Dependency::Task { id } => ("task".to_string(), id),
                    Dependency::Goal { id } => ("goal".to_string(), id),
                };
                if let Some((on_type, on_id)) = item_map.get(&dep_key).copied() {
                    db.flows()
                        .add_dependency(flow_id, dependent.0, dependent.1, on_type, on_id)
                        .await?;
                }
            }
        }
    }

    // Delete the original subtree. The task/goal cascade walks the descendants itself (and takes
    // their infos and block reasons with them), so the root is all it needs.
    if root_type == "goal" {
        delete_goal(db, GoalId(root_id)).await?;
    } else {
        delete_task(db, TaskId(root_id)).await?;
    }

    db.flows().get(FlowId(flow_id)).await
}

/// Loads a flow's template — items (goals then tasks, each in position order), cycle pairs and
/// dependencies — filtered to that one flow.
///
/// All four reads happen **before** the first write. That is safe, and load-bearing for the split:
/// [`start`] writes goals, tasks, scopes, `flow_instances`, `flow_instance_nodes` and
/// `task_dependencies`, and never touches a flow-template table, so nothing it does can change
/// what these reads return.
#[tracing::instrument(skip(db))]
async fn load_template<M: SessionMode>(
    db: &mut Db<M>,
    flow_id: FlowId,
) -> Result<FlowTemplate, FlowError> {
    let goals = db.flows().list_goals(flow_id).await?;
    let tasks = db.flows().list_tasks(flow_id).await?;
    let cycles = db.flows().list_all_cycles().await?;
    let dependencies = db.flows().list_all_dependencies().await?;

    let mut items: Vec<TemplateItem> = Vec::with_capacity(goals.len() + tasks.len());
    for goal in &goals {
        items.push(TemplateItem {
            kind: FlowItemType::FlowGoal,
            id: goal.id,
            title: goal.title.clone(),
            parent_type: goal.parent_type.clone(),
            parent_id: goal.parent_id,
            position: goal.position,
            is_private: goal.is_private,
        });
    }
    for task in &tasks {
        items.push(TemplateItem {
            kind: FlowItemType::FlowTask,
            id: task.id,
            title: task.title.clone(),
            parent_type: task.parent_type.clone(),
            parent_id: task.parent_id,
            position: task.position,
            is_private: task.is_private,
        });
    }

    Ok(FlowTemplate {
        items,
        cycles: cycles.into_iter().filter(|c| c.flow_id == flow_id.0).collect(),
        dependencies: dependencies.into_iter().filter(|d| d.flow_id == flow_id.0).collect(),
    })
}

/// Resolves every scope a flow materialisation needs into a lookup table, in two rounds per pair:
/// the Cycle Scope from the window start, then the Cycle Plan from *that scope's* own start date.
/// Both rounds already live inside [`resolve_pair`]; this walks the pairs.
///
/// **This writes.** `offset_scope` mints scope rows through `get_or_create`, so the gather must run
/// inside the caller's transaction — it cannot be hoisted out with the template reads. It takes a
/// single [`ScopeOperator`] rather than the session because scopes are the only resource it needs.
///
/// `cycles` is the *reachable* pair list, not every pair the flow owns: an orphaned item is never
/// walked, so resolving its pairs would mint scope rows the single-pass version never minted.
async fn resolve_scopes(
    scopes: &mut ScopeOperator<'_>,
    flow: &Flow,
    anchor: NaiveDate,
    cycles: &[FlowItemCycle],
) -> Result<ScopeTable, FlowError> {
    // The flow window, only when the flow is scoped (Span or Phase).
    let (window, window_start): (Option<TimeScope>, Option<NaiveDate>) =
        if flow.flow_duration_kind.is_some() {
            let (time_scope, start) = resolve_flow_window(scopes, flow, anchor).await?;
            (Some(time_scope), Some(start))
        } else {
            (None, None)
        };

    // The root's relative Cycle Plan (task instance type only), against the window start.
    let root_plan: Option<TimeScope> = match (
        flow.root_plan_kind.as_deref(),
        flow.root_plan_start,
        flow.root_plan_end,
        window_start,
    ) {
        (Some(kind), Some(plan_start), Some(plan_end), Some(base)) => {
            let start = offset_scope(scopes, base, plan_start, kind).await?;
            let end = offset_scope(scopes, base, plan_end, kind).await?;
            Some(TimeScope { start_id: start.id, end_id: end.id, duration: None })
        }
        _ => None,
    };

    let mut pairs: HashMap<i64, ResolvedPair> = HashMap::with_capacity(cycles.len());
    for cycle in cycles {
        let (time_scope, plan) = resolve_pair(scopes, Some(cycle), window_start).await?;
        pairs.insert(cycle.id, ResolvedPair { time_scope, plan });
    }

    Ok(ScopeTable { window, root_plan, pairs })
}

/// Writes a [`RenderedPlan`]: create each node under its already-written parent, record it against
/// the flow instance, then add the dependency edges once every node has a real id.
///
/// The plan lists nodes in creation order with every parent ahead of its children, so one pass
/// suffices. Node 0 is the root: it is the only node whose parent is the start target rather than
/// another node, and it is the one the `flow_instances` row is opened on — between its creation
/// and its `flow_instance_nodes` row, as it always has been.
#[tracing::instrument(skip(db, plan))]
async fn write_plan(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    request: &StartFlowRequest,
    plan: &RenderedPlan,
) -> Result<MaterializedFlow, FlowError> {
    let dangling = || FlowError::Invalid("rendered plan references an unwritten node".to_string());
    let mut written: Vec<(String, i64)> = Vec::with_capacity(plan.nodes.len());
    let mut opened: Option<i64> = None;

    for node in &plan.nodes {
        // The root's two parent spellings differ: `create_*` takes the kind-mapped target type,
        // `record_node` the raw one. For every other node both are the parent node's own type.
        let (create_parent, record_parent) = match node.parent {
            None => (
                (target_parent_type(&request.target_type), request.target_id),
                (request.target_type.clone(), request.target_id),
            ),
            Some(NodeRef(index)) => {
                let parent = written.get(index).ok_or_else(dangling)?.clone();
                (parent.clone(), parent)
            }
        };

        let created = match node.kind {
            InstanceType::Goal => {
                let goal = create_goal(
                    db,
                    CreateGoalRequest {
                        title: node.title.clone(),
                        parent_type: create_parent.0,
                        parent_id: create_parent.1,
                        status: None,
                        time_scope: node.time_scope.clone(),
                        on_scope_exit: None,
                    },
                )
                .await?;
                ("goal".to_string(), goal.id)
            }
            InstanceType::Task => {
                let task = create_task(
                    db,
                    CreateTaskRequest {
                        title: node.title.clone(),
                        parent_type: create_parent.0,
                        parent_id: create_parent.1,
                        status: None,
                        time_scope: node.time_scope.clone(),
                        plan: node.plan.clone(),
                        on_scope_exit: None,
                        // A materialized instance always arrives in play. Nothing enters the
                        // backlog without the user putting it there.
                        archival: None,
                    },
                )
                .await?;
                ("task".to_string(), task.id)
            }
            InstanceType::Commitment => {
                // A commitment Habit's root. Its window comes from the iteration the same way a
                // task's does; it arrives Unresolved, because a materialised instance is
                // something nobody has judged yet, and the whole point of the kind is that
                // nothing infers a verdict on the user's behalf.
                //
                // `node.plan` is ignored rather than dropped silently: a Commitment has no Plan
                // column, and a commitment flow has no Cycle Plan to set one from.
                let commitment = create_commitment(
                    db,
                    CreateCommitmentRequest {
                        title: node.title.clone(),
                        parent_type: create_parent.0,
                        parent_id: create_parent.1,
                        verdict: None,
                        time_scope: node.time_scope.clone(),
                        verdict_window: None,
                    },
                )
                .await?;
                ("commitment".to_string(), commitment.id)
            }
        };

        let instance_id = match opened {
            Some(id) => id,
            None => {
                let id = db.flows().open_instance(flow_id, &created.0, created.1).await?;
                opened = Some(id);
                id
            }
        };
        let source = match node.source {
            PlannedSource::Root => ("flow", flow_id.0),
            PlannedSource::Item(kind, id) => (kind.as_str(), id),
        };
        db.flows()
            .record_node(
                instance_id,
                (&created.0, created.1),
                source,
                (&record_parent.0, record_parent.1),
            )
            .await?;
        if node.is_private {
            set_node_private(db, &created.0, created.1).await?;
        }
        written.push(created);
    }

    for edge in &plan.edges {
        let dependent = written.get(edge.dependent.0).ok_or_else(dangling)?.1;
        let (blocker_type, blocker_id) = written.get(edge.blocker.0).ok_or_else(dangling)?.clone();
        let dependency = if blocker_type == "goal" {
            Dependency::Goal { id: blocker_id }
        } else {
            Dependency::Task { id: blocker_id }
        };
        add_task_dependency(db, TaskId(dependent), dependency).await?;
    }

    let (root_type, root_id) = written.into_iter().next().ok_or_else(dangling)?;
    Ok(MaterializedFlow { root_type, root_id })
}

/// Starts a flow: materialises its template into a real, independent Goal/Task subtree under
/// the target, resolving every cycle pair and remapping intra-flow dependencies by fan-in.
///
/// Three steps, in order: **resolve** every scope the flow needs ([`resolve_scopes`], which mints
/// them), **render** the subtree as a plan of placeholder nodes and edges ([`render`], pure), then
/// **write** it ([`write_plan`], which decides nothing). Everything that decides the *shape* of a
/// materialisation is therefore testable without a database.
///
/// Reads and writes flows, scopes, goals and tasks — the operation ADR-0004 was written for. Its
/// signature demands a transactional session so that a failure part-way through materialisation
/// cannot leave a half-built subtree behind, and so that calling it non-atomically is a compile
/// error rather than a silent correctness bug.
#[tracing::instrument(skip(db))]
pub async fn start(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    request: StartFlowRequest,
) -> Result<MaterializedFlow, FlowError> {
    let flow = db.flows().get(flow_id).await?;
    let template = load_template(db, flow_id).await?;
    let cycles = template.planned_cycles(flow_id.0);
    let scopes = resolve_scopes(&mut db.scopes(), &flow, request.anchor_date, &cycles).await?;
    let plan = render(&flow, &request.title, &template, &scopes);
    write_plan(db, flow_id, &request, &plan).await
}

/// Marks a freshly materialised node private, propagating a flow's (or flow item's) privacy onto
/// the real Goal/Task it became.
async fn set_node_private(
    db: &mut Db<Transactional>,
    node_type: &str,
    node_id: i64,
) -> Result<(), FlowError> {
    match node_type {
        "goal" => db.goals().set_private(GoalId(node_id), true).await?,
        "commitment" => {
            db.commitments().set_private(CommitmentId(node_id), true).await?
        }
        _ => db.tasks().set_private(TaskId(node_id), true).await?,
    }
    Ok(())
}
