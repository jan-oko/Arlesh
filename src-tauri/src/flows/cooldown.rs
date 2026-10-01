//! A Window Habit's **cooldown** (`docs/spec/habits.md`, *Cooldown*).
//!
//! After an iteration is done, the iteration after it — under Window + Owed, every iteration still
//! open — is **blocked** until the cooldown has passed: N units of a scope kind finer than the
//! Habit's own, counted from the unit after the one the completion falls in. A weekly Habit done on Saturday with a one-day cooldown has next week's
//! root blocked through Sunday, until Monday at 02:00.
//!
//! The block is a derived block reason ([`crate::block_reasons::model::DerivedBlock::Cooldown`]);
//! the iteration's window, key, relevance, due and Timing are untouched, so no overlay is ever
//! re-keyed by one. Like [`super::habits`], this module is pure — the caller hands it the slots and
//! the completion instants.

use std::collections::HashMap;

use chrono::{Duration, Months, NaiveDate, NaiveDateTime};

use super::habits::SlotWindow;
use super::model::MissPolicy;
use crate::scopes::key::ScopeKey;
use crate::scopes::model::{PartOfDay, ScopeKind};
use crate::scopes::resolve::day_boundary;
use crate::tasks::waits::day_of;

/// The six parts of one Day, in the order they run from its 02:00 start.
const DAY_PARTS: [PartOfDay; 6] = [
    PartOfDay::Premorning,
    PartOfDay::Morning,
    PartOfDay::Noon,
    PartOfDay::Afternoon,
    PartOfDay::Evening,
    PartOfDay::Night,
];

/// The unit a cooldown counts in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CooldownUnit {
    /// A part of the day — a daily Habit's.
    Part,
    /// A Day.
    Day,
    /// A Sunday-to-Saturday Week.
    Week,
    /// A Month.
    Month,
}

impl CooldownUnit {
    /// The database string representation.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Part => "part",
            Self::Day => "day",
            Self::Week => "week",
            Self::Month => "month",
        }
    }

    /// Parses the database string representation.
    pub fn from_db(value: &str) -> Option<Self> {
        match value {
            "part" => Some(Self::Part),
            "day" => Some(Self::Day),
            "week" => Some(Self::Week),
            "month" => Some(Self::Month),
            _ => None,
        }
    }

    /// The units a Habit whose window is of `habit_kind` may count a cooldown in — the kinds below
    /// its own (ruled by the user, 2026-09-30): a daily Habit's parts of the day, a weekly one's
    /// days, a monthly one's weeks or days, a seasonal one's months, weeks or days. A sub-day
    /// (Phase) window has nothing finer to count in.
    pub fn allowed_for(habit_kind: &str) -> &'static [CooldownUnit] {
        match habit_kind {
            "day" => &[Self::Part],
            "week" => &[Self::Day],
            "month" => &[Self::Week, Self::Day],
            "season" => &[Self::Month, Self::Week, Self::Day],
            _ => &[],
        }
    }
}

/// Why a cooldown cannot be stored on a Habit.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CooldownRefusal {
    /// Count without unit, or unit without count.
    #[error("cooldown count and unit must be set together")]
    Unpaired,
    /// Not a unit at all.
    #[error("unknown cooldown unit {0}")]
    UnknownUnit(String),
    /// Below one.
    #[error("a cooldown must be at least 1")]
    TooSmall,
    /// Not a unit finer than the Habit's window.
    #[error("a {habit_kind} habit's cooldown cannot be counted in {unit}s")]
    WrongUnit {
        /// The Habit's window kind.
        habit_kind: String,
        /// The unit named.
        unit: &'static str,
    },
    /// It could reach the end of the window after the one it follows.
    #[error("a cooldown must be shorter than the habit's window")]
    TooLong,
}

/// A Window Habit's cooldown: `n` units of `unit`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cooldown {
    /// How many units.
    pub n: i64,
    /// What they are.
    pub unit: CooldownUnit,
}

impl Cooldown {
    /// Reads a stored or requested pair: `None` when neither is set.
    pub fn parse(n: Option<i64>, kind: Option<&str>) -> Result<Option<Self>, CooldownRefusal> {
        match (n, kind) {
            (None, None) => Ok(None),
            (Some(n), Some(kind)) => {
                let unit = CooldownUnit::from_db(kind)
                    .ok_or_else(|| CooldownRefusal::UnknownUnit(kind.to_string()))?;
                if n < 1 {
                    return Err(CooldownRefusal::TooSmall);
                }
                Ok(Some(Self { n, unit }))
            }
            _ => Err(CooldownRefusal::Unpaired),
        }
    }

