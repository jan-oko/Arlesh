//! What a **compound Habit occurrence** reads as — worked out by its Habit, because whether its
//! iteration has resolved depends on it (`docs/spec/habits.md`, *Iteration resolution*).
//!
//! A compound Task's status is drawn from its own subtree and nothing else (Task f99,
//! `tasks::compound`). For an occurrence that subtree is the iteration's occurrences beneath it,
//! what is hung on any of them by hand, and the waits and check tasks all of those draw — none of
//! which waits on the iteration's classification. So the Habit pass works it out **first**, by the
//! very function the board uses ([`settle`]), over the subtree **as it stands before the iteration
//! is classified**: the iteration's own rows are drawn provisionally, as if it were open, and what
//! hangs on an occurrence with no window of its own is not archived by that occurrence's window
//! passing ([`OccurrenceExit::Ignored`]). Archival that follows only from the iteration lapsing
//! therefore never feeds back into whether it resolved.
//!
//! The board then serves each status as it is, rather than deriving it a second time
//! ([`super::occurrences::DerivedRows::settled`]).
//!
//! **Only iterations something was done in are worked out here** — those carrying an overlay, a
//! relation or an attached child. In any other, nothing beneath a compound occurrence is finished,
//! so it cannot read Done and cannot resolve its iteration; the board derives what it reads as.
//!
//! The design rests on a compound's status depending **on its subtree alone**: derived blocks from
//! outside it, such as the capacity lock or a cooldown, block a Task but never change its status.
//! Should a compound's status ever take an input from outside its subtree — a real future option —
//! this and the board could disagree, and resolution would have to move after the full board
//! derivation instead.

//!
//! Pure: [`readings_in`] works them out over the stored board; the reads live in
//! [`crate::flows::compound_readings`] (ADR 0010).

use std::collections::{HashMap, HashSet};

use chrono::NaiveDateTime;

use crate::{
    error::AppError,
    flows::{
        error::FlowError,
        model::Flow,
        occurrences::{DerivedRows, LoadedHabit},
    },
    nodes::{
        board::StoredBoard,
        id::NodeId,
        rules::attach::{attach_children, StoredRows},
        waits::occurrence_key,
    },
    tasks::{
        compound::{instants::occurrence_instants, Board},
        model::Status,
        rules::{
            compound::settle_in,
            scope::{derive_item_lifecycles, LifecycleRows, OccurrenceExit},
            waits::wait_windows,
        },
    },
};

/// What one compound occurrence reads as.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Reading {
    /// Its derived status, in the model it holds.
    pub status: Status,
    /// When it became Done — the latest finish in its subtree that has a known instant — while it
    /// reads as Done. `None` while it does not, or when nothing in its subtree has an instant.
    pub done_at: Option<NaiveDateTime>,
}

/// Each compound occurrence's [`Reading`], by its canonical node key.
pub type Readings = HashMap<String, Reading>;

/// A Habit's provisional rows, and the node key of each compound occurrence among them.
pub(in crate::flows) type Provisional = (DerivedRows, HashMap<NodeId, String>);

/// The compound occurrences `habit` draws in the iterations something was done in, drawn
/// provisionally, as if each iteration were open — or `None` when it draws none, and there is
/// nothing to work out.
pub(in crate::flows) fn provisional_compounds(
    flow: &Flow,
    habit: &LoadedHabit,
    now: NaiveDateTime,
) -> Result<Option<Provisional>, FlowError> {
    if !habit.has_compound(flow) || habit.touched().is_empty() {
        return Ok(None);
    }
    let mut provisional = DerivedRows::default();
    for scope in habit.touched() {
        provisional.extend(habit.provisional_rows(flow, *scope, now)?);
    }
    let compound: HashMap<NodeId, String> = provisional
        .tasks
        .iter()
        .filter(|task| task.compound)
        .filter_map(|task| {
            let origin = task.origin.habit()?;
            Some((task.id.clone(), occurrence_key(origin).node_key()))
        })
        .collect();
    if compound.is_empty() {
        return Ok(None);
    }
    Ok(Some((provisional, compound)))
}

