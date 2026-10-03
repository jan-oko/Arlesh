//! The Flow and Habit scheduling rules: a Flow's window and its cycles' scopes, a Habit's
//! iteration slots under each clock (Window and Interval), its cooldown and verdict windows, and
//! where a started Flow's root and items are planned.
//!
//! Pure functions over a Flow's template and recurrence, told `now` where they need it. The reads
//! and writes that use them live in [`crate::flows`], which imports these names (ADR 0010).

use std::collections::HashMap;

use chrono::{Datelike, Duration, Months, NaiveDate, NaiveDateTime, NaiveTime, Timelike};

use crate::flows::{
    cooldown,
    error::FlowError,
    habits::{instance_timing, Clock, SlotWindow},
    model::{
        ClockKind, Flow, FlowGoal, FlowItemCycle, FlowItemType, FlowRecurrence, FlowTask,
        HabitInstance, IterationStatus, MissPolicy, SetRecurrenceRequest, NO_CYCLE,
    },
    render::{ResolvedPair, ScopeTable},
};
use crate::scopes::key::ScopeKey;
use crate::scopes::model::{PartOfDay, ScopeKind};
use crate::scopes::resolve::day_boundary;
use crate::tasks::lifecycle::verdict_deadline;
use crate::tasks::model::{DurationSpec, TimeScope};

/// Sentinel `item_type` for the flow **root** occurrence in the overlays. The root is an instance in
/// its own right (not just an aggregate of items); its rows key `item_id` to the flow id so they
/// stay unique per flow on a shared iteration date.
pub(in crate::flows) const ROOT_INSTANCE_TYPE: &str = "flow_root";

/// Advances `date` by `k` (possibly zero) periods of `kind`; `None` on calendar overflow.
pub(in crate::flows) fn advance(date: NaiveDate, k: i64, kind: &str) -> Option<NaiveDate> {
    match kind {
        "day" => date.checked_add_signed(Duration::days(k)),
        "week" => date.checked_add_signed(Duration::days(k * 7)),
        "month" => date.checked_add_months(Months::new(u32::try_from(k).ok()?)),
        "season" => date.checked_add_months(Months::new(u32::try_from(k * 3).ok()?)),
        _ => None,
    }
}

