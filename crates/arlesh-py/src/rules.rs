//! The pure rules, callable from Python over plain values.
//!
//! Each is a function of the core's rules layer (ADR 0010) — no session, no clock, no I/O — so
//! these calls are plain, not awaitable: there is nothing for them to wait on. A caller passes
//! `now` where a rule needs one, exactly as the core's own callers do.
//!
//! The set is the rules a caller can feed from values it holds: scope windows, the lifecycle
//! derivations, Habit iteration classification, the gesture cycles, parenting, compound progress,
//! wait checks and the cycle grid. The rules that work over the board's internal indexes are
//! reached through the board itself (`board` in [`crate::request`]), which runs all of them.

use std::collections::HashMap;

use arlesh_core::{
    error::{WireError, WireErrorKind},
    filters::model::NodeKind,
    flows::{
        model::IterationStatus,
        rules::{
            cycle_grid,
            habits::{self, Clock, SlotWindow},
        },
    },
    nodes::rules::parenting,
    scopes::{
        key::ScopeKey,
        model::{PartOfDay, Scope, ScopeKind},
        resolve::{resolve, Bounds},
    },
    tasks::{
        model::{DurationSpec, ExpectationStatus, OnScopeExit, Status, TaskStatus, Verdict},
        rules::{
            compound, gestures,
            gestures::{StatusStep, VerdictPress},
            lifecycle::{self, Archival, Resolution, Timing},
            waits,
        },
    },
};
use chrono::{NaiveDate, NaiveDateTime};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::errors::{Failure, Raised};

/// One rule call: a JSON object whose `rule` names the rule and whose other fields are its
/// arguments.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(tag = "rule", rename_all = "snake_case")]
pub(crate) enum Rule {
    /// The Season, Month, Week or Day of `kind` that holds `date`.
    ScopeContaining {
        /// The kind of scope.
        kind: ScopeKind,
        /// A day it holds.
        date: NaiveDate,
    },
    /// The Part-of-Day scope for `part` on `date`.
    PartScope {
        /// The day it starts on.
        date: NaiveDate,
        /// Which part.
        part: PartOfDay,
    },
    /// An Exact scope over `[start, end)`.
    ExactScope {
        /// Its start.
        start: NaiveDateTime,
        /// Its end, after `start`.
        end: NaiveDateTime,
    },
    /// The scope a key names.
    Scope {
        /// The key.
        key: ScopeKey,
    },
    /// A scope's window and where `now` stands in it.
    ResolveScope {
        /// The key.
        key: ScopeKey,
        /// The instant to resolve at.
        now: NaiveDateTime,
    },
    /// Pending before the window, Active in it, Lapsed after. No window is Active.
    DeriveTiming {
        /// The window, `[start, end)`.
        window: Option<Bounds>,
        /// The instant to judge at.
        now: NaiveDateTime,
    },
    /// How a passed window settled an item, if it did.
    DeriveResolution {
        /// The item's Timing.
        timing: Timing,
        /// Whether the item is done.
        resolved: bool,
        /// What it does once its window passes unfinished.
        on_exit: Option<OnScopeExit>,
    },
    /// The window whose end makes an item late.
    EffectiveDue {
        /// A due set on the item.
        explicit: Option<Bounds>,
        /// The window that governs it, and what it does on exit.
        governance: Option<(Bounds, OnScopeExit)>,
        /// Whether it is in the Backlog.
        backlogged: bool,
    },
    /// Whether an item is Overdue.
    DeriveOverdue {
        /// Its effective due.
        due: Option<Bounds>,
        /// Whether it is done.
        resolved: bool,
        /// Its effective Archival.
        archival: Archival,
        /// The instant to judge at.
        now: NaiveDateTime,
    },
    /// An item's effective Archival, and whether it overrode one set by hand.
    DeriveArchival {
        /// The Archival stored on it.
        stored: Option<Archival>,
        /// Its Resolution.
        resolution: Option<Resolution>,
    },
    /// An item's whole derived state: Timing, Resolution, Overdue and Archival.
    DeriveItemState {
        /// Its window.
        window: Option<Bounds>,
        /// What it does once its window passes unfinished.
        on_exit: Option<OnScopeExit>,
        /// Its effective due.
        due: Option<Bounds>,
        /// Whether it is done.
        resolved: bool,
        /// The Archival stored on it.
        stored: Option<Archival>,
        /// The instant to judge at.
        now: NaiveDateTime,
    },
    /// A Commitment's derived state.
    DeriveCommitmentState {
        /// Its window.
        window: Option<Bounds>,
        /// Its verdict.
        verdict: Verdict,
        /// How long after the window the verdict stays owed.
        verdict_window: Option<DurationSpec>,
        /// The instant to judge at.
        now: NaiveDateTime,
    },
    /// Where a Habit occurrence stands, from its iteration's status and window.
    HabitInstanceTiming {
        /// The Habit's clock.
        clock: Clock,
        /// Its iteration's status.
        iteration_status: IterationStatus,
        /// Its iteration's window.
        window: Bounds,
        /// The instant to judge at.
        now: NaiveDateTime,
    },
    /// Classifies a Habit's iteration windows under its clock.
    ClassifyHabitIterations {
        /// The iteration windows, from the Repetition Start.
        slots: Vec<SlotWindow>,
        /// The Habit's clock.
        clock: Clock,
        /// When each resolved iteration was done, as `(index, instant)` pairs. Pairs rather than a
        /// map: an internally tagged request cannot read integer map keys.
        resolved: Vec<(i64, NaiveDateTime)>,
        /// The instant to judge at.
        now: NaiveDateTime,
    },
    /// The next status in the status cycle.
    NextStatus {
        /// The status now.
        current: Status,
    },
    /// What a status gesture makes of a status, or why it writes nothing.
    StatusAfter {
        /// The gesture.
        step: StatusStep,
        /// The status now.
        current: Status,
        /// Whether the Task is compound.
        compound: bool,
    },
    /// What a verdict control makes of a verdict.
    VerdictAfter {
        /// The control.
        press: VerdictPress,
        /// The verdict now.
        current: Verdict,
    },
    /// Whether a node of kind `child` may sit under one of kind `parent`.
    MayParent {
        /// The child's kind.
        child: NodeKind,
        /// The parent's kind.
        parent: NodeKind,
    },
    /// A compound's status, read off its items' statuses.
    CompoundProgress {
        /// The items' statuses.
        states: Vec<TaskStatus>,
    },
    /// A wait's status as a compound counts it.
    ExpectationReading {
        /// The wait's status.
        status: ExpectationStatus,
    },
    /// The next check of a wait checked every `every`, after one at `at`.
    AdvanceCheck {
        /// The last check.
        at: NaiveDateTime,
        /// How often it is checked.
        every: DurationSpec,
    },
    /// The cycle navigator's levels from a Flow's period down to `target`.
    CycleLevels {
        /// How many of its kind the Flow spans.
        flow_n: i64,
        /// The Flow's kind.
        flow_kind: ScopeKind,
        /// The finest level.
        target: ScopeKind,
    },
}

