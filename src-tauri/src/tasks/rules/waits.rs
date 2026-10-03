//! The wait rules: when a stored or spawned wait's next check falls due, on which day, and how a
//! spawned wait's schedule is drawn from its Task's template ([`spawned_schedule`]).
//!
//! Pure. The checks and spawned waits they read are loaded in [`crate::tasks::waits`], which
//! re-exports these names (ADR 0010).

use std::collections::HashMap;

use chrono::{NaiveDate, NaiveDateTime, Timelike};

use crate::nodes::wait_overlay::ExpectationOverlay;
use crate::scopes::key::ScopeKey;
use crate::scopes::model::ScopeKind;
use crate::scopes::resolve::DAY_BOUNDARY_HOUR;
use crate::tasks::error::TaskError;
use crate::tasks::lifecycle::advance_by;
use crate::tasks::model::{
    AsyncTemplate, DurationSpec, Expectation, ExpectationArchival, ExpectationStatus, SpawnedWait,
    TimeScope,
};
use crate::tasks::waits::{
    CheckRecord, DoneCheck, ExpectationCheck, SpawnedWaitView, WaitRef, WaitWindows,
};

/// `at` moved on by one Check every. Beside the four scope kinds a Duration counts in, a check can
/// come round every N **hours** or **minutes** — a finer interval than any scope, which only a
/// check needs, so it is counted here rather than taught to every Duration. A sub-day check still
/// falls on the 02:00 Day ladder through [`day_of`].
pub fn advance_check(at: NaiveDateTime, every: &DurationSpec) -> Option<NaiveDateTime> {
    match every.kind.as_str() {
        "hour" => at.checked_add_signed(chrono::Duration::try_hours(every.n)?),
        "minute" => at.checked_add_signed(chrono::Duration::try_minutes(every.n)?),
        _ => advance_by(at, every.n, &every.kind),
    }
}

/// When the next check on a wait falls due: at `starting` until a check is made, then one
/// `every` after the last one. `None` for a Duration this calendar cannot count.
pub fn next_check_due(
    every: &DurationSpec,
    starting: NaiveDateTime,
    last_check_at: Option<NaiveDateTime>,
) -> Option<NaiveDateTime> {
    match last_check_at {
        None => Some(starting),
        Some(last) => advance_check(last, every),
    }
}

/// The scope kind a Duration counts in, if it is one of the four coarse ones.
pub(in crate::tasks) fn scope_kind(kind: &str) -> Option<ScopeKind> {
    match kind {
        "day" => Some(ScopeKind::Day),
        "week" => Some(ScopeKind::Week),
        "month" => Some(ScopeKind::Month),
        "season" => Some(ScopeKind::Season),
        _ => None,
    }
}

/// The Day an instant falls in. A Day runs 02:00 → 02:00 (see
/// [`crate::scopes::resolve::DAY_BOUNDARY_HOUR`]), so 01:00 on the 5th is still the 4th: reading the
/// calendar date instead drew a check due just after midnight on the day before.
pub fn day_of(at: NaiveDateTime) -> NaiveDate {
    (at - chrono::Duration::hours(i64::from(DAY_BOUNDARY_HOUR))).date()
}

/// Whether a check due at `due` exists yet. A check task is drawn from the moment its check is
/// due, never before: a wait whose checks start tomorrow has nothing to check today.
pub fn is_due(due: NaiveDateTime, now: NaiveDateTime) -> bool {
    due <= now
}

/// When a stored wait's current check fell due — `None` while it is not checked on, or no longer
/// pending and live.
pub fn stored_check_due(expectation: &Expectation) -> Option<NaiveDateTime> {
    let (Some(every), Some(starting)) = (&expectation.check_every, expectation.check_starting)
    else {
        return None;
    };
    if expectation.status != ExpectationStatus::Pending
        || expectation.archival != ExpectationArchival::Live
    {
        return None;
    }
    next_check_due(every, starting, expectation.last_check_at)
}

/// When a spawned wait's current check fell due, given its Check every. Its first check is one
/// interval after it began, not at once — the email has only just been sent — unless the wait has a
/// Starting of its own. A completion never recorded asks for one at `now`. A check made during an
/// earlier completion, kept by the overlay, is not a check on this one.
pub fn spawned_check_due(
    wait: &SpawnedWait,
    every: &DurationSpec,
    now: NaiveDateTime,
) -> Option<NaiveDateTime> {
    next_spawned_check(&WaitProgress::of(wait), every, now)
}