/// Maps a target node kind to the parent_type a real goal/task uses (domain-table kinds → project).
pub(in crate::flows) fn target_parent_type(kind: &str) -> String {
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
pub(in crate::flows) fn min_period_days(kind: &str) -> Result<i64, FlowError> {
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
pub(in crate::flows) enum WindowSpec {
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
pub(in crate::flows) fn parse_hhmm(value: Option<&str>) -> Result<NaiveTime, FlowError> {
    let value = value
        .ok_or_else(|| FlowError::Invalid("exact flow window needs a time range".to_string()))?;
    NaiveTime::parse_from_str(value, "%H:%M").map_err(|e| FlowError::Invalid(e.to_string()))
}

/// Reads a flow's Flow Window into a [`WindowSpec`]. Phase kinds draw their band/time from the
/// date-free descriptor columns; Span kinds use the `n`/canonical-kind Duration.
pub(in crate::flows) fn window_spec(
    flow: &Flow,
    kind: &str,
    n: i64,
) -> Result<WindowSpec, FlowError> {
    match kind {
        "part" => {
            let band = flow
                .flow_window_part
                .as_deref()
                .and_then(PartOfDay::parse_db)
                .ok_or_else(|| {
                    FlowError::Invalid("part flow window needs a valid band".to_string())
                })?;
            Ok(WindowSpec::Part(band))
        }
        "exact" => Ok(WindowSpec::Exact {
            start: parse_hhmm(flow.flow_window_time_start.as_deref())?,
            end: parse_hhmm(flow.flow_window_time_end.as_deref())?,
        }),
        _ => Ok(WindowSpec::Span {
            n,
            kind: flow_scope_kind(kind)?,
            kind_str: kind.to_string(),
        }),
    }
}

/// Whole `kind` periods from `from` to `to` (period starts), or `None` for an unsupported kind.
/// Non-negative whenever `to >= from` (guaranteed here by scope containment). Used to turn a
/// descendant's absolute Time Scope into a relative Cycle Scope offset within the flow window.
pub(in crate::flows) fn periods_between(from: NaiveDate, to: NaiveDate, kind: &str) -> Option<i64> {
    let month_delta = (i64::from(to.year()) - i64::from(from.year())) * 12 + i64::from(to.month())
        - i64::from(from.month());
    match kind {
        "day" => Some((to - from).num_days()),
        "week" => Some((to - from).num_days() / 7),
        "month" => Some(month_delta),
        "season" => Some(month_delta / 3),
        _ => None,
    }
}

/// Reduces a stored Recurrence to the pure [`Clock`] it names.
pub(in crate::flows) fn parse_clock(recurrence: &FlowRecurrence) -> Result<Clock, FlowError> {
    match ClockKind::from_db(&recurrence.clock) {
        Some(ClockKind::Interval) => Ok(Clock::Interval),
        Some(ClockKind::Window) => recurrence
            .miss_policy
            .as_deref()
            .and_then(MissPolicy::from_db)
            .map(Clock::Window)
            .ok_or_else(|| {
                FlowError::Invalid(format!("bad miss policy {:?}", recurrence.miss_policy))
            }),
        None => Err(FlowError::Invalid(format!(
            "bad clock {}",
            recurrence.clock
        ))),
    }
}

/// Refuses a cooldown the Habit cannot carry (`docs/spec/habits.md`, *Cooldown*): one on anything
/// but a Window clock (see [`takes_cooldown`]) or on a commitment Habit; one counted in a unit that is not
/// finer than the Habit's window; and one that could reach the end of the window after the one it
/// follows.
pub(in crate::flows) fn check_cooldown(
    flow: &Flow,
    request: &SetRecurrenceRequest,
) -> Result<(), FlowError> {
    let parsed = cooldown::Cooldown::parse(request.cooldown_n, request.cooldown_kind.as_deref())
        .map_err(|refusal| FlowError::Invalid(refusal.to_string()))?;
    let Some(parsed) = parsed else {
        return Ok(());
    };
    if request.clock != ClockKind::Window || !takes_cooldown(request.miss_policy) {
        return Err(FlowError::Invalid(
            "only a window habit has a cooldown — an interval's gap already counts from completion"
                .to_string(),
        ));
    }
    let kind = flow.flow_duration_kind.as_deref().unwrap_or_default();
    parsed
        .fits(kind, flow.flow_duration_n.unwrap_or(1))
        .map_err(|refusal| FlowError::Invalid(refusal.to_string()))
}

/// Whether a Habit with this miss policy may carry a cooldown: any **Window** Habit — Archive,
/// Overdue and Owed alike (ruled by the user, 2026-10-01) — and not an Interval, whose Gap already
/// counts from completion and which has no miss policy.
pub(in crate::flows) fn takes_cooldown(policy: Option<MissPolicy>) -> bool {
    policy.is_some()
}

/// The cooldown a Habit's iterations are blocked by, or `None` when it has none.
///
/// A stored cooldown that no longer fits the Habit's window — its window was changed since, to
/// one the cooldown's unit is not finer than, or one too short for it — holds nothing back: the
/// editor refuses to save it again until it is fixed, and until then the Habit runs without it.
pub(in crate::flows) fn habit_cooldown(
    flow: &Flow,
    recurrence: &FlowRecurrence,
) -> Option<cooldown::Cooldown> {
    if !takes_cooldown(
        recurrence
            .miss_policy
            .as_deref()
            .and_then(MissPolicy::from_db),
    ) {
        return None;
    }
    let kind = flow.flow_duration_kind.as_deref()?;
    let parsed =
        cooldown::Cooldown::parse(recurrence.cooldown_n, recurrence.cooldown_kind.as_deref())
            .ok()
            .flatten()?;
    parsed
        .fits(kind, flow.flow_duration_n.unwrap_or(1))
        .is_ok()
        .then_some(parsed)
}

/// Fine-to-coarse ordinal for a scope kind (`exact` < `part` < `day` < `week` < `month` <
/// `season`), used to check a Habit's Gap kind is no finer than its habit scope.
pub(in crate::flows) fn scope_kind_rank(kind: &str) -> Result<i64, FlowError> {
    Ok(match kind {
        "exact" => 0,
        "part" => 1,
        "day" => 2,
        "week" => 3,
        "month" => 4,
        "season" => 5,
        other => {
            return Err(FlowError::Invalid(format!(
                "unsupported scope kind {other}"
            )))
        }
    })
}

/// The `ScopeKind` for a flow-scope kind string (Span or Phase).
pub(in crate::flows) fn flow_scope_kind(kind: &str) -> Result<ScopeKind, FlowError> {
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

/// The `index`-th (1-based) `kind` subscope beginning at `base`, by offset.
pub(in crate::flows) fn offset_scope(
    base: NaiveDate,
    index: i64,
    kind: &str,
) -> Result<ScopeKey, FlowError> {
    let off = index - 1;
    let bad_date = || FlowError::Invalid("cycle resolves outside the calendar".to_string());
    match kind {
        "season" | "month" | "week" | "day" => {
            let date = advance(base, off, kind).ok_or_else(bad_date)?;
            Ok(ScopeKey::containing(flow_scope_kind(kind)?, date)?)
        }
        "part_of_day" => {
            let date = advance(base, off / 6, "day").ok_or_else(bad_date)?;
            let part = PartOfDay::CYCLE[usize::try_from(off % 6).unwrap_or(0)];
            Ok(ScopeKey::part(date, part))
        }
        other => Err(FlowError::Invalid(format!(
            "unsupported cycle kind {other}"
        ))),
    }
}

/// A cycle pair resolved against a window start.
pub(in crate::flows) struct ResolvedCycle {
    /// The scope the Cycle Scope landed on — kept for its `[start, end)` datetime bounds, which
    /// are what a virtual occurrence's Timing is read from.
    pub(in crate::flows) scope: ScopeKey,
    /// That same scope as a single-scope Time Scope, ready to stamp on a node.
    pub(in crate::flows) time_scope: TimeScope,
    /// The Cycle Plan within it, when the pair carries one.
    pub(in crate::flows) plan: Option<TimeScope>,
}

/// Resolves a cycle pair against the window start, into the concrete scope it lands on plus its
/// Cycle Scope and Cycle Plan. `None` for a null-scope pair, an item with no pair, or an unscoped
/// flow — all three mean "inherit the root", which has no window of its own to report.
///
/// The single implementation of the Cycle Scope offset. [`start`] takes it through
/// [`resolve_pair`] and [`generate_habit_iterations`] takes it directly, so the window a Habit
/// *renders* and the window a started flow *writes* cannot drift apart.
pub(in crate::flows) fn resolve_cycle(
    pair: Option<&FlowItemCycle>,
    window_start: Option<NaiveDate>,
) -> Result<Option<ResolvedCycle>, FlowError> {
    let (Some(pair), Some(base)) = (pair, window_start) else {
        return Ok(None);
    };
    let (Some(kind), Some(index)) = (pair.scope_kind.as_deref(), pair.scope_index) else {
        return Ok(None);
    };
    let scope = offset_scope(base, index, kind)?;
    let cycle_start = scope.start_date();

    let plan = match (pair.plan_kind.as_deref(), pair.plan_start, pair.plan_end) {
        // A Cycle Plan of the scope's own kind is the scope itself — its one cell, which is what a
        // pair's "Planned" toggle stores. Offsetting from the scope's start date would not do: a
        // Noon cycle's first part of the day is Morning.
        (Some(pk), Some(1), Some(1)) if pk == kind => Some(TimeScope::single(scope)),
        (Some(pk), Some(_), Some(_)) if pk == kind => {
            return Err(FlowError::Invalid(
                "a Cycle Plan of its scope's own kind has one cell".to_string(),
            ))
        }
        (Some(pk), Some(ps), Some(pe)) => Some(TimeScope {
            start_id: offset_scope(cycle_start, ps, pk)?,
            end_id: offset_scope(cycle_start, pe, pk)?,
            duration: None,
        }),
        _ => None,
    };
    Ok(Some(ResolvedCycle {
        scope,
        time_scope: TimeScope::single(scope),
        plan,
    }))
}

/// Resolves a cycle pair into a concrete (Time Scope, Plan) against the window start.
/// A null-scope pair (or an unscoped flow) yields `(None, None)` — the item inherits the root.
pub(in crate::flows) fn resolve_pair(
    pair: Option<&FlowItemCycle>,
    window_start: Option<NaiveDate>,
) -> Result<(Option<TimeScope>, Option<TimeScope>), FlowError> {
    Ok(match resolve_cycle(pair, window_start)? {
        Some(resolved) => (Some(resolved.time_scope), resolved.plan),
        None => (None, whole_scope_plan(pair, window_start)?),
    })
}

/// Resolves the concrete flow window `[anchor, anchor + (n-1) periods]` of `kind`, returning
/// the Time Scope and its start date. The anchor is snapped to the start of its canonical scope.
pub(in crate::flows) fn resolve_window(
    n: i64,
    kind: &str,
    anchor: NaiveDate,
) -> Result<(TimeScope, NaiveDate), FlowError> {
    let start_scope = ScopeKey::containing(flow_scope_kind(kind)?, anchor)?;
    let start_date = start_scope.start_date();
    let end_date = advance(start_date, n - 1, kind)
        .ok_or_else(|| FlowError::Invalid("window exceeds the calendar".to_string()))?;
    let end_scope = ScopeKey::containing(flow_scope_kind(kind)?, end_date)?;
    Ok((
        TimeScope {
            start_id: start_scope,
            end_id: end_scope,
            duration: Some(DurationSpec {
                n,
                kind: kind.to_string(),
            }),
        },
        start_date,
    ))
}

/// Resolves a flow's Flow Window against a concrete `anchor` date into a Time Scope: a coarse
/// **Span** yields a `[start, end]` boundary of canonical scopes; a sub-day **Phase** yields a
/// single part/exact scope built on the anchor day. Returns the window and its first day.
pub(in crate::flows) fn resolve_flow_window(
    flow: &Flow,
    anchor: NaiveDate,
) -> Result<(TimeScope, NaiveDate), FlowError> {
    let kind = flow
        .flow_duration_kind
        .as_deref()
        .ok_or_else(|| FlowError::Invalid("flow has no window".to_string()))?;
    let n = flow.flow_duration_n.unwrap_or(1);
    match window_spec(flow, kind, n)? {
        WindowSpec::Span { .. } => resolve_window(n, kind, anchor),
        WindowSpec::Part(band) => Ok((TimeScope::single(ScopeKey::part(anchor, band)), anchor)),
        WindowSpec::Exact { start, end } => Ok((
            TimeScope::single(ScopeKey::exact(
                anchor.and_time(start),
                anchor.and_time(end),
            )?),
            anchor,
        )),
    }
}

/// One window of a Habit's Flow Window anchored on `anchor`: its anchoring scope, its half-open
/// `[start, end)` instants, and — for a coarse Span — the day the next window would start on if
/// windows tiled contiguously.
pub(in crate::flows) fn window_at(
    spec: &WindowSpec,
    anchor: NaiveDate,
) -> Result<(ScopeKey, NaiveDateTime, NaiveDateTime, Option<NaiveDate>), FlowError> {
    match spec {
        WindowSpec::Span { n, kind, kind_str } => {
            let scope = ScopeKey::containing(*kind, anchor)?;
            let window_start = scope.start_date();
            let next_contiguous = advance(window_start, *n, kind_str)
                .ok_or_else(|| FlowError::Invalid("iteration exceeds the calendar".to_string()))?;
            Ok((
                scope,
                day_boundary(window_start),
                day_boundary(next_contiguous),
                Some(next_contiguous),
            ))
        }
        WindowSpec::Part(band) => {
            let scope = ScopeKey::part(anchor, *band);
            let (start, end) = scope.bounds();
            Ok((scope, start, end, None))
        }
        WindowSpec::Exact { start: ts, end: te } => {
            let scope = ScopeKey::exact(anchor.and_time(*ts), anchor.and_time(*te))?;
            let (start, end) = scope.bounds();
            Ok((scope, start, end, None))
        }
    }
}

/// Builds a **Window** Habit's iteration windows from the Repetition Start up to (and including
/// the one covering) `limit` — the reference instant, or a later day when the virtual tables derive
/// part of the future — bounded by any end. A **Span** window spans `n` canonical periods and tiles
/// contiguously; a **Phase** window is the fixed band / clock-range on its anchor day. Each next
/// anchor advances by the Gap — for a Phase window that Gap is the whole-day stride between
/// occurrence days (defaulting to daily), keeping the time-of-day fixed.
pub(in crate::flows) fn habit_slots(
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
        let (scope_id, start, end, span_next) = window_at(&spec, anchor)?;

        // A window counts as started once its first instant is at or before `now`.
        if start > now || end_date.is_some_and(|last| start.date() > last) {
            break;
        }
        slots.push(SlotWindow {
            index,
            scope_id,
            start,
            end,
        });

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

/// An **Interval** Habit's instances, each placed by the completion of the one before it, up to
/// `limit` and bounded by any end.
///
/// The first instance is anchored on the Repetition Start. Each later one is placed by
/// [`next_interval_slot`] from the instant the one before it was completed, which
/// `completed_at` answers for a slot (`None` while it is open). The chain therefore stops at the
/// first instance not completed — the **one open instance** — or at the first whose window has
/// not begun by `limit`.
///
/// `spec` is `None` for an **Unscoped** Interval Habit: its instances have no window. Each is
/// keyed by an Exact scope one second long at the instant it appears, since the key names the
/// instance and needs no window to do it — two instances can never appear in the same second,
/// because the next is never placed before the last one's start.
pub(in crate::flows) fn interval_slots(
    start_date: NaiveDate,
    spec: Option<&WindowSpec>,
    gap: Option<&(i64, String)>,
    end_date: Option<NaiveDate>,
    limit: NaiveDateTime,
    mut completed_at: impl FnMut(&SlotWindow) -> Option<NaiveDateTime>,
) -> Result<Vec<SlotWindow>, FlowError> {
    let mut slots = Vec::new();
    let mut slot = match spec {
        Some(spec) => {
            let (scope_id, start, end, _) = window_at(spec, start_date)?;
            SlotWindow {
                index: 0,
                scope_id,
                start,
                end,
            }
        }
        None => unscoped_slot(0, day_boundary(start_date))?,
    };
    loop {
        let past_end = end_date.is_some_and(|last| crate::tasks::waits::day_of(slot.start) > last);
        if slot.start > limit || past_end {
            break;
        }
        slots.push(slot.clone());
        let Some(done) = completed_at(&slot) else {
            break;
        };
        slot = next_interval_slot(spec, gap, &slot, done)?;
    }
    Ok(slots)
}

/// The instance an Unscoped Interval Habit keys on the instant `appears`: an Exact scope one
/// second long there, with no window of its own ([`habits::UNBOUNDED`]).
pub(in crate::flows) fn unscoped_slot(
    index: i64,
    appears: NaiveDateTime,
) -> Result<SlotWindow, FlowError> {
    let appears = appears.with_nanosecond(0).unwrap_or(appears);
    let scope_id = ScopeKey::exact(appears, appears + Duration::seconds(1))?;
    Ok(SlotWindow {
        index,
        scope_id,
        start: appears,
        end: habits::UNBOUNDED,
    })
}

/// Where an Interval Habit's next instance falls, given the one before it was completed at `done`.
///
/// **Scoped:** its window starts the unit after the one `done` falls in, plus the Gap — a two-week
/// window W1–2 completed in W3 gives W4–5, completed in W1 gives W2–3 (ruled by the user,
/// 2026-09-30). The unit is the window's own scope kind; a sub-day (Phase) window's is the Day, so
/// the band falls on the day after the completion. It never starts at or before the window it
/// follows, so an instance completed before its window opened still moves the Habit on.
///
/// **Unscoped:** it appears the Gap after the unit `done` falls in — with no Gap, at `done` itself,
/// immediately. "Every three days", completed on a Monday, appears on the Thursday.
pub(in crate::flows) fn next_interval_slot(
    spec: Option<&WindowSpec>,
    gap: Option<&(i64, String)>,
    previous: &SlotWindow,
    done: NaiveDateTime,
) -> Result<SlotWindow, FlowError> {
    let overflow = || FlowError::Invalid("iteration exceeds the calendar".to_string());
    let index = previous.index + 1;
    let done_day = crate::tasks::waits::day_of(done);
    let previous_day = crate::tasks::waits::day_of(previous.start);
    let with_gap = |from: NaiveDate| match gap {
        Some((n, kind)) => advance(from, *n, kind).ok_or_else(overflow),
        None => Ok(from),
    };
    let Some(spec) = spec else {
        let appears = match gap {
            None => done,
            Some((_, kind)) => {
                let unit = ScopeKey::containing(flow_scope_kind(kind)?, with_gap(done_day)?)?;
                day_boundary(unit.start_date())
            }
        };
        return unscoped_slot(index, appears.max(previous.start + Duration::seconds(1)));
    };
    let (unit_kind, previous_unit) = match spec {
        WindowSpec::Span { kind, kind_str, .. } => (
            kind_str.as_str(),
            ScopeKey::containing(*kind, done_day)?.start_date(),
        ),
        WindowSpec::Part(_) | WindowSpec::Exact { .. } => ("day", done_day),
    };
    let after_completion = with_gap(advance(previous_unit, 1, unit_kind).ok_or_else(overflow)?)?;
    let after_previous = advance(previous_day, 1, unit_kind).ok_or_else(overflow)?;
    let (scope_id, start, end, _) = window_at(spec, after_completion.max(after_previous))?;
    Ok(SlotWindow {
        index,
        scope_id,
        start,
        end,
    })
}

/// Where a cloned template lands: the clone's parent and its sort position among its new siblings.
///
/// Absent — which is what a fork passes — the clone keeps the original's parent and takes the head
/// of the list, because a fork stands in for the flow it was forked from.
pub(in crate::flows) struct ClonePlacement {
    /// The clone's `parent_type` (`aspect`/`project`/`domain`/`goal`).
    pub(in crate::flows) parent_type: String,
    /// The clone's parent id.
    pub(in crate::flows) parent_id: i64,
    /// The clone's sort position.
    pub(in crate::flows) position: i64,
}

/// A cloned template: the new flow row, and the old→new id maps for its items.
///
/// The maps are how a caller carries something across that the clone itself does not — privacy,
/// for [`duplicate_flow`] — without [`FlowOperator::clone_template`] needing to know about it.
pub(in crate::flows) struct TemplateClone {
    /// The new flow row.
    pub(in crate::flows) flow: Flow,
    /// Old→new `flow_goals` ids.
    pub(in crate::flows) goals: HashMap<i64, i64>,
    /// Old→new `flow_tasks` ids.
    pub(in crate::flows) tasks: HashMap<i64, i64>,
}

/// Splits a list of copied items into per-table old→new id maps, for remapping references that
/// name an item by `(item_type, item_id)`.
pub(in crate::flows) fn item_id_maps(
    copied: &[(FlowItemType, i64, i64)],
) -> (HashMap<i64, i64>, HashMap<i64, i64>) {
    let mut goals = HashMap::new();
    let mut tasks = HashMap::new();
    for (kind, old_id, new_id) in copied {
        match kind {
            FlowItemType::FlowGoal => goals.insert(*old_id, *new_id),
            FlowItemType::FlowTask => tasks.insert(*old_id, *new_id),
        };
    }
    (goals, tasks)
}

/// The window of the iteration anchored on `iteration` and its first day, or `None` when the flow
/// is Unscoped — an Interval Habit's, whose instances have no window.
pub(crate) fn iteration_window(
    flow: &Flow,
    iteration: ScopeKey,
) -> Result<Option<(TimeScope, NaiveDate)>, FlowError> {
    if flow.flow_duration_kind.is_none() {
        return Ok(None);
    }
    resolve_flow_window(flow, iteration.start_date()).map(Some)
}

/// The Flow Window a Habit's iterations are drawn with, or `None` for an Unscoped flow — which
/// only an Interval Habit may be.
pub(in crate::flows) fn flow_window_spec(flow: &Flow) -> Result<Option<WindowSpec>, FlowError> {
    // `n` is only meaningful for a coarse Span; a Phase window carries its own band/time.
    flow.flow_duration_kind
        .as_deref()
        .map(|kind| window_spec(flow, kind, flow.flow_duration_n.unwrap_or(1)))
        .transpose()
}

/// A Habit's iteration windows up to `limit`, by its clock: a **Window** clock tiles them from
/// the Repetition Start ([`habit_slots`]); an **Interval** clock chains each off the completion of
/// the one before it ([`interval_slots`]), which `completed_at` answers.
pub(in crate::flows) fn clock_slots(
    flow: &Flow,
    recurrence: &FlowRecurrence,
    clock: Clock,
    limit: NaiveDateTime,
    completed_at: impl FnMut(&SlotWindow) -> Option<NaiveDateTime>,
) -> Result<Vec<SlotWindow>, FlowError> {
    let spec = flow_window_spec(flow)?;
    let start_date = recurrence.start_scope_id.start_date();
    let end_date = recurrence.end_scope_id.map(|end| end.start_date());
    let gap = recurrence.gap_n.zip(recurrence.gap_kind.clone());
    match clock {
        Clock::Interval => interval_slots(
            start_date,
            spec.as_ref(),
            gap.as_ref(),
            end_date,
            limit,
            completed_at,
        ),
        Clock::Window(_) => {
            let spec = spec.ok_or_else(|| {
                FlowError::Invalid("a window habit requires a scoped flow".to_string())
            })?;
            habit_slots(start_date, spec, gap.as_ref(), end_date, limit)
        }
    }
}

/// What resolving one iteration's occurrences needs about the Habit as a whole, as opposed to
/// about the single iteration being resolved.
pub(in crate::flows) struct HabitShape<'template> {
    /// Every flow item, in render order: goals then tasks, each in position order.
    pub(in crate::flows) items: &'template [(String, i64)],
    /// Each item's cycle pairs in position order, keyed `(item_type, item_id)`. An item missing
    /// from the map declares none.
    pub(in crate::flows) cycles: &'template HashMap<(String, i64), Vec<FlowItemCycle>>,
    /// The Habit's clock, which decides when an occurrence's passed window makes it past.
    pub(in crate::flows) clock: Clock,
    /// Whether the flow has a window — an Unscoped Interval Habit's cycle pairs resolve to none.
    pub(in crate::flows) scoped: bool,
}

/// Resolves the occurrences one Habit iteration renders: every flow item, **once per cycle pair it
/// declares** — SPEC's "a flow item with N pairs produces N items", which `start` has always obeyed
/// and the virtual render path did not — and once, unscoped, when it declares none.
///
/// Each pair is resolved against *this* iteration's window start, so the same template item lands
/// on a different concrete morning every day it recurs.
///
/// An occurrence whose window has not opened at `now` is produced like any other, carrying
/// [`InstanceTiming::Pending`](model::InstanceTiming::Pending). Generation says where the clock
/// stands; the **preset** says what is on screen — All shows everything, Plan/Start/Do hide the
/// not-yet-open, so this evening's item does not sit among the morning's work while still being
/// reachable when you ask to see it all.
/// Dropping it here instead put it beyond every preset at once, All included.
pub(in crate::flows) fn resolve_iteration_instances(
    shape: &HabitShape<'_>,
    slot: &SlotWindow,
    status: IterationStatus,
    now: NaiveDateTime,
) -> Result<Vec<HabitInstance>, FlowError> {
    let no_pairs: Vec<FlowItemCycle> = Vec::new();
    // An Unscoped Interval Habit has no window for a Cycle Scope to be an offset into.
    let window_start = shape.scoped.then(|| slot.start.date());
    let mut instances = Vec::new();
    for (item_type, item_id) in shape.items {
        let pairs = shape
            .cycles
            .get(&(item_type.clone(), *item_id))
            .unwrap_or(&no_pairs);
        // An item with no pairs is one occurrence with no window of its own: it is relevant for
        // exactly as long as the iteration around it is, which is what it has always been.
        if pairs.is_empty() {
            instances.push(HabitInstance {
                item_type: item_type.clone(),
                item_id: *item_id,
                cycle_id: NO_CYCLE,
                time_scope: None,
                plan: None,
                timing: instance_timing(shape.clock, status, (slot.start, slot.end), now),
            });
            continue;
        }
        for pair in pairs {
            // A pair whose Cycle Scope is null is a pair that names no window; it falls back to
            // the iteration's, like an item with no pair at all.
            let (time_scope, plan, start, end) = match resolve_cycle(Some(pair), window_start)? {
                Some(resolved) => {
                    let (start, end) = resolved.scope.bounds();
                    (Some(resolved.time_scope), resolved.plan, start, end)
                }
                None => (
                    None,
                    whole_scope_plan(Some(pair), window_start)?,
                    slot.start,
                    slot.end,
                ),
            };
            instances.push(HabitInstance {
                item_type: item_type.clone(),
                item_id: *item_id,
                cycle_id: pair.id,
                time_scope,
                plan,
                timing: instance_timing(shape.clock, status, (start, end), now),
            });
        }
    }
    Ok(instances)
}

/// The instant each iteration of a **commitment** Habit stops being answerable: the end of its own
/// window plus the flow's Verdict Window.
///
/// Empty for anything else — a goal or task Habit has no verdict to record, and a commitment Habit
/// with no Verdict Window set is answerable indefinitely, which is what the kind does whenever
/// nothing sets one. The arithmetic is the same [`verdict_deadline`] a real Commitment's Archival
/// is decided by, so a Habit's iterations and a hand-made Commitment expire by one rule.
///
/// Empty, too, on an **Interval** clock: an Interval instance never expires — it stays open until
/// it is resolved (ruled by the user, 2026-10-02) — so no Verdict Window applies to one.
pub(in crate::flows) fn verdict_deadlines(
    flow: &Flow,
    clock: Clock,
    slots: &[SlotWindow],
) -> HashMap<i64, NaiveDateTime> {
    if flow.instance_type != "commitment" {
        return HashMap::new();
    }
    let Some(duration) = habit_verdict_window(flow, clock) else {
        return HashMap::new();
    };
    slots
        .iter()
        .filter_map(|slot| {
            verdict_deadline(Some((slot.start, slot.end)), Some(&duration))
                .map(|deadline| (slot.index, deadline))
        })
        .collect()
}

/// The Verdict Window a commitment Habit's iterations answer to under `clock`: the flow's own on a
/// Window clock, and none on an **Interval**, whose instance stays open until it is answered.
pub(crate) fn habit_verdict_window(flow: &Flow, clock: Clock) -> Option<DurationSpec> {
    if clock == Clock::Interval {
        return None;
    }
    flow.verdict_window_n
        .zip(flow.verdict_window_kind.clone())
        .map(|(n, kind)| DurationSpec { n, kind })
}

/// Resolves a flow's root **Cycle Plan** — a relative plan window inside the flow window — against
/// one concrete window start. `None` when the flow carries none (a goal or commitment flow never
/// does) or has no window to resolve it in.
///
/// Shared by [`start`], which writes it onto the root Task, and by a Habit's occurrences, which
/// read it per iteration: one resolution, so a started flow and a derived iteration root cannot
/// disagree about when "the 2nd day" of the window falls.
pub(in crate::flows) fn resolve_root_plan(
    flow: &Flow,
    window_start: Option<NaiveDate>,
) -> Result<Option<TimeScope>, FlowError> {
    let (Some(kind), Some(plan_start), Some(plan_end), Some(base)) = (
        flow.root_plan_kind.as_deref(),
        flow.root_plan_start,
        flow.root_plan_end,
        window_start,
    ) else {
        return Ok(None);
    };
    Ok(Some(window_plan(base, kind, plan_start, plan_end)?))
}

/// A relative plan counted from the flow window's start: `[start, end]` of `kind`. With `kind`
/// the window's own and `1..n`, it is the whole window — what the "Planned" toggle stores.
pub(in crate::flows) fn window_plan(
    base: NaiveDate,
    kind: &str,
    start: i64,
    end: i64,
) -> Result<TimeScope, FlowError> {
    Ok(TimeScope {
        start_id: offset_scope(base, start, kind)?,
        end_id: offset_scope(base, end, kind)?,
        duration: None,
    })
}

/// A **whole-scope** pair's Cycle Plan: it names no Cycle Scope, so its plan is counted from the
/// flow window's start, like the root's. `None` for a scoped pair (see [`resolve_cycle`]), a pair
/// with no plan, or an unscoped flow.
pub(crate) fn whole_scope_plan(
    pair: Option<&FlowItemCycle>,
    window_start: Option<NaiveDate>,
) -> Result<Option<TimeScope>, FlowError> {
    let (Some(pair), Some(base)) = (pair, window_start) else {
        return Ok(None);
    };
    if pair.scope_kind.is_some() {
        return Ok(None);
    }
    let (Some(kind), Some(start), Some(end)) =
        (pair.plan_kind.as_deref(), pair.plan_start, pair.plan_end)
    else {
        return Ok(None);
    };
    Ok(Some(window_plan(base, kind, start, end)?))
}

/// Resolves every scope a flow materialisation needs into a lookup table, in two rounds per pair:
/// the Cycle Scope from the window start, then the Cycle Plan from *that scope's* own start date.
/// Both rounds already live inside [`resolve_pair`]; this walks the pairs. Pure: every scope is
/// derived from its key.
///
/// `cycles` is the *reachable* pair list, not every pair the flow owns: an orphaned item is never
/// walked, so its pairs are never resolved.
pub(in crate::flows) fn resolve_scopes(
    flow: &Flow,
    anchor: NaiveDate,
    cycles: &[FlowItemCycle],
) -> Result<ScopeTable, FlowError> {
    // The flow window, only when the flow is scoped (Span or Phase).
    let (window, window_start): (Option<TimeScope>, Option<NaiveDate>) =
        if flow.flow_duration_kind.is_some() {
            let (time_scope, start) = resolve_flow_window(flow, anchor)?;
            (Some(time_scope), Some(start))
        } else {
            (None, None)
        };

    // The root's relative Cycle Plan (task instance type only), against the window start.
    let root_plan = resolve_root_plan(flow, window_start)?;

    let mut pairs: HashMap<i64, ResolvedPair> = HashMap::with_capacity(cycles.len());
    for cycle in cycles {
        let (time_scope, plan) = resolve_pair(Some(cycle), window_start)?;
        pairs.insert(cycle.id, ResolvedPair { time_scope, plan });
    }

    Ok(ScopeTable {
        window,
        root_plan,
        pairs,
    })
}
