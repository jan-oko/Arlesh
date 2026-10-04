//! Which nodes a Flow may target: where its Goal and Task instances may hang.
//!
//! A Flow's instances hang under its Target Node, so a target is a stored node that can hold a
//! Goal or a Task instance — an Aspect, a Domain, a Project, a Goal or a Task. A Tag holds only
//! notes, and a Commitment or a wait is not somewhere a Flow's work is started. Whether a scoped
//! Flow's window also fits the target's is the containment check [`crate::flows::valid_targets`]
//! makes on top of this.
//!
//! It also says where a **copied** Flow's target points ([`copied_target_id`]): a copy of a
//! subtree remaps a target it carried along, as it remaps parent links, and leaves one outside the
//! copy where it was.

use std::collections::HashMap;

use crate::access::model::NodeTable;

/// Whether a stored node of `node_type` can hold a Flow's instances.
pub fn holds_instances(node_type: &str) -> bool {
    matches!(node_type, "aspect" | "domain" | "project" | "goal" | "task")
}

/// The stored nodes one copy carried along: each original, by its table and row id, against the
/// id of the copy made of it.
///
/// Keyed by table rather than by the `parent_type` spelling, because a domains-table row is named
/// `aspect`, `project`, `domain` or `tag` depending on who wrote the reference, and all four must
/// find the same copy.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CopiedNodes {
    copies: HashMap<(NodeTable, i64), i64>,
}

impl CopiedNodes {
    /// Records that `original` in `table` was copied as `copy`.
    pub fn record(&mut self, table: NodeTable, original: i64, copy: i64) {
        self.copies.insert((table, original), copy);
    }

    /// The copy made of the node a reference names, if this copy carried it. `node_type` is
    /// spelled as any reference column spells it.
    pub fn copy_of(&self, node_type: &str, original: i64) -> Option<i64> {
        let table = NodeTable::from_reference(node_type)?;
        self.copies.get(&(table, original)).copied()
    }

    /// Whether the node a reference names was carried by this copy.
    pub fn contains(&self, node_type: &str, original: i64) -> bool {
        self.copy_of(node_type, original).is_some()
    }
}

/// The Target Node id a copied Flow takes, when it differs from the original's: `Some` with the
/// copy's id when the original's target was itself carried by the same copy, and `None` when the
/// copy keeps the stored target unchanged.
///
/// The three cases, as the spec rules them (`docs/spec/flows.md`, *Copying a Flow with its
/// subtree*):
///
/// - a target **inside** the copy is remapped to the copy of it, as a parent link is, so the copied
///   Habit starts its work in the copied subtree;
/// - a target **outside** the copy keeps pointing at the original: it was never part of what was
///   copied, and the copy's work lands where the original's does;
/// - a **NULL** target stays NULL. It means "my parent" and is resolved on read, so it already
///   follows the copy to wherever the copy was put.
///
/// Only the id changes. The stored type spelling stays, since a copy keeps its original's subtype.
pub fn copied_target_id(
    target_type: Option<&str>,
    target_id: Option<i64>,
    copies: &CopiedNodes,
) -> Option<i64> {
    copies.copy_of(target_type?, target_id?)
}

#[cfg(test)]
mod tests;