/// A spawned wait's window and schedule: what its Task's Expectation template draws, under
/// whatever the wait's own overlay says (see [`crate::nodes::wait_overlay`]).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SpawnedSchedule {
    /// Its Time Scope: its own, or the template's rule counted from the day it began.
    pub time_scope: Option<TimeScope>,
    /// Its Check every: its own, or the template's.
    pub check_every: Option<DurationSpec>,
    /// Its own Starting, if it has one; otherwise its first check is one interval after it began.
    pub check_starting: Option<NaiveDateTime>,
}

/// The [`SpawnedSchedule`] of a wait drawn from `template`, begun at `spawned_at`, with `overlay`.
pub fn spawned_schedule(
    template: &AsyncTemplate,
    spawned_at: Option<NaiveDateTime>,
    overlay: &ExpectationOverlay,
) -> Result<SpawnedSchedule, TaskError> {
    let time_scope = match overlay.time_scope() {
        Some(own) => own,
        None => match (&template.time_scope, spawned_at) {
            (Some(rule), Some(began)) => window_from_rule(rule, day_of(began))?,
            _ => None,
        },
    };
    Ok(SpawnedSchedule {
        time_scope,
        check_every: overlay
            .check_every()
            .unwrap_or_else(|| template.check_every.clone()),
        check_starting: overlay.check_starting(),
    })
}

/// When a spawned wait's first check falls due: its own Starting, or one interval after it began.
pub fn first_spawned_check(wait: &WaitProgress, every: &DurationSpec) -> Option<NaiveDateTime> {
    match wait.check_starting {
        Some(own) => Some(own),
        None => advance_check(wait.spawned_at?, every),
    }
}

/// Where a spawned wait stands — whoever spawned it, a stored Task or a Habit occurrence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WaitProgress {
    /// When it began: when its Task was completed.
    pub spawned_at: Option<NaiveDateTime>,
    /// Pending or Released.
    pub status: ExpectationStatus,
    /// Live or Archived.
    pub archival: ExpectationArchival,
    /// When its last check was made, if any.
    pub last_check_at: Option<NaiveDateTime>,
    /// Its own Starting, when it has one: its first check then falls due at it.
    pub check_starting: Option<NaiveDateTime>,
}

/// [`spawned_check_due`] for a wait known by its progress alone.
pub fn next_spawned_check(
    wait: &WaitProgress,
    every: &DurationSpec,
    now: NaiveDateTime,
) -> Option<NaiveDateTime> {
    if wait.status != ExpectationStatus::Pending || wait.archival != ExpectationArchival::Live {
        return None;
    }
    let starting = match (wait.check_starting, wait.spawned_at) {
        (Some(own), _) => own,
        (None, Some(began)) => advance_check(began, every)?,
        (None, None) => now.with_nanosecond(0).unwrap_or(now),
    };
    let last = wait
        .last_check_at
        .filter(|last| wait.spawned_at.is_none_or(|began| *last >= began));
    next_check_due(every, starting, last)
}

/// The canonical node key of the wait a stored Task spawned — what its overlay is kept under.
pub fn spawned_key(task_id: i64) -> String {
    crate::nodes::key::DerivedKey::SpawnedWait(crate::nodes::id::NodeId::Stored(task_id)).node_key()
}

/// The single-day Time Scope a check due at `due` is drawn in.
pub fn check_window(due: NaiveDateTime) -> TimeScope {
    TimeScope::single(ScopeKey::day(day_of(due)))
}

/// The Time Scope a template's **rule** gives a wait that began on `from`: N of the kind, the first
/// being the one `from` falls in. `None` for a kind that cannot be counted.
pub fn window_from_rule(
    rule: &DurationSpec,
    from: NaiveDate,
) -> Result<Option<TimeScope>, TaskError> {
    let Some(kind) = scope_kind(&rule.kind) else {
        return Ok(None);
    };
    let start_at = from.and_hms_opt(12, 0, 0).unwrap_or_default();
    let Some(last) = advance_by(start_at, (rule.n - 1).max(0), &rule.kind) else {
        return Ok(None);
    };
    Ok(Some(TimeScope {
        start_id: ScopeKey::containing(kind, from)?,
        end_id: ScopeKey::containing(kind, last.date())?,
        duration: Some(rule.clone()),
    }))
}