    /// Whether this cooldown fits a Habit whose window is `habit_n` × `habit_kind`: counted in a
    /// unit finer than the window's kind, and **unable to reach the end of the window after the
    /// one it follows** — so an iteration blocked by a cooldown resolved on time is unblocked
    /// before its window closes.
    ///
    /// A completion can fall as late as the last unit of a window. A unit that tiles the window
    /// (days in a week or month, parts in a day, months in a season) then starts the cooldown at
    /// the next window's start, so N units are refused once they are as many as the shortest such
    /// window holds. A Week does not tile a Month or a Season: the week holding the completion can
    /// run six days into the next window before the cooldown even starts, and those six days count
    /// against it.
    pub fn fits(&self, habit_kind: &str, habit_n: i64) -> Result<(), CooldownRefusal> {
        if !CooldownUnit::allowed_for(habit_kind).contains(&self.unit) {
            return Err(CooldownRefusal::WrongUnit {
                habit_kind: habit_kind.to_string(),
                unit: self.unit.as_str(),
            });
        }
        let habit_n = habit_n.max(1);
        let (reach, room) = match self.unit {
            CooldownUnit::Part => (self.n, 6 * habit_n),
            CooldownUnit::Day => (self.n, shortest_days(habit_kind) * habit_n),
            CooldownUnit::Week => (7 * self.n + 6, shortest_days(habit_kind) * habit_n),
            CooldownUnit::Month => (self.n, 3 * habit_n),
        };
        if reach >= room {
            return Err(CooldownRefusal::TooLong);
        }
        Ok(())
    }

    /// The instant a cooldown begun by a completion at `done` is over: the start of the unit after
    /// the one `done` falls in, moved on by `n` more units. Days, weeks and months are read by the
    /// 02:00 day boundary, as every window is; `None` only past the end of the calendar.
    pub fn ends(&self, done: NaiveDateTime) -> Option<NaiveDateTime> {
        let day = day_of(done);
        let steps = self.n.checked_add(1)?;
        let unit_start =
            |kind: ScopeKind| ScopeKey::containing(kind, day).ok().map(|k| k.start_date());
        let date = match self.unit {
            CooldownUnit::Part => return part_after(done, day, steps),
            CooldownUnit::Day => day.checked_add_signed(Duration::days(steps))?,
            CooldownUnit::Week => {
                unit_start(ScopeKind::Week)?.checked_add_signed(Duration::days(7 * steps))?
            }
            CooldownUnit::Month => unit_start(ScopeKind::Month)?
                .checked_add_months(Months::new(u32::try_from(steps).ok()?))?,
        };
        Some(day_boundary(date))
    }
}

/// The fewest days a window of `habit_kind` can hold: a February, a Winter of 90 days.
fn shortest_days(habit_kind: &str) -> i64 {
    match habit_kind {
        "week" => 7,
        "month" => 28,
        "season" => 90,
        _ => 1,
    }
}

/// The start of the part of the day `steps` parts after the one `done` falls in, on `day` — the
/// Day `done` belongs to by the 02:00 boundary.
fn part_after(done: NaiveDateTime, day: NaiveDate, steps: i64) -> Option<NaiveDateTime> {
    let current = DAY_PARTS
        .iter()
        .rposition(|part| ScopeKey::part(day, *part).bounds().0 <= done)?;
    let target = i64::try_from(current).ok()?.checked_add(steps)?;
    let date = day.checked_add_signed(Duration::days(target.div_euclid(6)))?;
    let part = DAY_PARTS.get(usize::try_from(target.rem_euclid(6)).ok()?)?;
    Some(ScopeKey::part(date, *part).bounds().0)
}

/// The iterations **cooling down** at `now`, each with the instant its cooldown ends.
///
/// `resolved` maps a slot index to the instant its iteration was resolved, however it was;
/// `done` only those that were **done** — every instance done or achieved — at the latest done
/// date, which is what starts a cooldown. `slots` is the Habit's schedule in order, future
/// iterations included, and `cooldown` the Habit's with its miss policy:
///
/// - **Archive** and **Overdue**: the iteration right after a done one is held until the cooldown
///   begun at that instant has passed, whether or not its own window has opened yet.
/// - **Owed**: every iteration still open — the owed ones from earlier windows, and the current
///   or next — is held until the cooldown begun by the latest done one has passed.
///
/// One that is itself resolved is held by nothing: there is nothing left in it to block.
pub fn holds(
    slots: &[SlotWindow],
    (resolved, done): (&HashMap<i64, NaiveDateTime>, &HashMap<i64, NaiveDateTime>),
    cooldown: Option<(Cooldown, MissPolicy)>,
    now: NaiveDateTime,
) -> HashMap<i64, NaiveDateTime> {
    let Some((cooldown, policy)) = cooldown else {
        return HashMap::new();
    };
    let open = slots
        .iter()
        .filter(|slot| !resolved.contains_key(&slot.index));
    if policy == MissPolicy::Owed {
        let Some(until) = done
            .values()
            .max()
            .and_then(|latest| cooldown.ends(*latest))
        else {
            return HashMap::new();
        };
        if until <= now {
            return HashMap::new();
        }
        return open.map(|slot| (slot.index, until)).collect();
    }
    slots
        .windows(2)
        .filter_map(|pair| {
            let [previous, next] = pair else {
                return None;
            };
            if resolved.contains_key(&next.index) {
                return None;
            }
            let until = cooldown.ends(*done.get(&previous.index)?)?;
            (until > now).then_some((next.index, until))
        })
        .collect()
}

#[cfg(test)]
mod tests;
