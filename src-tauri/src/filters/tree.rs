//! Pruning a tree of facts the way the Mindmap prunes its nodes.
//!
//! A node is kept when it matches the filter **or** has a kept *content* descendant, which is what
//! keeps the map connected: a match deep in a branch brings its ancestors along. Info nodes are
//! attachments — they ride along with a kept node but never keep one, so an achieved Goal whose
//! only children are notes is still hidden.
//!
//! The **focus exemption** is deliberately absent. It is a render-time overlay on top of the
//! filter's own answer, keyed on what the user has selected, and `docs/spec/filtering-logic.md`
//! is explicit that it changes neither the filter's definition nor its answers: "anything that
//! counts, filters or exports off the filter sees exactly what it saw before". So it belongs to
//! the view, not here.

use std::collections::BTreeSet;

use crate::tasks::{lifecycle::Timing, model::TimeScope};

use super::{
    model::{BoardFilter, NodeFacts, NodeKind},
    rules::{self, UNSET_STATUS},
};

/// One node of a fact tree: what the filter reads, plus its children.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct FactNode {
    /// What the filter reads off this node.
    #[serde(flatten)]
    pub facts: NodeFacts,
    /// The node's children, in the order the board draws them.
    #[serde(default)]
    pub children: Vec<FactNode>,
}

impl FactNode {
    /// A childless node.
    pub fn leaf(facts: NodeFacts) -> Self {
        Self {
            facts,
            children: Vec::new(),
        }
    }

    /// A node with children.
    pub fn with_children(facts: NodeFacts, children: Vec<FactNode>) -> Self {
        Self { facts, children }
    }
}

/// Prunes `root` to the active filter, or `None` when nothing in it survives.
///
/// The honest answer, which [`prune_tree`] then softens for the one caller — the Mindmap's
/// synthetic root — that needs a container to render into whatever the filter says.
pub fn prune(root: &FactNode, filter: &BoardFilter) -> Option<FactNode> {
    prune_at(
        root,
        filter,
        Inherited {
            status: UNSET_STATUS,
            under_backlog: false,
            plan: None,
            time_scope: None,
        },
    )
}

/// Prunes `root`, returning it as a container even when nothing in it survived.
///
/// Mirrors the frontend's `filterTree`: the canvas always has a root to draw into.
pub fn prune_tree(root: &FactNode, filter: &BoardFilter) -> FactNode {
    prune(root, filter).unwrap_or_else(|| FactNode::leaf(root.facts.clone()))
}

/// Prunes each root of a forest, dropping the ones nothing survived in.
///
/// What a board read outside the Mindmap wants: there is no synthetic root over the Aspects, and
/// an Aspect the filter emptied should not come back as an empty shell.
pub fn prune_forest(roots: &[FactNode], filter: &BoardFilter) -> Vec<FactNode> {
    roots
        .iter()
        .filter_map(|root| prune(root, filter))
        .collect()
}

/// Every id in `tree`, itself included.
pub fn kept_ids(tree: &FactNode) -> BTreeSet<String> {
    let mut ids = BTreeSet::new();
    collect_ids(tree, &mut ids);
    ids
}

/// Every id across a forest.
pub fn kept_ids_in_forest(forest: &[FactNode]) -> BTreeSet<String> {
    let mut ids = BTreeSet::new();
    for tree in forest {
        collect_ids(tree, &mut ids);
    }
    ids
}

fn collect_ids(node: &FactNode, ids: &mut BTreeSet<String>) {
    ids.insert(node.facts.id.clone());
    for child in &node.children {
        collect_ids(child, ids);
    }
}

/// What the walk carries down from a node's ancestors.
#[derive(Clone, Copy)]
struct Inherited<'a> {
    /// The nearest status-bearing container's status.
    status: &'a str,
    /// Whether some ancestor is a backlogged Task.
    under_backlog: bool,
    /// The nearest planned ancestor's Plan position, for Start.
    plan: Option<Timing>,
    /// The nearest scoped ancestor's Time Scope, for the Plan preset's scope narrowing.
    time_scope: Option<&'a TimeScope>,
}

fn prune_at(node: &FactNode, filter: &BoardFilter, inherited: Inherited<'_>) -> Option<FactNode> {
    let Inherited {
        status: inherited_status,
        under_backlog,
        plan: inherited_plan,
        time_scope: inherited_time_scope,
    } = inherited;
    if rules::type_hard_hidden(&node.facts, filter) {
        return None;
    }
    // Only a container passes a status down. A Goal or Task always carries its own, and no
    // container ever sits beneath one, so their statuses must not leak into the chain.
    let inherited_for_children = if node.facts.kind.is_structural() {
        node.facts.status.as_deref().unwrap_or(inherited_status)
    } else {
        inherited_status
    };
    // Backlog, unlike status, does propagate: everything under a set-aside Task is set aside too.
    let backlog_for_children = under_backlog || node.facts.backlogged;
    // So, for Start, does a Plan: an unplanned sub-step is read by its nearest planned ancestor's.
    // A wait cuts the chain: the check task beneath it has no Plan, answers to its own due time,
    // and must not vanish because the Task the wait hangs under is planned for next week.
    let plan_for_children = if node.facts.kind == NodeKind::Expectation {
        None
    } else {
        node.facts.plan_timing.or(inherited_plan)
    };

    // A Time Scope is inherited from the nearest scoped ancestor, as it is everywhere else.
    let time_scope_for_children = node.facts.time_scope.as_ref().or(inherited_time_scope);

    let mut children = Vec::new();
    let mut has_content_match = false;
    for child in &node.children {
        let Some(pruned) = prune_at(
            child,
            filter,
            Inherited {
                status: inherited_for_children,
                under_backlog: backlog_for_children,
                plan: plan_for_children,
                time_scope: time_scope_for_children,
            },
        ) else {
            continue;
        };
        if child.facts.kind != NodeKind::Info {
            has_content_match = true;
        }
        children.push(pruned);
    }

    // An Info node is carried by its parent's decision; whether it is visible at all was already
    // settled by the hard-hide above.
    if node.facts.kind == NodeKind::Info {
        return Some(FactNode::with_children(node.facts.clone(), children));
    }
    if has_content_match
        || (rules::self_matches(&node.facts, filter, inherited_status, under_backlog)
            && !rules::is_planned_ahead(&node.facts, filter, inherited_plan)
            && !rules::is_outside_plan_scope(&node.facts, filter, inherited_time_scope))
    {
        return Some(FactNode::with_children(node.facts.clone(), children));
    }
    None
}

#[cfg(test)]
mod tests;