/// Each of `compound`'s occurrences' [`Reading`], by its node key: every compound Task among
/// `provisional`'s rows and the stored rows, settled with what is hung on the occurrences attached
/// to them.
pub(in crate::flows) fn readings_in(
    provisional: DerivedRows,
    compound: &HashMap<NodeId, String>,
    habit: &LoadedHabit,
    board: &StoredBoard,
    now: NaiveDateTime,
) -> Result<Readings, FlowError> {
    tracing::debug!(
        occurrences = compound.len(),
        "deriving compound occurrences"
    );
    let derived = derive_subtrees(provisional, habit, board, now).map_err(flow_error)?;
    Ok(derived
        .into_iter()
        .filter_map(|(id, reading)| Some((compound.get(&id)?.clone(), reading)))
        .collect())
}

/// Derives every compound Task among `provisional`'s rows and the stored rows, by
/// [`settle_in`], with what is hung on the occurrences attached to them.
fn derive_subtrees(
    provisional: DerivedRows,
    habit: &LoadedHabit,
    board: &StoredBoard,
    now: NaiveDateTime,
) -> Result<HashMap<NodeId, Reading>, AppError> {
    let mut tasks = board.tasks.clone();
    let mut goals = board.goals.clone();
    let mut commitments = board.commitments.clone();
    let mut expectations = board.expectations.clone();
    let mut infos = board.infos.clone();
    attach_children(
        &board.children,
        &provisional,
        StoredRows {
            tasks: &mut tasks,
            goals: &mut goals,
            commitments: &mut commitments,
            expectations: &mut expectations,
            infos: &mut infos,
        },
    );
    let waits = board.waits.sources();
    let mut lifecycles = derive_item_lifecycles(
        LifecycleRows {
            tasks: &board.tasks,
            goals: &board.goals,
            commitments: &board.commitments,
            expectations: &board.expectations,
            ancestry: &board.ancestry,
            wait_windows: wait_windows(&waits.windows, now)?,
        },
        now,
        OccurrenceExit::Ignored,
    );
    let mut instants = board.instants.clone();
    instants.extend(occurrence_instants(habit.overlays()));
    tasks.extend(provisional.tasks);
    goals.extend(provisional.goals);
    commitments.extend(provisional.commitments);
    expectations.extend(provisional.expectations);
    lifecycles.extend(provisional.lifecycles);
    let settled = settle_in(
        &waits,
        &board.ancestry,
        now,
        Board {
            tasks: &mut tasks,
            goals: &goals,
            commitments: &commitments,
            expectations: &expectations,
            lifecycles: &mut lifecycles,
            settled: &HashSet::new(),
            instants: &instants,
            exit: OccurrenceExit::Ignored,
        },
    )?;
    let done_at: HashMap<&NodeId, Option<NaiveDateTime>> = settled
        .outcomes
        .iter()
        .map(|outcome| (&outcome.id, outcome.done_at))
        .collect();
    Ok(tasks
        .iter()
        .filter(|task| task.compound)
        .map(|task| {
            let reading = Reading {
                status: task.status,
                done_at: done_at.get(&task.id).copied().flatten(),
            };
            (task.id.clone(), reading)
        })
        .collect())
}

/// An error from the board-wide derivations, as the Habit pass reports it.
pub(in crate::flows) fn flow_error(error: AppError) -> FlowError {
    match error {
        AppError::Flow(error) => error,
        AppError::Task(error) => FlowError::Task(error),
        AppError::Scope(error) => FlowError::Scope(error),
        AppError::Database(error) => FlowError::Database(error),
        other => FlowError::Invalid(other.to_string()),
    }
}

#[cfg(test)]
mod tests;
