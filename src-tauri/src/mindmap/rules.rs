//! The board, derived from what a load read: lifecycles, every Habit's occurrences, waits and
//! compound statuses, Review, and the derived blocks — in the order each reads the last.
//!
//! Pure: [`derive_board`] is a function of the [`BoardSources`] [`super::load_within`] gathers, `now`,
//! the horizon and the capacity lock (ADR 0010).

use std::collections::HashMap;

use chrono::NaiveDateTime;

use crate::{
    error::AppError,
    flows::{
        error::FlowError,
        model::Flow,
        occurrences::{derive_habit_from, DerivedRows, HabitSource, Horizon},
    },
    nodes::{
        board::StoredBoard,
        id::NodeId,
        rules::attach::{added_edges_in, attach_children, StoredRows},
        table::HabitFailure,
    },
    tasks::{
        compound::{Board, Rows},
        expectations::EXPECTATION,
        model::{Commitment, CommitmentArchival, Expectation, Goal, Task, TaskArchival},
        rules::{
            agentic::{AgenticIndex, AgenticRows},
            archival::{self, TreeNode},
            compound::settle_in,
            scope::{derive_item_lifecycles, LifecycleRows, OccurrenceExit},
            waits::wait_windows,
        },
    },
};

use super::{
    model::{FlowHabitEntry, FlowHabitResult, MindmapLoad},
    sources::BoardSources,
};

/// Every Habit's derived rows within `horizon`, and the Habits that failed to derive.
///
/// One Habit failing does not fail the others: its rows are missing, and it is named in the
/// failures so the frontend can say so rather than draw an empty Habit.
fn derive_habits(
    flows: &[Flow],
    mut habits: HashMap<i64, Result<HabitSource, FlowError>>,
    (stored, agentic): (&StoredBoard, &AgenticIndex),
    now: NaiveDateTime,
    horizon: Horizon,
) -> (DerivedRows, Vec<HabitFailure>) {
    let mut rows = DerivedRows::default();
    let mut failures = Vec::new();
    for flow in flows.iter().filter(|flow| flow.is_habit) {
        let derived = match habits.remove(&flow.id) {
            Some(Ok(source)) => derive_habit_from(flow, source, stored, agentic, now, horizon),
            Some(Err(error)) => Err(error),
            None => Ok(DerivedRows::default()),
        };
        match derived {
            Ok(derived) => rows.extend(derived),
            Err(error) => {
                tracing::warn!(flow_id = flow.id, error = %error, "habit derivation failed");
                failures.push(HabitFailure {
                    flow_id: flow.id,
                    message: error.to_string(),
                });
            }
        }
    }
    (rows, failures)
}

/// Every Habit as a node of the containment chain: its span and the node its roots hang under. A
/// Habit whose span cannot be worked out is left out here; its derivation reports the failure.
fn habit_edges(
    flows: &[Flow],
    habits: &HashMap<i64, Result<HabitSource, FlowError>>,
) -> Vec<plans::HabitEdge> {
    let mut edges = Vec::new();
    for flow in flows.iter().filter(|flow| flow.is_habit) {
        let Some(Ok(source)) = habits.get(&flow.id) else {
            continue;
        };
        match source.span(flow) {
            Some(Ok((span, (host_type, host_id)))) => edges.push(plans::HabitEdge {
                flow_id: flow.id,
                title: flow.title.clone(),
                host: facts::content_parent(&host_type, &NodeId::Stored(host_id)),
                span,
            }),
            Some(Err(error)) => {
                tracing::warn!(flow_id = flow.id, error = %error, "habit span failed");
            }
            None => {}
        }
    }
    edges
}

/// Every content node of the board as the hand archive's inheritance reads it: a stored Task or
/// Commitment carries its own archive; nothing else can be archived by hand.
fn tree_nodes<'rows>(
    tasks: &'rows [Task],
    goals: &'rows [Goal],
    commitments: &'rows [Commitment],
    expectations: &'rows [Expectation],
) -> Vec<TreeNode<'rows>> {
    let node = |node_type, id, parent_type: &'rows String, parent_id, archived_by_hand| TreeNode {
        node_type,
        id,
        parent_type: parent_type.as_str(),
        parent_id,
        archived_by_hand,
    };
    tasks
        .iter()
        .map(|task| {
            let by_hand = task.archival == TaskArchival::Archived;
            node(
                "task",
                &task.id,
                &task.parent_type,
                &task.parent_id,
                by_hand,
            )
        })
        .chain(
            goals
                .iter()
                .map(|goal| node("goal", &goal.id, &goal.parent_type, &goal.parent_id, false)),
        )
        .chain(commitments.iter().map(|commitment| {
            let by_hand = commitment.archival == CommitmentArchival::Archived;
            node(
                "commitment",
                &commitment.id,
                &commitment.parent_type,
                &commitment.parent_id,
                by_hand,
            )
        }))
        .chain(expectations.iter().map(|wait| {
            node(
                EXPECTATION,
                &wait.id,
                &wait.parent_type,
                &wait.parent_id,
                false,
            )
        }))
        .collect()
}

