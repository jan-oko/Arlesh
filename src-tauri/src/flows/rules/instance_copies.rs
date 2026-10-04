//! Which started-instance links a subtree copy carries over: a copied node that a Flow
//! materialised still reads "from flow X" — the **original** Flow — after it is copied.
//!
//! A started Flow writes a `flow_instances` row for the run and a `flow_instance_nodes` row for
//! each node it materialised. Those rows are the only thing that says where a node came from, so
//! a copy without them would be a plain Goal or Task with no origin. [`copied_instances`] plans
//! the rows the copy needs: one instance per run that the copy reached, holding one node row per
//! copied node. The plan is pure; `flows::copy_instance_links` gathers the rows and writes it.

use super::targets::CopiedNodes;
use crate::flows::model::TargetRef;

/// One node a started Flow materialised, as its `flow_instance_nodes` and `flow_instances` rows
/// describe it together.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstanceNode {
    /// The run's `flow_instances` id.
    pub instance_id: i64,
    /// The Flow the run was started from; `None` once that Flow is deleted.
    pub flow_id: Option<i64>,
    /// The run's root node.
    pub root: TargetRef,
    /// When the run was started.
    pub started_at: i64,
    /// The materialised node.
    pub node: TargetRef,
    /// The template item it came from (`flow`, `flow_goal` or `flow_task`).
    pub source: TargetRef,
    /// The parent it was created under.
    pub original_parent: TargetRef,
}

/// One run's links, rewritten for the copy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstanceCopy {
    /// The **original** Flow, so the copies read "from flow X" exactly as the originals do.
    pub flow_id: Option<i64>,
    /// The copy of the run's root, or — when the root itself was not copied — the copy of the
    /// first of the run's nodes that was.
    pub root: TargetRef,
    /// The original run's start, unchanged: the copies were materialised by that run.
    pub started_at: i64,
    /// One row per copied node, in the original rows' order.
    pub nodes: Vec<InstanceNodeCopy>,
}

/// One copied node's link.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstanceNodeCopy {
    /// The copy.
    pub node: TargetRef,
    /// The template item the original came from, unchanged.
    pub source: TargetRef,
    /// The parent it was created under — the copy of that parent when the copy carried it, so a
    /// copied node that was never moved does not read as moved.
    pub original_parent: TargetRef,
}

/// The instance links a copy needs: every run with at least one node the copy carried, holding a
/// row for each such node. Runs come in the order their first copied node appears in `rows`.
pub fn copied_instances(rows: &[InstanceNode], copies: &CopiedNodes) -> Vec<InstanceCopy> {
    let mut runs: Vec<(i64, InstanceCopy)> = Vec::new();
    for row in rows {
        let Some(node) = copy_of(&row.node, copies) else {
            continue;
        };
        let link = InstanceNodeCopy {
            node: node.clone(),
            source: row.source.clone(),
            original_parent: copy_of(&row.original_parent, copies)
                .unwrap_or_else(|| row.original_parent.clone()),
        };
        if let Some((_, run)) = runs.iter_mut().find(|(id, _)| *id == row.instance_id) {
            run.nodes.push(link);
            continue;
        }
        runs.push((
            row.instance_id,
            InstanceCopy {
                flow_id: row.flow_id,
                root: copy_of(&row.root, copies).unwrap_or(node),
                started_at: row.started_at,
                nodes: vec![link],
            },
        ));
    }
    runs.into_iter().map(|(_, run)| run).collect()
}

/// The copy of a referenced node, under the same type spelling, if the copy carried it.
fn copy_of(reference: &TargetRef, copies: &CopiedNodes) -> Option<TargetRef> {
    copies
        .copy_of(&reference.node_type, reference.node_id)
        .map(|node_id| TargetRef {
            node_type: reference.node_type.clone(),
            node_id,
        })
}

#[cfg(test)]
mod tests;
