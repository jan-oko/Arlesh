//! Folding a Habit's passed iterations into one node, and that node into scope levels.
//!
//! A Habit leaves one node per iteration, and they never stop arriving. Every run of `threshold` or
//! more consecutive passed iterations of one Habit folds into a single **run** group, which opens
//! into **scope levels**: a level is inserted for a scope kind coarser than the iterations' own
//! only where the run spans more than one of that unit. Five days in one week are five days and no
//! week level; three weeks in one month get a week level and no month level.
//!
//! - **What folds** — every iteration whose window has passed, Done, Lapsed and Missed alike. The
//!   iteration still open never folds, and neither does **owed** work (Window + Owed, its window
//!   passed with its work still open), which rides with its run but is drawn right after it
//!   (ruled by the user, 2026-10-01).
//! - **Year keys off the Season**: a Winter straddling New Year is one season, grouped under the year
//!   its first day falls in, so a year level never appears without the season level beneath it.
//!
//! The fold runs on what the filter kept, and draws; nothing is written. Mirrors
//! `foldHabitRuns` in `src/utils/habit-collapse.ts`; `conformance/habit-fold.json` holds the two
//! together.

use chrono::{Datelike, NaiveDate};

use crate::scopes::{key::ScopeKey, model::ScopeKind};

/// What the fold reads off one iteration node.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Iteration {
    /// The Habit it belongs to; iterations fold only with their own Habit's.
    pub flow_id: i64,
    /// The scope kind its window is one unit of, or `None` for a sub-day window, which counts as a
    /// day: such a Habit steps whole days.
    pub scope_kind: Option<ScopeKind>,
    /// Its window's first day.
    pub anchor_date: NaiveDate,
    /// Whether its window has passed.
    pub passed: bool,
    /// Whether it was finished, rather than Lapsed, Missed or Expired.
    pub done: bool,
    /// Whether it is owed work.
    pub owed: bool,
}

/// One child of a node, as the fold sees it: an iteration, or anything else, which it leaves be.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Child<T> {
    /// A node that is not a Habit iteration.
    Other(T),
    /// A Habit iteration.
    Iteration(T, Iteration),
}

/// A scope level a run opens into.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    /// A Sunday-to-Saturday week.
    Week,
    /// A calendar month.
    Month,
    /// A Season.
    Season,
    /// A season-year.
    Year,
}

impl Level {
    /// The spelling a group's id uses.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Week => "week",
            Self::Month => "month",
            Self::Season => "season",
            Self::Year => "year",
        }
    }

    /// Every level, finest first.
    const FINE_TO_COARSE: [Self; 4] = [Self::Week, Self::Month, Self::Season, Self::Year];

    /// How coarse it is, on the same scale as [`own_rank`].
    fn rank(self) -> u8 {
        match self {
            Self::Week => 1,
            Self::Month => 2,
            Self::Season => 3,
            Self::Year => 4,
        }
    }
}

/// How coarse an iteration's own window is: a day (or less) 0, a week 1, a month 2, a season 3.
fn own_rank(kind: Option<ScopeKind>) -> u8 {
    match kind {
        Some(ScopeKind::Week) => 1,
        Some(ScopeKind::Month) => 2,
        Some(ScopeKind::Season) => 3,
        _ => 0,
    }
}

/// The unit of `level` that `date` falls in, as a grouping key: the first day of its week, month
/// or season, and for a year the first day of the Winter that opens it — so a year keys off its
/// Season, never the calendar.
pub fn unit_key(level: Level, date: NaiveDate) -> NaiveDate {
    let start = |kind| match ScopeKey::containing(kind, date) {
        Ok(ScopeKey::Season { date } | ScopeKey::Month { date } | ScopeKey::Week { date }) => date,
        _ => date,
    };
    match level {
        Level::Week => start(ScopeKind::Week),
        Level::Month => start(ScopeKind::Month),
        Level::Season => start(ScopeKind::Season),
        Level::Year => {
            let season = start(ScopeKind::Season);
            NaiveDate::from_ymd_opt(season.year(), 1, 1).unwrap_or(season)
        }
    }
}

/// The levels to insert for one run, coarsest first: those coarser than the iterations' own kind
/// that the run spans more than one unit of.
pub fn levels_for_run(iterations: &[Iteration]) -> Vec<Level> {
    let Some(first) = iterations.first() else {
        return Vec::new();
    };
    let own = own_rank(first.scope_kind);
    let mut levels: Vec<Level> = Level::FINE_TO_COARSE
        .into_iter()
        .filter(|level| level.rank() > own)
        .filter(|&level| {
            let first_unit = unit_key(level, first.anchor_date);
            iterations
                .iter()
                .any(|it| unit_key(level, it.anchor_date) != first_unit)
        })
        .collect();
    levels.reverse();
    levels
}

/// How a run of iterations ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tally {
    /// Iterations behind the group.
    pub passed: usize,
    /// How many of them finished.
    pub done: usize,
    /// How many did not.
    pub missed: usize,
}