/// The board at `now`: what [`super::load_within`] serves, derived from what it read.
///
/// Each kind's list is its **virtual table**: the stored rows with every Habit's occurrences
/// merged in as ordinary rows, and every stored node hung on an occurrence read as that
/// occurrence's child. When `at_capacity`, every Agentic Task not yet Done carries the capacity
/// lock's derived reason.
pub fn derive_board(
    sources: BoardSources,
    now: NaiveDateTime,
    horizon: Horizon,
    at_capacity: bool,
) -> Result<MindmapLoad, AppError> {
    let BoardSources {
        domains,
        stored,
        flows,
        flow_goals,
        flow_tasks,
        flow_cycles,
        flow_dependencies,
        mut block_reasons,
        mut task_dependencies,
        flow_instance_nodes,
        habits,
        derived_edges,
    } = sources;
    let habit_edges = habit_edges(&flows, &habits);
    let waits_sources = stored.waits.sources();
    let mut lifecycles = derive_item_lifecycles(
        LifecycleRows {
            tasks: &stored.tasks,
            goals: &stored.goals,
            commitments: &stored.commitments,
            expectations: &stored.expectations,
            ancestry: &stored.ancestry,
            wait_windows: wait_windows(&waits_sources.windows, now)?,
        },
        now,
        OccurrenceExit::Honoured,
    );

    let agentic = AgenticIndex::of(AgenticRows {
        tasks: &stored.tasks,
        goals: &stored.goals,
        commitments: &stored.commitments,
        attachments: &stored.attachments,
        overlays: stored.waits.task_overlays(),
        flows: &flows,
        flow_tasks: &flow_tasks,
        flow_goals: &flow_goals,
    });
    let (derived, failures) = derive_habits(&flows, habits, (&stored, &agentic), now, horizon);
    let mut goals = stored.goals.clone();
    let mut tasks = stored.tasks.clone();
    let mut commitments = stored.commitments.clone();
    let mut expectations = stored.expectations.clone();
    let mut infos = stored.infos.clone();
    attach_children(
        &stored.children,
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
    // A compound Habit occurrence's status is its Habit's to derive: it decides whether its iteration
    // resolved. The board serves it as derived rather than deriving it again.
    let settled = derived.settled;
    // A wait's rows hang on the Tasks, a Habit's occurrences included. Drawn together with every
    // compound Task's derived status, since each reads the other (see `tasks::compound`):
    // from here on a compound Task's `status` is the one its sub-items give it.
    let waits = settle_in(
        &waits_sources,
        &stored.ancestry,
        now,
        Board {
            tasks: &mut tasks,
            goals: &goals,
            commitments: &commitments,
            expectations: &expectations,
            lifecycles: &mut lifecycles,
            settled: &settled,
            instants: &std::collections::HashMap::new(),
            exit: OccurrenceExit::Honoured,
        },
    )?
    .waits;
    tasks.extend(waits.tasks);
    expectations.extend(waits.expectations);
    block_reasons.extend(waits.block_reasons);
    lifecycles.extend(waits.lifecycles);
    // Only now is every parent's Timing in, stored and derived alike.
    crate::tasks::mark_waits_under_pending(&expectations, &mut lifecycles);
    // Every lifecycle is in, compound ones re-derived: what lies beneath a node archived by hand
    // reads as archived (see `tasks::rules::archival`).
    archival::inherit(
        &tree_nodes(&tasks, &goals, &commitments, &expectations),
        &mut lifecycles,
    );
    // Every status is final now, and every wait drawn: an On Agent Task whose agent has a
    // question open reads Review (see `tasks::review`).
    crate::tasks::review::derive(&mut tasks, &expectations);
    let present: std::collections::HashSet<&NodeId> = tasks
        .iter()
        .map(|task| &task.id)
        .chain(goals.iter().map(|goal| &goal.id))
        .collect();
    let added = added_edges_in(&derived_edges, &present);
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
        &Rows {
            tasks: &tasks,
            checks: &[],
            goals: &goals,
            commitments: &commitments,
            expectations: &expectations,
            waits: &[],
            lifecycles: &lifecycles,
            wait_lifecycles: &[],
            settled: &std::collections::HashSet::new(),
            instants: &std::collections::HashMap::new(),
        },
        &block_reasons,
        &task_dependencies,
    );
    block_reasons.extend(compound_blocks);
    // Only now is every row in and every Overdue flag derived: each Task reads its effective
    // Plan, and Start reads where that Plan stands.
    let plans = plans::audit(&plans::PlanRows {
        domains: domains
            .iter()
            .map(|domain| (domain.id, domain.parent_id))
            .collect(),
        goals: &goals,
        tasks: &tasks,
        commitments: &commitments,
        expectations: &expectations,
        lifecycles: &lifecycles,
        habits: &habit_edges,
    });
    plans::stamp_plan_timing(&mut lifecycles, &plans, now);

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
        facts: std::collections::HashMap::new(),
        agent_activity: None,
        plans,
    })
}

pub mod facts;
pub mod plans;
