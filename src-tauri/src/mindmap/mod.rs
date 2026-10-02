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

use chrono::NaiveDateTime;

use crate::{
    database::session::{Db, Transactional},
    error::AppError,
    flows::occurrences::Horizon,
    nodes::{
        id::NodeId,
        table::{self, StoredRows},
    },
};

use model::{FlowHabitEntry, FlowHabitResult, MindmapLoad};

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
    // Operators are borrowed per call and never held: each line takes the session, uses it, and
    // gives it back. Two bound at once would not compile.
    let domains = db.domains().list(None).await?;
    let mut goals = db.goals().list().await?;
    let mut tasks = db.tasks().list().await?;
    let mut commitments = db.commitments().list().await?;
    let mut expectations = db.expectations().list().await?;
    let mut infos = db.infos().list().await?;
    let flow_goals = db.flows().list_all_goals().await?;
    let flow_tasks = db.flows().list_all_tasks().await?;
    let flow_cycles = db.flows().list_all_cycles().await?;
    let flow_dependencies = db.flows().list_all_dependencies().await?;
    let mut block_reasons = db.block_reasons().list_all().await?;
    let mut task_dependencies = db.tasks().list_all_dependencies().await?;
    let flow_instance_nodes = db.flows().list_instance_node_refs().await?;
    let children = db.flows().list_all_instance_children().await?;
    let mut lifecycles = crate::tasks::derive_all_scope_lifecycles(db, now).await?;

    let flows = db.flows().list().await?;
    let (derived, failures) = table::derive_habits(db, &flows, now, horizon).await;
    table::attach_children(
        &children,
        &derived,
        StoredRows {
            tasks: &mut tasks,
            goals: &mut goals,
            commitments: &mut commitments,
            expectations: &mut expectations,
            infos: &mut infos,
        },
    );
    tasks.extend(derived.tasks);
    goals.extend(derived.goals);
    commitments.extend(derived.commitments);
    lifecycles.extend(derived.lifecycles);
    block_reasons.extend(derived.block_reasons);
    task_dependencies.extend(derived.dependencies);
    // A wait's rows hang on the Tasks, a Habit's occurrences included. Drawn together with every
    // compound Task's derived status, since each reads the other (see `tasks::compound`):
    // from here on a compound Task's `status` is the one its sub-items give it.
    let waits = crate::tasks::compound::settle(
        db,
        now,
        crate::tasks::compound::Board {
            tasks: &mut tasks,
            goals: &goals,
            commitments: &commitments,
            expectations: &expectations,
            lifecycles: &mut lifecycles,
        },
    )
    .await?;
    tasks.extend(waits.tasks);
    expectations.extend(waits.expectations);
    block_reasons.extend(waits.block_reasons);
    lifecycles.extend(waits.lifecycles);
    // Only now is every parent's Timing in, stored and derived alike.
    crate::tasks::mark_waits_under_pending(&expectations, &mut lifecycles);
    let present: std::collections::HashSet<&NodeId> = tasks
        .iter()
        .map(|task| &task.id)
        .chain(goals.iter().map(|goal| &goal.id))
        .collect();
    let added = table::added_edges(db, &present).await?;
    task_dependencies.extend(added);
    // The agent capacity lock blocks every Agentic Task not yet Done — before the Compound block
    // below reads "blocked", so a Compound whose open items the lock blocks is blocked too.
    if at_capacity {
        let capacity_blocks = crate::capacity::blocks::derive(
            crate::capacity::blocks::Rows {
                domains: &domains,
                goals: &goals,
                tasks: &tasks,
                commitments: &commitments,
                expectations: &expectations,
            },
            &block_reasons,
        );
        block_reasons.extend(capacity_blocks);
    }
    // Only now is every status final and every edge in: a Compound Task whose open sub-items are
    // all blocked is blocked itself, by a reason derived here (see `tasks::compound::blocked`).
    let compound_blocks = crate::tasks::compound::blocked::derive(
        &crate::tasks::compound::Rows {
            tasks: &tasks,
            checks: &[],
            goals: &goals,
            commitments: &commitments,
            expectations: &expectations,
            waits: &[],
            lifecycles: &lifecycles,
            wait_lifecycles: &[],
        },
        &block_reasons,
        &task_dependencies,
    );
    block_reasons.extend(compound_blocks);

    let habits = flows
        .iter()
        .map(|flow| FlowHabitEntry {
            flow_id: flow.id,
            flow_title: flow.title.clone(),
            result: match failures.iter().find(|failure| failure.flow_id == flow.id) {
                Some(failure) => FlowHabitResult::Failed {
                    message: failure.message.clone(),
                },
                None => FlowHabitResult::Loaded {},
            },
        })
        .collect();

    Ok(MindmapLoad {
        domains,
        goals,
        tasks,
        commitments,
        expectations,
        infos,
        flows,
        flow_goals,
        flow_tasks,
        flow_cycles,
        flow_dependencies,
        block_reasons,
        task_dependencies,
        flow_instance_nodes,
        lifecycles,
        habits,
        short_ids: std::collections::HashMap::new(),
    })
}
