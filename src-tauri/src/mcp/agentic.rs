//! The snapshot's agentic query: only the Tasks that read as Agentic, with what they hang from.
//!
//! "Reads as Agentic" is the app's one resolver (`tasks::agentic`): a Task's own flag, else the
//! nearest flagged ancestor's, through a Habit's template tree for an occurrence. Stored and
//! derived Tasks both count. Inside the MCP roots it is exactly what the MCP may write, which is how
//! it is asked here.

use std::collections::{HashMap, HashSet};

use chrono::NaiveDateTime;

use crate::{
    access::{
        model::{NodeKey, NodeTable},
        resolve::AccessMap,
    },
    database::session::{Db, Transactional},
    error::AppError,
    mindmap::model::MindmapLoad,
    nodes::{id::NodeId, key::DerivedKey, table::resolve_key},
};

/// Whether the Task `id` — on a board already cut to the roots — reads as Agentic, and so whether
/// the MCP may write it.
pub(super) async fn reads_agentic(
    db: &mut Db<Transactional>,
    map: &AccessMap,
    id: &NodeId,
    now: NaiveDateTime,
) -> Result<bool, AppError> {
    let derived = match id {
        NodeId::Stored(row) => return Ok(map.can_write(NodeKey::new(NodeTable::Task, *row))),
        NodeId::Derived(derived) => derived,
    };
    Ok(match resolve_key(db, derived, now).await? {
        DerivedKey::Occurrence(key) => {
            crate::tasks::agentic::occurrence_reads_agentic(db, &key).await?
        }
        _ => false,
    })
}

/// Every Task on `load` that reads as Agentic.
pub(super) async fn agentic_tasks(
    db: &mut Db<Transactional>,
    map: &AccessMap,
    load: &MindmapLoad,
    now: NaiveDateTime,
) -> Result<HashSet<NodeId>, AppError> {
    let mut agentic = HashSet::new();
    for task in &load.tasks {
        if reads_agentic(db, map, &task.id, now).await? {
            agentic.insert(task.id.clone());
        }
    }
    Ok(agentic)
}

type Key = (NodeTable, NodeId);

fn key(node_type: &str, id: &NodeId) -> Option<Key> {
    NodeTable::from_reference(node_type).map(|table| (table, id.clone()))
}

/// Narrows `load` to the Tasks in `agentic` — at `max_priority` or more urgent, when given — and
/// the rows they hang from, for context; their waits and notes come along too. Every other node
/// goes, with every entry naming one, and the Flow sections go whole: a Flow is not a Task.
///
/// The Tasks section comes back matches first, most urgent first (no priority last), then the
/// context rows. Returns which Tasks matched.
pub(super) fn narrow(
    load: &mut MindmapLoad,
    agentic: &HashSet<NodeId>,
    max_priority: Option<u8>,
) -> HashSet<NodeId> {
    let matched: HashSet<NodeId> = load
        .tasks
        .iter()
        .filter(|task| agentic.contains(&task.id))
        .filter(|task| {
            max_priority.is_none_or(|most| {
                task.agentic_brief
                    .as_ref()
                    .and_then(|brief| brief.priority)
                    .is_some_and(|priority| priority <= most)
            })
        })
        .map(|task| task.id.clone())
        .collect();

    let mut parents: HashMap<Key, Option<Key>> = HashMap::new();
    for domain in &load.domains {
        let parent = domain
            .parent_id
            .map(|id| (NodeTable::Domain, NodeId::Stored(id)));
        parents.insert((NodeTable::Domain, NodeId::Stored(domain.id)), parent);
    }
    for goal in &load.goals {
        let parent = key(&goal.parent_type, &goal.parent_id);
        parents.insert((NodeTable::Goal, goal.id.clone()), parent);
    }
    for task in &load.tasks {
        let parent = key(&task.parent_type, &task.parent_id);
        parents.insert((NodeTable::Task, task.id.clone()), parent);
    }
    for commitment in &load.commitments {
        let parent = key(&commitment.parent_type, &commitment.parent_id);
        parents.insert((NodeTable::Commitment, commitment.id.clone()), parent);
    }
    for expectation in &load.expectations {
        let parent = key(&expectation.parent_type, &expectation.parent_id);
        parents.insert((NodeTable::Expectation, expectation.id.clone()), parent);
    }

    let mut keep: HashSet<Key> = HashSet::new();
    for id in &matched {
        let mut cursor = Some((NodeTable::Task, id.clone()));
        while let Some(node) = cursor {
            if !keep.insert(node.clone()) {
                break;
            }
            cursor = parents.get(&node).cloned().flatten();
        }
    }
    let under_match = |node_type: &str, id: &NodeId| node_type == "task" && matched.contains(id);
    for expectation in &load.expectations {
        if under_match(&expectation.parent_type, &expectation.parent_id) {
            keep.insert((NodeTable::Expectation, expectation.id.clone()));
        }
    }
    let infos: HashSet<i64> = load
        .infos
        .iter()
        .filter(|info| under_match(&info.parent_type, &info.parent_id))
        .map(|info| info.id)
        .collect();

    let kept =
        |node_type: &str, id: &NodeId| key(node_type, id).is_some_and(|node| keep.contains(&node));
    load.domains
        .retain(|domain| kept("domain", &NodeId::Stored(domain.id)));
    load.goals.retain(|goal| kept("goal", &goal.id));
    load.tasks.retain(|task| kept("task", &task.id));
    load.commitments
        .retain(|commitment| kept("commitment", &commitment.id));
    load.expectations
        .retain(|expectation| kept("expectation", &expectation.id));
    load.infos.retain(|info| infos.contains(&info.id));
    load.lifecycles
        .retain(|lifecycle| kept(&lifecycle.node_type, &lifecycle.node_id));
    load.block_reasons
        .retain(|reason| kept(&reason.owner_type, &reason.owner_id));
    load.task_dependencies.retain(|edge| {
        kept("task", &edge.task_id) && kept(&edge.dependency_type, &edge.dependency_id)
    });
    load.flows.clear();
    load.flow_goals.clear();
    load.flow_tasks.clear();
    load.flow_cycles.clear();
    load.flow_dependencies.clear();
    load.flow_instance_nodes.clear();
    load.habits.clear();

    load.tasks.sort_by_key(|task| {
        let priority = task
            .agentic_brief
            .as_ref()
            .and_then(|brief| brief.priority)
            .unwrap_or(u8::MAX);
        (!matched.contains(&task.id), priority)
    });
    matched
}
