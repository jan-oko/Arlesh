//! **Derived block**: a Compound Task is blocked when every one of its open counted items is.
//!
//! An item is **open** when it does not read as Done by the [progress rule](super::progress). An
//! open Task or Goal is **blocked** by the board's ordinary rule — a block reason, or a dependency
//! on a Task not done, a Goal not achieved or a wait still pending — and a Compound Task inside
//! also by its own derived block, worked out first. A pending wait or an Unresolved Commitment is
//! open but has no blocked state, so one of them keeps the Compound unblocked. With no open item
//! at all — everything Done, or nothing counted — there is nothing to be blocked by.
//!
//! The block is served as a **derived block reason** ([`DerivedBlock::Compound`]) beside the
//! stored ones, so everything that already reads "blocked" — the stop sign, Start, Unblock, a
//! dependent waiting, the MCP — reads it too. It runs once the board's statuses are final, so an
//! open item's status and every dependency's are the derived ones.

use std::collections::{HashMap, HashSet};

use crate::{
    block_reasons::model::{BlockReason, DerivedBlock},
    nodes::id::NodeId,
    tasks::model::{ExpectationStatus, TaskDependencyEdge, TaskStatus},
};

use super::{Key, Kind, Rows, Tree};

#[cfg(test)]
mod tests;

/// The words a derived block reads with on the wire. The frontend draws its own translation.
pub const REASON: &str = "All open sub-items are blocked";

/// A derived block reason for every Compound Task in `rows` whose open counted items are all
/// blocked, read against the board's `block_reasons` and dependency `edges`.
pub fn derive(
    rows: &Rows<'_>,
    block_reasons: &[BlockReason],
    edges: &[TaskDependencyEdge],
) -> Vec<BlockReason> {
    let compounds: Vec<&NodeId> = rows
        .tasks
        .iter()
        .chain(rows.checks)
        .filter(|task| task.compound)
        .map(|task| &task.id)
        .collect();
    if compounds.is_empty() {
        return Vec::new();
    }
    let tree = Tree::of(rows);
    let mut evaluation = Evaluation {
        tree: &tree,
        direct: directly_blocked(rows, block_reasons, edges),
        resolved: HashMap::new(),
        visiting: HashSet::new(),
    };
    compounds
        .into_iter()
        .filter(|id| evaluation.blocked(id))
        .map(|id| BlockReason {
            owner_type: "task".to_string(),
            owner_id: id.clone(),
            reason: REASON.to_string(),
            position: i64::MAX,
            derived: Some(DerivedBlock::Compound),
            until: None,
        })
        .collect()
}

/// The Tasks and Goals blocked by the board's ordinary rule: a block reason of any kind, or a
/// dependency on a Task not done, a Goal not achieved or a wait still pending. The same rule the
/// filters read (`filters::facts`) and the frontend draws.
fn directly_blocked(
    rows: &Rows<'_>,
    block_reasons: &[BlockReason],
    edges: &[TaskDependencyEdge],
) -> HashSet<Key> {
    let mut blocked: HashSet<Key> = block_reasons
        .iter()
        .filter_map(|reason| {
            let kind = match reason.owner_type.as_str() {
                "task" => Kind::Task,
                "goal" => Kind::Goal,
                _ => return None,
            };
            Some((kind, reason.owner_id.clone()))
        })
        .collect();
    let task_done: HashMap<&NodeId, bool> = rows
        .tasks
        .iter()
        .chain(rows.checks)
        .map(|task| (&task.id, task.status.is_done()))
        .collect();
    let goal_status: HashMap<&NodeId, &str> = rows
        .goals
        .iter()
        .map(|goal| (&goal.id, goal.status.as_str()))
        .collect();
    let wait_status: HashMap<&NodeId, ExpectationStatus> = rows
        .expectations
        .iter()
        .chain(rows.waits)
        .map(|wait| (&wait.id, wait.status))
        .collect();
    for edge in edges {
        let unmet = match edge.dependency_type.as_str() {
            "task" => task_done
                .get(&edge.dependency_id)
                .is_some_and(|done| !*done),
            "expectation" => wait_status
                .get(&edge.dependency_id)
                .is_some_and(|status| *status == ExpectationStatus::Pending),
            _ => goal_status
                .get(&edge.dependency_id)
                .is_some_and(|status| *status != "achieved"),
        };
        if unmet {
            blocked.insert((Kind::Task, edge.task_id.clone()));
        }
    }
    blocked
}

/// One pass over a [`Tree`], remembering each Compound Task's derived block once worked out.
struct Evaluation<'tree> {
    tree: &'tree Tree,
    direct: HashSet<Key>,
    resolved: HashMap<NodeId, bool>,
    /// The Compound Tasks being worked out right now, so a corrupt parent loop ends.
    visiting: HashSet<NodeId>,
}

impl Evaluation<'_> {
    /// Whether the Compound Task `id` is derived blocked: it has an open item, and every open item
    /// is blocked.
    fn blocked(&mut self, id: &NodeId) -> bool {
        if let Some(blocked) = self.resolved.get(id) {
            return *blocked;
        }
        if !self.visiting.insert(id.clone()) {
            return false;
        }
        let top = (Kind::Task, id.clone());
        let mut walked = HashSet::from([top.clone()]);
        let mut open = Open::default();
        self.scan(&top, id, &mut open, &mut walked);
        let blocked = open.any && open.all_blocked;
        self.visiting.remove(id);
        self.resolved.insert(id.clone(), blocked);
        blocked
    }

    /// Reads every counted item beneath `parent` into `open`, for the Compound Task `root` — the
    /// same items, left out on the same terms, as its status counts.
    fn scan(&mut self, parent: &Key, root: &NodeId, open: &mut Open, walked: &mut HashSet<Key>) {
        let tree = self.tree;
        let Some(children) = tree.children.get(parent) else {
            return;
        };
        for child in children {
            if !walked.insert(child.clone()) {
                continue;
            }
            let Some(item) = tree.items.get(child) else {
                continue;
            };
            if item.drawn_by.as_ref() == Some(root) {
                continue;
            }
            let done = item.reading == TaskStatus::Done;
            if item.archived && !done {
                continue;
            }
            if !done {
                let blocked = self.item_blocked(child, item.compound);
                open.count(blocked);
            }
            self.scan(child, root, open, walked);
        }
    }

    /// Whether an open item is blocked: a Task or Goal by the ordinary rule, a Compound Task also
    /// by its own derived block. A wait or a Commitment never is.
    fn item_blocked(&mut self, key: &Key, compound: bool) -> bool {
        match key.0 {
            Kind::Task | Kind::Goal if self.direct.contains(key) => true,
            Kind::Task if compound => self.blocked(&key.1),
            _ => false,
        }
    }
}

/// What a scan has found among the open items.
#[derive(Debug, Clone, Copy)]
struct Open {
    any: bool,
    all_blocked: bool,
}

impl Default for Open {
    fn default() -> Self {
        Self {
            any: false,
            all_blocked: true,
        }
    }
}

impl Open {
    fn count(&mut self, blocked: bool) {
        self.any = true;
        self.all_blocked &= blocked;
    }
}
