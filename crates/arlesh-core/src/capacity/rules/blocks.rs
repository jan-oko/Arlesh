//! Agent capacity as a **derived block**: an Agentic Task not yet Done inside the Claim of an agent
//! at capacity is blocked, by a reason no one wrote and no one can remove but by the agent leaving
//! capacity (its lock cleared, or its account's limit resetting).
//!
//! This is the one derivation. The board load runs it ([`crate::mindmap::load_blocked`]) and adds
//! the reasons to the load's own `block_reasons` — before a Compound Task's own derived block reads
//! them, so a Compound whose open items the lock blocks is blocked too — marked [`DerivedBlock::AgentCapacity`], so everything that already reads
//! block reasons — the filters' `is_blocked` (Start, Unblock), the snapshot's `block_reasons`
//! section, `arlesh_tasks.get`, the app's blocked glyph and its refusal to start a blocked Task —
//! takes the lock from here without learning it exists.

use std::collections::HashMap;

use crate::{
    access::model::NodeKey,
    block_reasons::model::{BlockReason, DerivedBlock},
    domains::model::Domain,
    mindmap::model::MindmapLoad,
    nodes::id::NodeId,
    tasks::model::{Commitment, Expectation, Goal, Task},
};

#[cfg(test)]
mod tests;

/// The reason's text, for a reader that has no words of its own for it — an agent. The app draws
/// its own, translated, off [`DerivedBlock::AgentCapacity`].
pub const AGENT_CAPACITY_REASON: &str = "Agents at capacity";

/// What the capacity blocks cover: the subtrees of the agents that are at capacity (each agent's
/// Claim).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Blocking {
    /// Roots whose subtrees' Agentic Tasks not yet Done are blocked: the Claims of agents at
    /// capacity.
    pub subtrees: Vec<NodeKey>,
}

impl Blocking {
    /// Whether nothing is blocked.
    pub fn is_none(&self) -> bool {
        self.subtrees.is_empty()
    }

    /// The keys of the subtree roots, spelled as the load's keys are (`task-12`, `domain-1`).
    fn subtree_keys(&self) -> std::collections::HashSet<Key> {
        self.subtrees
            .iter()
            .map(|root| format!("{}-{}", root.node_kind.as_str(), root.node_id))
            .collect()
    }
}

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

/// The board rows the derivation reads: every kind a Task can hang under, and the Tasks.
#[derive(Clone, Copy)]
pub struct Rows<'board> {
    /// Aspects, Projects, Domains and Tags.
    pub domains: &'board [Domain],
    /// Goals, stored and derived.
    pub goals: &'board [Goal],
    /// Tasks, stored and derived.
    pub tasks: &'board [Task],
    /// Commitments, stored and derived.
    pub commitments: &'board [Commitment],
    /// Expectations, stored and derived.
    pub expectations: &'board [Expectation],
}

impl<'board> Rows<'board> {
    /// The rows of a whole board load.
    pub fn of(load: &'board MindmapLoad) -> Self {
        Self {
            domains: &load.domains,
            goals: &load.goals,
            tasks: &load.tasks,
            commitments: &load.commitments,
            expectations: &load.expectations,
        }
    }
}

/// Every node that can sit above a Task, with its parent and — for a Task — its own flag.
fn links(rows: Rows<'_>) -> HashMap<Key, Link> {
    let mut links = HashMap::new();
    for domain in rows.domains {
        let parent = domain.parent_id.map(|id| format!("domain-{id}"));
        links.insert(
            format!("domain-{}", domain.id),
            Link {
                parent,
                agentic: None,
            },
        );
    }
    let content = rows
        .goals
        .iter()
        .map(|goal| ("goal", &goal.id, &goal.parent_type, &goal.parent_id, None))
        .chain(rows.tasks.iter().map(|task| {
            let parent = (&task.parent_type, &task.parent_id);
            ("task", &task.id, parent.0, parent.1, task.agentic)
        }))
        .chain(rows.commitments.iter().map(|commitment| {
            let parent = (&commitment.parent_type, &commitment.parent_id);
            ("commitment", &commitment.id, parent.0, parent.1, None)
        }))
        .chain(rows.expectations.iter().map(|expectation| {
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

/// Whether the node at `key` is at or below one of `roots`.
fn within(links: &HashMap<Key, Link>, key: &str, roots: &std::collections::HashSet<Key>) -> bool {
    let mut cursor = Some(key);
    // A parent chain is a tree; the bound only stops a corrupt board from looping forever.
    for _ in 0..=links.len() {
        let Some(current) = cursor else {
            return false;
        };
        if roots.contains(current) {
            return true;
        }
        cursor = links.get(current).and_then(|link| link.parent.as_deref());
    }
    false
}

/// The Tasks the capacity blocks cover among `rows`: every one that reads as Agentic and is not
/// Done, and lies inside the Claim of an agent at capacity.
pub fn blocked_tasks(rows: Rows<'_>, blocking: &Blocking) -> Vec<NodeId> {
    if blocking.is_none() {
        return Vec::new();
    }
    let links = links(rows);
    let roots = blocking.subtree_keys();
    rows.tasks
        .iter()
        .filter(|task| !task.status.is_done())
        .filter(|task| reads_agentic(&links, &format!("task-{}", task.id)))
        .filter(|task| within(&links, &format!("task-{}", task.id), &roots))
        .map(|task| task.id.clone())
        .collect()
}

/// The lock's block: one derived reason per Task it blocks among `rows`, numbered on after the
/// Task's own reasons in `existing`. The board load adds these before anything else reads
/// "blocked" — a Compound Task's own derived block included.
pub fn derive(rows: Rows<'_>, existing: &[BlockReason], blocking: &Blocking) -> Vec<BlockReason> {
    blocked_tasks(rows, blocking)
        .into_iter()
        .map(|id| {
            let own = existing
                .iter()
                .filter(|reason| reason.owner_type == "task" && reason.owner_id == id)
                .count();
            BlockReason {
                owner_type: "task".to_string(),
                owner_id: id,
                reason: AGENT_CAPACITY_REASON.to_string(),
                position: i64::try_from(own).unwrap_or(i64::MAX),
                derived: Some(DerivedBlock::AgentCapacity),
                until: None,
            }
        })
        .collect()
}

/// Adds the capacity blocks to a finished `load`. Nothing, when nothing is blocked.
/// The board load itself derives them through [`derive`]; this is for a load already in hand.
pub fn apply(load: &mut MindmapLoad, blocking: &Blocking) {
    if blocking.is_none() {
        return;
    }
    let reasons = derive(Rows::of(load), &load.block_reasons, blocking);
    load.block_reasons.extend(reasons);
}
