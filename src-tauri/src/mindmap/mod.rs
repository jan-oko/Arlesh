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
    load_within(db, now, Horizon::default()).await
}

/// [`load`], deriving the Habits' future occurrences as far as `horizon` names — the Plan View
/// filling a month that has not begun.
#[tracing::instrument(skip(db))]
pub async fn load_within(
    db: &mut Db<Transactional>,
    now: NaiveDateTime,
    horizon: Horizon,
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
    // A wait's rows hang on the Tasks, a Habit's occurrences included.
    let waits = crate::nodes::waits::derive_waits(db, now, &tasks).await?;
    tasks.extend(waits.tasks);
    expectations.extend(waits.expectations);
    block_reasons.extend(waits.block_reasons);
    lifecycles.extend(waits.lifecycles);
    let present: std::collections::HashSet<&NodeId> = tasks
        .iter()
        .map(|task| &task.id)
        .chain(goals.iter().map(|goal| &goal.id))
        .collect();
    let added = table::added_edges(db, &present).await?;
    task_dependencies.extend(added);

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
    })
}
