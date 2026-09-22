//! The mindmap's whole-tree load, gathered in one operation.
//!
//! The mindmap render reads thirteen resource-wide lists plus, for each flow, its derived Habit
//! iterations and per-instance statuses. Fetched one command at a time that is `13 + 2N` IPC
//! round trips for `N` flows, paid again after every edit because each mutation ends with a
//! silent reload. [`load`] is the single operation that replaces them.
//!
//! It touches nine resources, so per ADR-0004 it is a free function over the session rather than
//! a method on any one operator. It takes a [`Db<Transactional>`] because
//! [`crate::flows::generate_habit_iterations`] writes: materialising an iteration window mints
//! the scope rows it lands on. Mode follows the operation's consistency requirement, not the
//! reader's intuition that a load is read-only.
//!
//! **Nothing here assembles.** Every field of [`MindmapLoad`] is what the equivalent
//! single-resource command returns; the frontend still builds the tree.

pub mod model;

use chrono::NaiveDateTime;

use crate::{
    database::session::{Db, Transactional},
    error::AppError,
    flows::{
        self,
        error::FlowError,
        model::{Flow, FlowId, HabitItemStatus, HabitIteration},
    },
};

use model::{FlowHabitEntry, FlowHabitResult, MindmapLoad};

/// Gathers every payload one mindmap render needs, at wall-clock `now`.
///
/// The per-flow wave is resolved here rather than by a second call from the frontend: the flow
/// list is read first, then each flow's Habit payload is derived from it on the same connection.
///
/// A single flow's derivation failing does **not** fail the load. It is recorded as
/// [`FlowHabitResult::Failed`] on that flow's entry and the rest of the mindmap still arrives —
/// preserving the isolation the frontend used to get from a per-call `.catch(() => [])`, but
/// carrying the reason so the user can be told instead of silently seeing an empty Habit.
#[tracing::instrument(skip(db))]
pub async fn load(db: &mut Db<Transactional>, now: NaiveDateTime) -> Result<MindmapLoad, AppError> {
    // Operators are borrowed per call and never held: each line takes the session, uses it, and
    // gives it back. Two bound at once would not compile.
    let domains = db.domains().list(None).await?;
    let goals = db.goals().list().await?;
    let tasks = db.tasks().list().await?;
    let commitments = db.commitments().list().await?;
    let infos = db.infos().list().await?;
    let flow_goals = db.flows().list_all_goals().await?;
    let flow_tasks = db.flows().list_all_tasks().await?;
    let flow_cycles = db.flows().list_all_cycles().await?;
    let flow_dependencies = db.flows().list_all_dependencies().await?;
    let block_reasons = db.block_reasons().list_all().await?;
    let task_dependencies = db.tasks().list_all_dependencies().await?;
    let flow_instance_nodes = db.flows().list_instance_node_refs().await?;
    let habit_instance_children = db.flows().list_all_instance_children().await?;
    let lifecycles = crate::tasks::derive_all_scope_lifecycles(db, now).await?;

    // The dependent wave: the flow list first, then one entry per flow derived from it.
    let flows = db.flows().list().await?;
    let mut habits = Vec::with_capacity(flows.len());
    for flow in &flows {
        habits.push(habit_entry(db, flow, now).await);
    }

    Ok(MindmapLoad {
        domains,
        goals,
        tasks,
        commitments,
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
        habit_instance_children,
    })
}

/// One flow's Habit entry, with a failed derivation recorded rather than propagated.
///
/// This is the only place in the load that swallows an error, and it does not discard it: the
/// message travels to the frontend on the entry, and is logged here at `warn` so a failure is
/// visible in the log even if the user dismisses the notice.
#[tracing::instrument(skip(db, flow), fields(flow_id = flow.id))]
async fn habit_entry(
    db: &mut Db<Transactional>,
    flow: &Flow,
    now: NaiveDateTime,
) -> FlowHabitEntry {
    let result = match habit_payload(db, FlowId(flow.id), now).await {
        Ok((iterations, statuses)) => FlowHabitResult::Loaded {
            iterations,
            statuses,
        },
        Err(error) => {
            tracing::warn!(error = %error, "mindmap load: habit payload failed");
            FlowHabitResult::Failed {
                message: error.to_string(),
            }
        }
    };
    FlowHabitEntry {
        flow_id: flow.id,
        flow_title: flow.title.clone(),
        result,
    }
}

/// One flow's iterations and per-instance statuses.
///
/// The recurrence is probed first rather than letting
/// [`generate_habit_iterations`](crate::flows::generate_habit_iterations) reject a flow that has
/// none. A flow without a recurrence is simply not a Habit — the overwhelmingly common case —
/// and has no iterations; routing it through the failure path would raise a notice about every
/// ordinary flow on every load. What stays a failure is a flow that *is* a Habit and could not
/// be derived (an unscoped one, an unparseable Consumption, a missing scope row).
async fn habit_payload(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    now: NaiveDateTime,
) -> Result<(Vec<HabitIteration>, Vec<HabitItemStatus>), FlowError> {
    let recurrence = db.flows().get_recurrence(flow_id).await?;
    let iterations = match recurrence {
        None => Vec::new(),
        Some(_) => flows::generate_habit_iterations(db, flow_id, now).await?,
    };
    let statuses = db.flows().list_item_statuses(flow_id).await?;
    Ok((iterations, statuses))
}
