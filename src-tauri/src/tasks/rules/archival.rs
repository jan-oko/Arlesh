//! **The hand archive, inherited**: a Task or Commitment archived by hand archives everything
//! beneath it (Task 269, ruled by the user 2026-10-03).
//!
//! Archiving writes the one row: its stored Archival becomes `archived`. Nothing below it is
//! written, so unarchiving puts it back to Live and its subtree returns exactly as it was. What
//! the subtree reads is derived here, on every board load, the way a backlogged Task hides its
//! subtree: every descendant — Tasks, Goals, Commitments, waits and a wait's check tasks, stored
//! or derived — reads as effectively **Archived**, and so is never Overdue.
//!
//! It runs once every other lifecycle is in (scope lifecycles, Habit occurrences, waits and the
//! compound statuses), so nothing later re-derives a descendant's Archival over it.

use std::collections::{HashMap, HashSet};

use crate::nodes::id::NodeId;
use crate::tasks::lifecycle::{Archival, ItemLifecycle, Timing};

/// One node of the board's content tree, as the inheritance reads it.
#[derive(Debug, Clone, Copy)]
pub struct TreeNode<'rows> {
    /// The kind its lifecycle is keyed under, and its children name as their `parent_type`:
    /// `"task"`, `"goal"`, `"commitment"` or `"expectation"`.
    pub node_type: &'rows str,
    /// Its id.
    pub id: &'rows NodeId,
    /// Its parent's kind.
    pub parent_type: &'rows str,
    /// Its parent's id.
    pub parent_id: &'rows NodeId,
    /// Whether it was archived by hand — a stored Task's or Commitment's own archive.
    pub archived_by_hand: bool,
}

/// Archives every descendant of a node archived by hand, in `lifecycles`.
///
/// Each descendant's entries are set Archived and cleared of Overdue. One with no entry at all —
/// a delegated Task's wait sends none — gains one, Active, since nothing about its window is known
/// beyond what it already read as. A hand-archived node's own entry is already Archived: its
/// stored archive says so.
pub fn inherit(nodes: &[TreeNode<'_>], lifecycles: &mut Vec<ItemLifecycle>) {
    let beneath = descendants_of_hand_archived(nodes);
    if beneath.is_empty() {
        return;
    }
    for entry in lifecycles.iter_mut() {
        if beneath.contains(&(entry.node_type.as_str(), &entry.node_id)) {
            entry.archival = Archival::Archived;
            entry.overdue = false;
        }
    }
    let reached: HashSet<(&str, &NodeId)> = lifecycles
        .iter()
        .map(|entry| (entry.node_type.as_str(), &entry.node_id))
        .collect();
    let missing: Vec<ItemLifecycle> = beneath
        .iter()
        .filter(|key| !reached.contains(*key))
        .map(|(node_type, id)| archived_entry(node_type, id))
        .collect();
    lifecycles.extend(missing);
}

/// The `(node_type, id)` of every node beneath one archived by hand — not the archived node
/// itself, unless it also sits beneath another.
fn descendants_of_hand_archived<'rows>(
    nodes: &[TreeNode<'rows>],
) -> HashSet<(&'rows str, &'rows NodeId)> {
    let mut children: HashMap<(&str, &NodeId), Vec<(&str, &NodeId)>> = HashMap::new();
    for node in nodes {
        children
            .entry((node.parent_type, node.parent_id))
            .or_default()
            .push((node.node_type, node.id));
    }
    let mut beneath = HashSet::new();
    let mut frontier: Vec<(&str, &NodeId)> = nodes
        .iter()
        .filter(|node| node.archived_by_hand)
        .map(|node| (node.node_type, node.id))
        .collect();
    while let Some(parent) = frontier.pop() {
        for child in children.get(&parent).into_iter().flatten() {
            // `insert` refusing a node already reached is what ends a corrupt parent loop.
            if beneath.insert(*child) {
                frontier.push(*child);
            }
        }
    }
    beneath
}

/// The entry a node with none gains when an ancestor's hand archive reaches it.
fn archived_entry(node_type: &str, id: &NodeId) -> ItemLifecycle {
    ItemLifecycle {
        node_type: node_type.to_string(),
        node_id: id.clone(),
        timing: Timing::Active,
        resolution: None,
        overdue: false,
        verdict: None,
        archival: Archival::Archived,
        archival_conflict: false,
        plan_timing: None,
    }
}

#[cfg(test)]
mod tests;
