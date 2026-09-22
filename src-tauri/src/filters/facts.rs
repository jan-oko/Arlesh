//! Turning a [`MindmapLoad`] into the fact forest the rules read.
//!
//! The load is a bag of rows; the filter needs a tree. This assembles one from the rows' own
//! `(parent_type, parent_id)` links, using the same node-id spelling the frontend does — the four
//! domains-table subtypes share one `domain-<id>` namespace, and goals, tasks, commitments and
//! infos keep their own.
//!
//! # What it covers
//!
//! The real nodes: Aspects, Projects, Domains, Tags, Goals, Tasks, Commitments and Infos. Flows
//! and their items are deliberately left out. A Flow's subtree is assembled in the frontend from
//! the flow, item, cycle and habit-iteration rows, and a Habit's occurrences are derived there and
//! exist as no row at all — so there is nothing here for a Flow rule to be applied *to*, and
//! pretending otherwise would mean a second, thinner definition of what a Flow node is. A filtered
//! read therefore narrows the real-node sections and passes the flow sections through whole.

use std::collections::{HashMap, HashSet};

use crate::{
    mindmap::model::MindmapLoad,
    tasks::{
        lifecycle::{Archival, ItemLifecycle},
        model::TaskArchival,
    },
};

use super::{
    model::{BoardFilter, NodeFacts, NodeKind},
    tree::{self, FactNode},
};

/// The tree-node id for a domains-table row.
fn domain_id(id: i64) -> String {
    format!("domain-{id}")
}

/// The tree-node id a content row's `(parent_type, parent_id)` pair names.
///
/// The content tables spell their parent `goal`, `task`, `commitment`, `info`, or one of the four
/// domains-table subtypes — which all share the single `domain-` namespace.
fn content_parent_id(parent_type: &str, parent_id: i64) -> String {
    match parent_type {
        "goal" | "task" | "commitment" | "info" => format!("{parent_type}-{parent_id}"),
        _ => domain_id(parent_id),
    }
}

/// The kind a domains-table `subtype` column names. An unrecognised spelling reads as a plain
/// Domain, which is what the frontend makes of one too.
fn domain_kind(subtype: &str) -> NodeKind {
    match subtype {
        "aspect" => NodeKind::Aspect,
        "project" => NodeKind::Project,
        "tag" => NodeKind::Tag,
        _ => NodeKind::Domain,
    }
}

/// Each item's derived lifecycle, keyed by the `(node_type, node_id)` pair the load sends it under.
fn index_lifecycles(load: &MindmapLoad) -> HashMap<(&str, i64), &ItemLifecycle> {
    load.lifecycles
        .iter()
        .map(|lifecycle| {
            (
                (lifecycle.node_type.as_str(), lifecycle.node_id),
                lifecycle,
            )
        })
        .collect()
}

/// The node ids that are blocked: by an explicit block reason, or by a dependency on a Task that
/// is not done or a Goal that is not achieved.
///
/// The second half mirrors the frontend's "virtual blockers", which it derives from the same bulk
/// dependency edges — a dependency on something already finished does not block.
fn index_blocked(load: &MindmapLoad) -> HashSet<String> {
    let mut blocked: HashSet<String> = load
        .block_reasons
        .iter()
        .map(|reason| format!("{}-{}", reason.owner_type, reason.owner_id))
        .collect();

    let task_status: HashMap<i64, &str> = load
        .tasks
        .iter()
        .map(|task| (task.id, task.status.as_str()))
        .collect();
    let goal_status: HashMap<i64, &str> = load
        .goals
        .iter()
        .map(|goal| (goal.id, goal.status.as_str()))
        .collect();

    for edge in &load.task_dependencies {
        let unmet = if edge.dependency_type == "task" {
            task_status
                .get(&edge.dependency_id)
                .is_some_and(|status| *status != "done")
        } else {
            goal_status
                .get(&edge.dependency_id)
                .is_some_and(|status| *status != "achieved")
        };
        if unmet {
            blocked.insert(format!("task-{}", edge.task_id));
        }
    }
    blocked
}

/// The node ids with at least one direct child Task whose status is `todo` — what decides whether
/// an in-progress Task still has something under it to start.
fn index_todo_parents(load: &MindmapLoad) -> HashSet<String> {
    load.tasks
        .iter()
        .filter(|task| task.status == "todo")
        .map(|task| content_parent_id(&task.parent_type, task.parent_id))
        .collect()
}