/// What a status gesture makes of a status: the status it writes, or why it writes nothing.
#[derive(Debug, Serialize, schemars::JsonSchema)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub(crate) enum StatusAfter {
    /// The gesture writes `status`.
    Written {
        /// The status written.
        status: Status,
    },
    /// The gesture writes nothing.
    Refused {
        /// Why.
        reason: gestures::StatusRefusal,
    },
}

/// Reads `request` as a [`Rule`], runs it, and answers its result as JSON.
pub(crate) fn run(request: &str) -> Result<String, Raised> {
    let rule: Rule = serde_json::from_str(request).map_err(|error| {
        Failure::new(
            WireErrorKind::InvalidRequest,
            format!("unreadable rule call: {error}"),
        )
    })?;
    Ok(apply(rule)?.to_string())
}

/// `value` as JSON.
fn json(value: impl Serialize) -> Result<Value, WireError> {
    serde_json::to_value(value).map_err(|error| WireError::internal(error.to_string()))
}

/// Runs one rule.
fn apply(rule: Rule) -> Result<Value, WireError> {
    match rule {
        Rule::ScopeContaining { kind, date } => {
            json(Scope::containing(kind, date).map_err(WireError::from_error)?)
        }
        Rule::PartScope { date, part } => json(Scope::part(date, part)),
        Rule::ExactScope { start, end } => {
            json(Scope::exact(start, end).map_err(WireError::from_error)?)
        }
        Rule::Scope { key } => json(key.scope()),
        Rule::ResolveScope { key, now } => json(resolve(&key, now)),
        Rule::DeriveTiming { window, now } => json(lifecycle::derive_timing(window, now)),
        Rule::DeriveResolution {
            timing,
            resolved,
            on_exit,
        } => json(lifecycle::derive_resolution(timing, resolved, on_exit)),
        Rule::EffectiveDue {
            explicit,
            governance,
            backlogged,
        } => json(lifecycle::effective_due(explicit, governance, backlogged)),
        Rule::DeriveOverdue {
            due,
            resolved,
            archival,
            now,
        } => json(lifecycle::derive_overdue(due, resolved, archival, now)),
        Rule::DeriveArchival { stored, resolution } => {
            json(lifecycle::derive_archival(stored, resolution))
        }
        Rule::DeriveItemState {
            window,
            on_exit,
            due,
            resolved,
            stored,
            now,
        } => json(lifecycle::derive_item_state(
            window, on_exit, due, resolved, stored, now,
        )),
        Rule::DeriveCommitmentState {
            window,
            verdict,
            verdict_window,
            now,
        } => json(lifecycle::derive_commitment_state(
            window,
            verdict,
            verdict_window.as_ref(),
            now,
        )),
        Rule::HabitInstanceTiming {
            clock,
            iteration_status,
            window,
            now,
        } => json(habits::instance_timing(
            clock,
            iteration_status,
            window,
            now,
        )),
        Rule::ClassifyHabitIterations {
            slots,
            clock,
            resolved,
            now,
        } => {
            let resolved: HashMap<i64, NaiveDateTime> = resolved.into_iter().collect();
            json(habits::classify_iterations(&slots, clock, &resolved, now))
        }
        Rule::NextStatus { current } => json(gestures::next_status(current)),
        Rule::StatusAfter {
            step,
            current,
            compound,
        } => match gestures::status_after(step, current, compound) {
            Ok(status) => json(StatusAfter::Written { status }),
            Err(reason) => json(StatusAfter::Refused { reason }),
        },
        Rule::VerdictAfter { press, current } => json(gestures::verdict_after(press, current)),
        Rule::MayParent { child, parent } => json(parenting::may_parent(child, parent)),
        Rule::CompoundProgress { states } => json(compound::progress(states)),
        Rule::ExpectationReading { status } => json(compound::expectation_reading(status)),
        Rule::AdvanceCheck { at, every } => json(waits::advance_check(at, &every)),
        Rule::CycleLevels {
            flow_n,
            flow_kind,
            target,
        } => json(cycle_grid::cycle_levels(flow_n, flow_kind, target)),
    }
}