/// A group the fold draws: the run, or one of its scope levels.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Group<T> {
    /// Its tree id — `habitrun-{flow}-virtual` for a run, `habitrun-{flow}-{level}-{first day}-virtual`
    /// for a level, keyed by its first iteration since one unit can appear under two coarser ones.
    pub id: String,
    /// `None` for the run, else the level.
    pub level: Option<Level>,
    /// The Habit behind it.
    pub flow_id: i64,
    /// How its iterations ended.
    pub tally: Tally,
    /// The first day of its first iteration's window.
    pub span_start: NaiveDate,
    /// What it holds: the next level down, or the iterations.
    pub children: Vec<Folded<T>>,
}

/// One child after the fold: a node as it was, or a group standing in for iterations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Folded<T> {
    /// A node drawn as it was.
    Node(T),
    /// A group of passed iterations.
    Group(Group<T>),
}

/// The run's tree id. Passed iterations are a prefix of a Habit's, so one Habit has one run, and an
/// id that survives the run growing keeps an expansion expanded.
pub fn run_id(flow_id: i64) -> String {
    format!("habitrun-{flow_id}-virtual")
}

fn level_id(flow_id: i64, level: Level, first: NaiveDate) -> String {
    format!(
        "habitrun-{flow_id}-{}-{}-virtual",
        level.as_str(),
        first.format("%Y-%m-%d")
    )
}

fn tally_of<T>(entries: &[(T, Iteration)]) -> Tally {
    let done = entries.iter().filter(|(_, it)| it.done).count();
    Tally {
        passed: entries.len(),
        done,
        missed: entries.len() - done,
    }
}

fn group<T: Clone>(
    level: Option<Level>,
    id: String,
    entries: &[(T, Iteration)],
    children: Vec<Folded<T>>,
) -> Option<Folded<T>> {
    let (_, first) = entries.first()?;
    Some(Folded::Group(Group {
        id,
        level,
        flow_id: first.flow_id,
        tally: tally_of(entries),
        span_start: first.anchor_date,
        children,
    }))
}

/// The children of an expanded run at one depth: the remaining levels, nested, then the iterations.
fn level_children<T: Clone>(entries: &[(T, Iteration)], levels: &[Level]) -> Vec<Folded<T>> {
    let Some((&level, rest)) = levels.split_first() else {
        return entries
            .iter()
            .map(|(node, _)| Folded::Node(node.clone()))
            .collect();
    };
    let mut buckets: Vec<Vec<(T, Iteration)>> = Vec::new();
    let mut current: Option<NaiveDate> = None;
    for entry in entries {
        let key = unit_key(level, entry.1.anchor_date);
        match buckets.last_mut() {
            Some(bucket) if current == Some(key) => bucket.push(entry.clone()),
            _ => buckets.push(vec![entry.clone()]),
        }
        current = Some(key);
    }
    buckets
        .iter()
        .filter_map(|bucket| {
            let (_, first) = bucket.first()?;
            let id = level_id(first.flow_id, level, first.anchor_date);
            group(Some(level), id, bucket, level_children(bucket, rest))
        })
        .collect()
}

/// Folds one node's children: every run of `threshold` or more consecutive passed iterations of one
/// Habit becomes a run group, with owed work drawn right after it; a shorter run stands as it was.
pub fn fold<T: Clone>(children: Vec<Child<T>>, threshold: usize) -> Vec<Folded<T>> {
    let mut folded = Vec::new();
    let mut run: Vec<(T, Iteration)> = Vec::new();
    let flush = |run: &mut Vec<(T, Iteration)>, folded: &mut Vec<Folded<T>>| {
        let folding: Vec<(T, Iteration)> = run.iter().filter(|(_, it)| !it.owed).cloned().collect();
        let groups = if folding.len() >= threshold {
            let metas: Vec<Iteration> = folding.iter().map(|(_, it)| it.clone()).collect();
            let levels = levels_for_run(&metas);
            folding.first().and_then(|(_, first)| {
                group(
                    None,
                    run_id(first.flow_id),
                    &folding,
                    level_children(&folding, &levels),
                )
            })
        } else {
            None
        };
        match groups {
            Some(run_group) => {
                folded.push(run_group);
                folded.extend(
                    run.drain(..)
                        .filter(|(_, it)| it.owed)
                        .map(|(node, _)| Folded::Node(node)),
                );
            }
            None => folded.extend(run.drain(..).map(|(node, _)| Folded::Node(node))),
        }
    };
    for child in children {
        match child {
            Child::Iteration(node, it) if it.passed => {
                if run
                    .first()
                    .is_some_and(|(_, first)| first.flow_id != it.flow_id)
                {
                    flush(&mut run, &mut folded);
                }
                run.push((node, it));
            }
            Child::Iteration(node, _) | Child::Other(node) => {
                flush(&mut run, &mut folded);
                folded.push(Folded::Node(node));
            }
        }
    }
    flush(&mut run, &mut folded);
    folded
}

#[cfg(test)]
mod tests;
