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
pub mod plan_guard;
pub mod publisher;
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
    load_within(
        db,
        now,
        Horizon::default(),
        crate::capacity::blocks::Blocking::default(),
    )
    .await
}

/// [`load`], blocked by the agents at capacity: every Agentic Task not yet Done that they cover carries its derived reason (see [`crate::capacity::blocks`]). What every reader of
/// "blocked" loads — the app's board, the MCP's snapshot and lookups; [`load`] is for the readers
/// that take statuses, rows or lifecycles off the board and never its blocks.
#[tracing::instrument(skip(db, blocking))]
pub async fn load_blocked(
    db: &mut Db<Transactional>,
    now: NaiveDateTime,
    blocking: crate::capacity::blocks::Blocking,
) -> Result<MindmapLoad, AppError> {
    load_within(db, now, Horizon::default(), blocking).await
}

/// [`load`], deriving the Habits' future occurrences as far as `horizon` names — the Plan View
/// filling a month that has not begun — and blocked as [`load_blocked`] is.
#[tracing::instrument(skip(db, blocking))]
pub async fn load_within(
    db: &mut Db<Transactional>,
    now: NaiveDateTime,
    horizon: Horizon,
    blocking: crate::capacity::blocks::Blocking,
) -> Result<MindmapLoad, AppError> {
    let sources = BoardSources::read(db).await?;
    rules::derive_board(sources, now, horizon, blocking)
}

/// The **whole board** a host shows, at wall-clock `now`: [`load_blocked`], plus what is derived
/// on top of it — every node's short id, the board's facts and the agent-activity counts.
///
/// Which nodes the MCP can see is a badge, not the board, so a failure to read the access grants
/// still loads: the facts are then derived without it.
#[tracing::instrument(skip(db, blocking))]
pub async fn board(
    db: &mut Db<Transactional>,
    now: NaiveDateTime,
    blocking: crate::capacity::blocks::Blocking,
) -> Result<MindmapLoad, AppError> {
    Ok(board_timed(db, now, blocking).await?.0)
}

/// How long the two halves of a derive took: reading the sources, and deriving from them.
#[derive(Debug, Clone, Copy, Default)]
pub struct DeriveSplit {
    /// Reading every table the board derives from.
    pub read: std::time::Duration,
    /// Everything after: the rules, the facts, the short ids.
    pub derive: std::time::Duration,
}

/// [`board`], and how long reading and deriving each took: what the press timing log reports.
pub async fn board_timed(
    db: &mut Db<Transactional>,
    now: NaiveDateTime,
    blocking: crate::capacity::blocks::Blocking,
) -> Result<(MindmapLoad, DeriveSplit), AppError> {
    let started = std::time::Instant::now();
    let sources = BoardSources::read(db).await?;
    let read = started.elapsed();
    let derived = std::time::Instant::now();
    let mut load = rules::derive_board(sources, now, Horizon::default(), blocking)?;
    let access = match crate::access::access_map(db).await {
        Ok(map) => Some(map.effective()),
        Err(error) => {
            tracing::warn!(error = %error, "the MCP's view could not be read");
            None
        }
    };
    load.answer_drafts = db.answer_drafts().list().await?;
    load.short_ids = crate::mcp::ids::board_short_ids(&load);
    let (facts, activity) = rules::facts::derive(&load, access.as_deref());
    load.facts = facts;
    load.agent_activity = Some(activity);
    let derive = derived.elapsed();
    Ok((load, DeriveSplit { read, derive }))
}

/// The board a host publishes, at wall-clock `now`: [`board`], blocked by the agents at capacity
/// as the MCP's reads are.
///
/// The one derivation behind `/board`, the app's full load and the [`publisher`], so all three read
/// alike.
#[tracing::instrument(skip(db))]
pub async fn current(
    db: &mut Db<Transactional>,
    now: NaiveDateTime,
) -> Result<MindmapLoad, AppError> {
    Ok(current_timed(db, now).await?.0)
}

/// [`current`], and how long reading and deriving each took.
pub async fn current_timed(
    db: &mut Db<Transactional>,
    now: NaiveDateTime,
) -> Result<(MindmapLoad, DeriveSplit), AppError> {
    let blocking = crate::agents::service::blocking(db, now).await?;
    board_timed(db, now, blocking).await
}
