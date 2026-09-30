//! The agent capacity lock as a **derived block**: while it is on, every Agentic Task not yet Done
//! is blocked, by a reason no one wrote and no one can remove but by clearing the lock.
//!
//! This is the one derivation. It runs over a [`MindmapLoad`] and adds the reasons to the load's
//! own `block_reasons`, marked [`DerivedBlock::AgentCapacity`], so everything that already reads
//! block reasons — the filters' `is_blocked` (Start, Unblock), the snapshot's `block_reasons`
//! section, `arlesh_tasks.get`, the app's blocked glyph and its refusal to start a blocked Task —
//! takes the lock from here without learning it exists.

use std::collections::HashMap;

use crate::{
    block_reasons::model::{BlockReason, DerivedBlock},
    mindmap::model::MindmapLoad,
    nodes::id::NodeId,
};

#[cfg(test)]
mod tests;

/// The reason's text, for a reader that has no words of its own for it — an agent. The app draws
/// its own, translated, off [`DerivedBlock::AgentCapacity`].
pub const AGENT_CAPACITY_REASON: &str = "Agents at capacity";

/// A node on the load, keyed the way the frontend keys it: `task-12`, `goal-3`, `domain-1`.
type Key = String;

/// What the Agentic walk needs of one node: where it hangs, and its own flag if it has one.
struct Link {
    parent: Option<Key>,
    agentic: Option<bool>,
}

/// The key a content row's `(parent_type, parent_id)` names. The four domains-table subtypes share
/// one `domain-` namespace.
fn parent_key(parent_type: &str, parent_id: &NodeId) -> Key {
    match parent_type {
        "goal" | "task" | "commitment" | "expectation" | "info" => {
            format!("{parent_type}-{parent_id}")
        }
        _ => format!("domain-{parent_id}"),
    }
}

/// Every node that can sit above a Task, with its parent and — for a Task — its own flag.
fn links(load: &MindmapLoad) -> HashMap<Key, Link> {
    let mut links = HashMap::new();
    for domain in &load.domains {
        let parent = domain.parent_id.map(|id| format!("domain-{id}"));
        links.insert(
            format!("domain-{}", domain.id),
            Link {
                parent,
                agentic: None,
            },
        );
    }
    let content = load
        .goals
        .iter()
        .map(|goal| ("goal", &goal.id, &goal.parent_type, &goal.parent_id, None))
        .chain(load.tasks.iter().map(|task| {
            let parent = (&task.parent_type, &task.parent_id);
            ("task", &task.id, parent.0, parent.1, task.agentic)
        }))
        .chain(load.commitments.iter().map(|commitment| {
            let parent = (&commitment.parent_type, &commitment.parent_id);
            ("commitment", &commitment.id, parent.0, parent.1, None)
        }))
        .chain(load.expectations.iter().map(|expectation| {
            let parent = (&expectation.parent_type, &expectation.parent_id);
            ("expectation", &expectation.id, parent.0, parent.1, None)
        }));
    for (kind, id, parent_type, parent_id, agentic) in content {
        let parent = Some(parent_key(parent_type, parent_id));
        links.insert(format!("{kind}-{id}"), Link { parent, agentic });
    }
    links
}

/// Whether the node at `key` reads as Agentic: its own flag, else the nearest flagged ancestor's,
/// else not — the rule `propagateAgentic` draws the board by. An explicit `false` is an answer.
fn reads_agentic(links: &HashMap<Key, Link>, key: &str) -> bool {
    let mut cursor = links.get(key);
    // A parent chain is a tree; the bound only stops a corrupt board from looping forever.
    for _ in 0..=links.len() {
        let Some(link) = cursor else {
            return false;
        };
        if let Some(agentic) = link.agentic {
            return agentic;
        }
        cursor = link.parent.as_deref().and_then(|parent| links.get(parent));
    }
    false
}

/// The Tasks the lock blocks on `load`: every one that reads as Agentic and is not Done.
pub fn blocked_tasks(load: &MindmapLoad) -> Vec<NodeId> {
    let links = links(load);
    load.tasks
        .iter()
        .filter(|task| task.status != "done")
        .filter(|task| reads_agentic(&links, &format!("task-{}", task.id)))
        .map(|task| task.id.clone())
        .collect()
}

/// Adds the lock's block to `load` when `at_capacity`: one derived reason per Task it blocks,
/// after the Task's own. Nothing, when the lock is off.
pub fn apply(load: &mut MindmapLoad, at_capacity: bool) {
    if !at_capacity {
        return;
    }
    for id in blocked_tasks(load) {
        // After the Task's own reasons, numbered on from them.
        let own = load
            .block_reasons
            .iter()
            .filter(|reason| reason.owner_type == "task" && reason.owner_id == id)
            .count();
        load.block_reasons.push(BlockReason {
            owner_type: "task".to_string(),
            owner_id: id,
            reason: AGENT_CAPACITY_REASON.to_string(),
            position: i64::try_from(own).unwrap_or(i64::MAX),
            derived: Some(DerivedBlock::AgentCapacity),
        });
    }
}