/// Builds the fact forest for `load`: one tree per Aspect, in the order the load lists them.
///
/// A row whose parent is not on the board is dropped rather than promoted to a root. An orphan is
/// a database inconsistency, and giving it a place on the board would hide that.
pub fn forest(load: &MindmapLoad) -> Vec<FactNode> {
    let lifecycles = index_lifecycles(load);
    let blocked = index_blocked(load);
    let todo_parents = index_todo_parents(load);

    let mut facts: Vec<NodeFacts> = Vec::new();
    let mut parents: Vec<Option<String>> = Vec::new();

    for domain in &load.domains {
        let mut node = NodeFacts::new(domain_id(domain.id), domain_kind(&domain.subtype));
        node.status.clone_from(&domain.status);
        node.is_private = domain.is_private;
        facts.push(node);
        parents.push(domain.parent_id.map(domain_id));
    }
    for goal in &load.goals {
        let mut node = NodeFacts::new(format!("goal-{}", goal.id), NodeKind::Goal);
        node.status = Some(goal.status.clone());
        node.is_private = goal.is_private;
        node.tag_ids.clone_from(&goal.tag_ids);
        node.is_blocked = blocked.contains(&node.id);
        apply_lifecycle(&mut node, lifecycles.get(&("goal", goal.id)).copied());
        facts.push(node);
        parents.push(Some(content_parent_id(&goal.parent_type, goal.parent_id)));
    }
    for task in &load.tasks {
        let mut node = NodeFacts::new(format!("task-{}", task.id), NodeKind::Task);
        node.status = Some(task.status.clone());
        node.is_private = task.is_private;
        node.backlogged = task.archival == TaskArchival::Backlog;
        node.tag_ids.clone_from(&task.tag_ids);
        node.is_blocked = blocked.contains(&node.id);
        node.has_todo_child = todo_parents.contains(&node.id);
        apply_lifecycle(&mut node, lifecycles.get(&("task", task.id)).copied());
        facts.push(node);
        parents.push(Some(content_parent_id(&task.parent_type, task.parent_id)));
    }
    for commitment in &load.commitments {
        let mut node = NodeFacts::new(
            format!("commitment-{}", commitment.id),
            NodeKind::Commitment,
        );
        node.is_private = commitment.is_private;
        node.verdict = Some(commitment.verdict);
        node.tag_ids.clone_from(&commitment.tag_ids);
        apply_lifecycle(
            &mut node,
            lifecycles.get(&("commitment", commitment.id)).copied(),
        );
        facts.push(node);
        parents.push(Some(content_parent_id(
            &commitment.parent_type,
            commitment.parent_id,
        )));
    }
    for info in &load.infos {
        let mut node = NodeFacts::new(format!("info-{}", info.id), NodeKind::Info);
        node.is_private = info.is_private;
        facts.push(node);
        parents.push(Some(content_parent_id(&info.parent_type, info.parent_id)));
    }

    assemble(&facts, &parents)
}

/// Narrows `load` in place to the nodes `filter` keeps.
///
/// The real-node sections — domains, goals, tasks, commitments and infos — are cut to what the
/// filter kept, and the sections derived from them — lifecycles, block reasons and task
/// dependencies — are cut to match, so nothing in the payload refers to a node the payload no
/// longer carries. The flow sections pass through whole; see this module's own documentation for
/// why a Flow is not something this can judge.
pub fn narrow(load: &mut MindmapLoad, filter: &BoardFilter) {
    let kept = tree::kept_ids_in_forest(&tree::prune_forest(&forest(load), filter));
    let keeps = |id: &str| kept.contains(id);

    load.domains.retain(|domain| keeps(&domain_id(domain.id)));
    load.goals.retain(|goal| keeps(&format!("goal-{}", goal.id)));
    load.tasks.retain(|task| keeps(&format!("task-{}", task.id)));
    load.commitments
        .retain(|commitment| keeps(&format!("commitment-{}", commitment.id)));
    load.infos.retain(|info| keeps(&format!("info-{}", info.id)));

    load.lifecycles
        .retain(|lifecycle| keeps(&format!("{}-{}", lifecycle.node_type, lifecycle.node_id)));
    load.block_reasons
        .retain(|reason| keeps(&format!("{}-{}", reason.owner_type, reason.owner_id)));
    load.task_dependencies
        .retain(|edge| keeps(&format!("task-{}", edge.task_id)));
}

/// Copies the two derived facts a filter reads off a lifecycle. An item with no lifecycle — an
/// unscoped one the derivation skipped — keeps its neutral values.
fn apply_lifecycle(node: &mut NodeFacts, lifecycle: Option<&ItemLifecycle>) {
    let Some(lifecycle) = lifecycle else {
        return;
    };
    node.timing = Some(lifecycle.timing);
    node.archived = lifecycle.archival == Archival::Archived;
}

/// Links the flat facts into trees by their parent ids, keeping each parent's children in the
/// order the rows arrived.
fn assemble(facts: &[NodeFacts], parents: &[Option<String>]) -> Vec<FactNode> {
    let known: HashSet<&str> = facts.iter().map(|node| node.id.as_str()).collect();
    let mut children_of: HashMap<&str, Vec<usize>> = HashMap::new();
    let mut roots: Vec<usize> = Vec::new();

    for (index, parent) in parents.iter().enumerate() {
        match parent.as_deref() {
            None => roots.push(index),
            Some(parent_id) => {
                if let Some(&known_id) = known.get(parent_id) {
                    children_of.entry(known_id).or_default().push(index);
                }
            }
        }
    }

    roots
        .into_iter()
        .filter_map(|index| build(index, facts, &children_of))
        .collect()
}

fn build(
    index: usize,
    facts: &[NodeFacts],
    children_of: &HashMap<&str, Vec<usize>>,
) -> Option<FactNode> {
    let node = facts.get(index)?.clone();
    let children = children_of
        .get(node.id.as_str())
        .map(|indexes| {
            indexes
                .iter()
                .filter_map(|&child| build(child, facts, children_of))
                .collect()
        })
        .unwrap_or_default();
    Some(FactNode::with_children(node, children))
}

#[cfg(test)]
mod tests;