impl WaitProgress {
    /// A stored Task's spawned wait's progress, before anything is said of its Starting.
    pub fn of(wait: &SpawnedWait) -> Self {
        Self {
            spawned_at: wait.spawned_at,
            status: wait.status,
            archival: wait.archival,
            last_check_at: wait.last_check_at,
            check_starting: None,
        }
    }
}

/// What a board's wait windows are derived from: the stored waits and every completed check, the
/// waits stored Tasks spawned with their templates, and the spawned waits' overlays.
pub struct WaitSources<'rows> {
    /// The stored Expectations.
    pub expectations: &'rows [Expectation],
    /// Every completed check, by the wait it is on, oldest first.
    pub checks: &'rows HashMap<WaitRef, Vec<CheckRecord>>,
    /// The waits stored Tasks spawned.
    pub spawned: &'rows [SpawnedWait],
    /// Each Asynchronous Task's Expectation template, by Task id.
    pub templates: &'rows HashMap<i64, AsyncTemplate>,
    /// Every derived wait's Expectation overlay, by node key.
    pub overlays: &'rows HashMap<String, ExpectationOverlay>,
}

impl WaitSources<'_> {
    /// The completed checks on `wait`, oldest first.
    fn checks_on(&self, wait: &WaitRef) -> &[CheckRecord] {
        self.checks.get(wait).map_or(&[], Vec::as_slice)
    }
}

/// Derives [`WaitWindows`] at `now`. A check is listed only once it is due — its check task exists
/// from then until it is completed — and a wait that is released or archived has none: once it is
/// over, nothing more is generated.
pub fn wait_windows(
    sources: &WaitSources<'_>,
    now: NaiveDateTime,
) -> Result<WaitWindows, TaskError> {
    let mut windows = WaitWindows::default();
    for expectation in sources.expectations {
        let Some(expectation_id) = expectation.id.stored() else {
            continue;
        };
        // Every completed check stays on the board as a done check task.
        for done in sources.checks_on(&WaitRef::Stored(expectation_id)) {
            windows.expectation_checks.push(ExpectationCheck {
                expectation_id,
                due: check_window(done.due_at),
                due_at: done.due_at,
                resolved_at: Some(done.resolved_at),
            });
        }
        if let Some(due) = stored_check_due(expectation).filter(|due| is_due(*due, now)) {
            windows.expectation_checks.push(ExpectationCheck {
                expectation_id,
                due: check_window(due),
                due_at: due,
                resolved_at: None,
            });
        }
    }
    for wait in sources.spawned {
        let Some(template) = sources.templates.get(&wait.task_id) else {
            continue;
        };
        let key = spawned_key(wait.task_id);
        let overlay = sources.overlays.get(&key).cloned().unwrap_or_default();
        let schedule = spawned_schedule(template, wait.spawned_at, &overlay)?;
        let progress = WaitProgress {
            check_starting: schedule.check_starting,
            ..WaitProgress::of(wait)
        };
        let due = schedule
            .check_every
            .as_ref()
            .and_then(|every| next_spawned_check(&progress, every, now))
            .filter(|due| is_due(*due, now));
        let check_starting = schedule
            .check_every
            .as_ref()
            .and_then(|every| first_spawned_check(&progress, every));
        let next_check = due.map(check_window);
        // Checks from an earlier completion of the Task belong to that one, not this.
        let mut done_checks = Vec::new();
        for done in sources.checks_on(&WaitRef::Spawned(wait.task_id)) {
            if wait
                .spawned_at
                .is_some_and(|began| done.resolved_at < began)
            {
                continue;
            }
            done_checks.push(DoneCheck {
                due: check_window(done.due_at),
                due_at: done.due_at,
                resolved_at: done.resolved_at,
            });
        }
        windows.spawned_waits.push(SpawnedWaitView {
            wait: wait.clone(),
            time_scope: schedule.time_scope,
            check_every: schedule.check_every,
            check_starting,
            next_check,
            next_check_at: due,
            done_checks,
        });
    }
    Ok(windows)
}
