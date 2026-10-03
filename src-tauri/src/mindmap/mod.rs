//! The mindmap's whole-tree load, gathered in one operation.
//!
//! The mindmap render reads every resource-wide list at once: fetched one command at a time that
//! was a dozen IPC round trips, paid again after every edit because each mutation ends with a
//! silent reload. [`load`] is the single operation that replaces them.
//!
//! It touches many resources, so per ADR-0004 it is a free function over the session rather than
//! a method on any one operator. It writes nothing — iteration windows are derived from their
//! value keys (ADR 0009), and a Habit's occurrences from those — and takes a
//! [`Db<Transactional>`] only so that its many reads see one consistent board.
//!
//! **Nothing here assembles a tree.** Each kind's list is its virtual table ([`crate::nodes`]);
//! the frontend still builds the tree from the rows' parent links.

pub mod model;
pub mod rules;
pub mod sources;

use chrono::NaiveDateTime;

use crate::{
    database::session::{Db, Transactional},
    error::AppError,
    flows::occurrences::Horizon,
};

use model::MindmapLoad;
use sources::BoardSources;

/// Gathers every payload one mindmap render needs, at wall-clock `now`.
///
/// Each kind's list is its **virtual table**: the stored rows with every Habit's occurrences
/// merged in as ordinary rows, and every stored node hung on an occurrence read as that
/// occurrence's child. The occurrences' lifecycles are derived by the Habit's own rules and
/// merged into [`MindmapLoad::lifecycles`] beside the stored rows'.
///
/// A single Habit's derivation failing does **not** fail the load. Its occurrences are missing,
/// and its entry in [`MindmapLoad::habits`] says why, so the user is told instead of silently
/// seeing an empty Habit.
#[tracing::instrument(skip(db))]
pub async fn load(db: &mut Db<Transactional>, now: NaiveDateTime) -> Result<MindmapLoad, AppError> {
    load_within(db, now, Horizon::default(), false).await
}

/// [`load`], blocked by the agent capacity lock when `at_capacity`: every Agentic Task not yet
/// Done carries its derived reason (see [`crate::capacity::blocks`]). What every reader of
/// "blocked" loads — the app's board, the MCP's snapshot and lookups; [`load`] is for the readers
/// that take statuses, rows or lifecycles off the board and never its blocks.
#[tracing::instrument(skip(db))]
pub async fn load_blocked(
    db: &mut Db<Transactional>,
    now: NaiveDateTime,
    at_capacity: bool,
) -> Result<MindmapLoad, AppError> {
    load_within(db, now, Horizon::default(), at_capacity).await
}

/// [`load`], deriving the Habits' future occurrences as far as `horizon` names — the Plan View
/// filling a month that has not begun — and blocked by the agent capacity lock when `at_capacity`.
#[tracing::instrument(skip(db))]
pub async fn load_within(
    db: &mut Db<Transactional>,
    now: NaiveDateTime,
    horizon: Horizon,
    at_capacity: bool,
) -> Result<MindmapLoad, AppError> {
    let sources = BoardSources::read(db).await?;
    rules::derive_board(sources, now, horizon, at_capacity)
}
