//! What the board says about each node beyond its own row — the facts the app draws by and
//! would otherwise work out for itself: which dependencies block a Task, what a node inherits
//! (Agentic, Time Scope), the open question beneath a Task, whether a Commitment has expired, and
//! what the agents are doing on the whole board.
//!
//! Pure: a function of a finished board load. Keyed as the load's `short_ids` are (`task-12`,
//! `expectation-3`).

use std::collections::{HashMap, HashSet};

use crate::{
    access::model::{EffectiveAccess, NodeKey, NodeTable},
    mindmap::model::{AgentActivity, DependencyBlock, MindmapLoad, NodeFacts},
    nodes::id::NodeId,
    tasks::{
        lifecycle::{Archival, ItemLifecycle},
        model::{
            AgenticStatus, Expectation, ExpectationArchival, ExpectationStatus, Status, TimeScope,
            Verdict,
        },
        rules::review::is_open_question,
    },
};

#[cfg(test)]
mod tests;

/// A node on the board, keyed as the app keys it in its tree.
type Key = String;

/// What one node passes down: where it hangs, its own Agentic flag and Time Scope, and — for a
/// stored row — which row it is and its title.
#[derive(Default)]
struct Link {
    parent: Option<Key>,
    agentic: Option<bool>,
    time_scope: Option<TimeScope>,
    stored: Option<NodeKey>,
    title: String,
}

/// The stored row `id` names in `table`, or `None` for a derived row.
fn stored(table: NodeTable, id: &NodeId) -> Option<NodeKey> {
    Some(NodeKey {
        node_kind: table,
        node_id: id.stored()?,
    })
}

/// The key a content row's `(parent_type, parent_id)` names, as the app's tree does: the four
/// domains-table subtypes share one `domain-` namespace.
fn content_parent(parent_type: &str, parent_id: &NodeId) -> Key {
    match parent_type {
        "goal" | "task" | "commitment" | "expectation" | "info" => {
            format!("{parent_type}-{parent_id}")
        }
        _ => format!("domain-{parent_id}"),
    }
}

/// The key a flow item's in-flow parent names: the flow itself, or another item.
fn flow_item_parent(flow_id: i64, parent_type: &str, parent_id: i64) -> Key {
    match parent_type {
        "flow_goal" => format!("flowgoal-{parent_id}"),
        "flow_task" => format!("flowtask-{parent_id}"),
        _ => format!("flow-{flow_id}"),
    }
}

/// Every node the app draws, with what it passes down.
fn links(load: &MindmapLoad) -> HashMap<Key, Link> {
    let mut links = HashMap::new();
    for domain in &load.domains {
        let link = Link {
            parent: domain.parent_id.map(|id| format!("domain-{id}")),
            stored: Some(NodeKey {
                node_kind: NodeTable::Domain,
                node_id: domain.id,
            }),
            title: domain.title.clone(),
            ..Link::default()
        };
        links.insert(format!("domain-{}", domain.id), link);
    }
    for goal in &load.goals {
        let link = Link {
            parent: Some(content_parent(&goal.parent_type, &goal.parent_id)),
            time_scope: goal.time_scope.clone(),
            stored: stored(NodeTable::Goal, &goal.id),
            title: goal.title.clone(),
            ..Link::default()
        };
        links.insert(format!("goal-{}", goal.id), link);
    }
    for task in &load.tasks {
        let link = Link {
            parent: Some(content_parent(&task.parent_type, &task.parent_id)),
            agentic: task.agentic,
            time_scope: task.time_scope.clone(),
            stored: stored(NodeTable::Task, &task.id),
            title: task.title.clone(),
        };
        links.insert(format!("task-{}", task.id), link);
    }
    for commitment in &load.commitments {
        let link = Link {
            parent: Some(content_parent(
                &commitment.parent_type,
                &commitment.parent_id,
            )),
            time_scope: commitment.time_scope.clone(),
            stored: stored(NodeTable::Commitment, &commitment.id),
            title: commitment.title.clone(),
            ..Link::default()
        };
        links.insert(format!("commitment-{}", commitment.id), link);
    }
    for expectation in &load.expectations {
        let link = Link {
            parent: Some(content_parent(
                &expectation.parent_type,
                &expectation.parent_id,
            )),
            time_scope: expectation.time_scope.clone(),
            stored: stored(NodeTable::Expectation, &expectation.id),
            title: expectation.title.clone(),
            ..Link::default()
        };
        links.insert(format!("expectation-{}", expectation.id), link);
    }
    for info in &load.infos {
        let link = Link {
            parent: Some(content_parent(&info.parent_type, &info.parent_id)),
            stored: Some(NodeKey {
                node_kind: NodeTable::Info,
                node_id: info.id,
            }),
            title: info.body.clone(),
            ..Link::default()
        };
        links.insert(format!("info-{}", info.id), link);
    }
    for flow in &load.flows {
        let link = Link {
            parent: Some(match flow.parent_type.as_str() {
                "goal" => format!("goal-{}", flow.parent_id),
                _ => format!("domain-{}", flow.parent_id),
            }),
            stored: Some(NodeKey {
                node_kind: NodeTable::Flow,
                node_id: flow.id,
            }),
            title: flow.title.clone(),
            ..Link::default()
        };
        links.insert(format!("flow-{}", flow.id), link);
    }
    for goal in &load.flow_goals {
        let link = Link {
            parent: Some(flow_item_parent(
                goal.flow_id,
                &goal.parent_type,
                goal.parent_id,
            )),
            stored: Some(NodeKey {
                node_kind: NodeTable::FlowGoal,
                node_id: goal.id,
            }),
            title: goal.title.clone(),
            ..Link::default()
        };
        links.insert(format!("flowgoal-{}", goal.id), link);
    }
    for task in &load.flow_tasks {
        let link = Link {
            parent: Some(flow_item_parent(
                task.flow_id,
                &task.parent_type,
                task.parent_id,
            )),
            stored: Some(NodeKey {
                node_kind: NodeTable::FlowTask,
                node_id: task.id,
            }),
            title: task.title.clone(),
            ..Link::default()
        };
        links.insert(format!("flowtask-{}", task.id), link);
    }
    links
}

/// The nearest value `pick` finds strictly above `key`, climbing parent links. A parent chain is a
/// tree; the bound only stops a corrupt board from looping.
fn inherited<T>(
    links: &HashMap<Key, Link>,
    key: &str,
    pick: impl Fn(&Link) -> Option<T>,
) -> Option<T> {
    let mut cursor = links
        .get(key)?
        .parent
        .as_deref()
        .and_then(|parent| links.get(parent));
    for _ in 0..=links.len() {
        let link = cursor?;
        if let Some(value) = pick(link) {
            return Some(value);
        }
        cursor = link.parent.as_deref().and_then(|parent| links.get(parent));
    }
    None
}

/// Whether a wait reads as archived on the board: its lifecycle's effective Archival, or its own
/// when it sent none.
fn wait_archived(
    wait: &Expectation,
    lifecycles: &HashMap<(&str, &NodeId), &ItemLifecycle>,
) -> bool {
    match lifecycles.get(&("expectation", &wait.id)) {
        Some(lifecycle) => lifecycle.archival == Archival::Archived,
        None => wait.archival == ExpectationArchival::Archived,
    }
}

/// Every node a Task can depend on — Tasks, Goals and waits — by its board key, with its title and
/// whether it is **met**: a Task Done, a Goal Achieved, a wait no longer pending. One rule, read by
/// the blocks below and sent to the app for the editor's live preview.
fn dependency_targets(load: &MindmapLoad) -> HashMap<Key, (&str, bool)> {
    let tasks = load.tasks.iter().map(|task| {
        (
            format!("task-{}", task.id),
            (task.title.as_str(), task.status.is_done()),
        )
    });
    let goals = load.goals.iter().map(|goal| {
        (
            format!("goal-{}", goal.id),
            (goal.title.as_str(), goal.status == "achieved"),
        )
    });
    let waits = load.expectations.iter().map(|wait| {
        let met = wait.status != ExpectationStatus::Pending;
        (
            format!("expectation-{}", wait.id),
            (wait.title.as_str(), met),
        )
    });
    tasks.chain(goals).chain(waits).collect()
}

/// The dependencies each Task is blocked by: every edge whose target is on the board and not met,
/// in edge order.
fn dependency_blocks(
    load: &MindmapLoad,
    targets: &HashMap<Key, (&str, bool)>,
) -> HashMap<Key, Vec<DependencyBlock>> {
    let mut blocks: HashMap<Key, Vec<DependencyBlock>> = HashMap::new();
    for edge in &load.task_dependencies {
        let owner = format!("task-{}", edge.task_id);
        if !targets.contains_key(&owner) {
            continue;
        }
        let kind = match edge.dependency_type.as_str() {
            "expectation" => "expectation",
            "task" => "task",
            _ => "goal",
        };
        let target = format!("{kind}-{}", edge.dependency_id);
        let Some((title, met)) = targets.get(&target) else {
            continue;
        };
        if *met {
            continue;
        }
        blocks.entry(owner).or_default().push(DependencyBlock {
            kind: kind.to_string(),
            id: edge.dependency_id.clone(),
            short_id: load.short_ids.get(&target).cloned(),
            title: (*title).to_string(),
        });
    }
    blocks
}

/// The open agentic question beneath each Task: the first, in position order, of the waits
/// directly beneath it that an agent raised as a question and is still pending and live.
fn open_questions(
    load: &MindmapLoad,
    lifecycles: &HashMap<(&str, &NodeId), &ItemLifecycle>,
) -> HashMap<Key, NodeId> {
    let mut asked: Vec<&Expectation> = load
        .expectations
        .iter()
        .filter(|wait| is_open_question(wait) && !wait_archived(wait, lifecycles))
        .collect();
    asked.sort_by_key(|wait| wait.position);
    let mut questions = HashMap::new();
    for wait in asked {
        questions
            .entry(format!("task-{}", wait.parent_id))
            .or_insert_with(|| wait.id.clone());
    }
    questions
}

/// What the agents are doing on the whole board.
fn agent_activity(
    load: &MindmapLoad,
    lifecycles: &HashMap<(&str, &NodeId), &ItemLifecycle>,
) -> AgentActivity {
    let waits = load
        .expectations
        .iter()
        .filter(|wait| {
            wait.agentic
                && !wait.question
                && wait.status == ExpectationStatus::Pending
                && !wait_archived(wait, lifecycles)
        })
        .count();
    let holding = |status: AgenticStatus| {
        load.tasks
            .iter()
            .filter(|task| task.status == Status::Agentic(status))
            .count()
    };
    AgentActivity {
        review: holding(AgenticStatus::Review),
        waits,
        on_agent: holding(AgenticStatus::OnAgent),
    }
}

/// The title of the MCP root each node is seen through, by key — absent for a node the MCP cannot
/// see. A stored node answers by itself, from `access`; a derived one (a Habit occurrence, a wait's
/// check task, a delegated Task's wait) is a row of nothing, so it takes the answer of the nearest
/// stored node above it.
fn mcp_visible_via(links: &HashMap<Key, Link>, access: &[EffectiveAccess]) -> HashMap<Key, String> {
    let titles: HashMap<NodeKey, &str> = links
        .values()
        .filter_map(|link| Some((link.stored?, link.title.as_str())))
        .collect();
    let via: HashMap<NodeKey, String> = access
        .iter()
        .map(|entry| {
            let node = NodeKey {
                node_kind: entry.node_kind,
                node_id: entry.node_id,
            };
            let root = NodeKey {
                node_kind: entry.root_kind,
                node_id: entry.root_id,
            };
            let title = titles.get(&root).copied().unwrap_or_default();
            (node, title.to_string())
        })
        .collect();
    let mut seen = HashMap::new();
    for (key, link) in links {
        let mut cursor = Some(link);
        for _ in 0..=links.len() {
            let Some(current) = cursor else {
                break;
            };
            if let Some(node) = current.stored {
                if let Some(title) = via.get(&node) {
                    seen.insert(key.clone(), title.clone());
                }
                break;
            }
            cursor = current
                .parent
                .as_deref()
                .and_then(|parent| links.get(parent));
        }
    }
    seen
}

/// Every node's facts on `load`, and what the agents are doing — what the app's load serves
/// beside the rows. `access` is what the MCP roots make visible, when it could be read.
pub fn derive(
    load: &MindmapLoad,
    access: Option<&[EffectiveAccess]>,
) -> (HashMap<String, NodeFacts>, AgentActivity) {
    let lifecycles: HashMap<(&str, &NodeId), &ItemLifecycle> = load
        .lifecycles
        .iter()
        .map(|lifecycle| {
            (
                (lifecycle.node_type.as_str(), &lifecycle.node_id),
                lifecycle,
            )
        })
        .collect();
    let links = links(load);
    let mut facts: HashMap<String, NodeFacts> = HashMap::new();
    for key in links.keys() {
        let node = NodeFacts {
            inherited_agentic: inherited(&links, key, |link| link.agentic).unwrap_or(false),
            inherited_time_scope: inherited(&links, key, |link| link.time_scope.clone()),
            ..NodeFacts::default()
        };
        if node != NodeFacts::default() {
            facts.insert(key.clone(), node);
        }
    }
    let targets = dependency_targets(load);
    for (key, blocks) in dependency_blocks(load, &targets) {
        facts.entry(key).or_default().dependency_blocks = blocks;
    }
    for (key, (_, met)) in &targets {
        if *met {
            facts.entry(key.clone()).or_default().met = true;
        }
    }
    for (key, question) in open_questions(load, &lifecycles) {
        facts.entry(key).or_default().open_question = Some(question);
    }
    let expired: HashSet<&NodeId> = load
        .commitments
        .iter()
        .filter(|commitment| {
            let lifecycle = lifecycles.get(&("commitment", &commitment.id));
            let verdict = lifecycle
                .and_then(|lifecycle| lifecycle.verdict)
                .unwrap_or(commitment.verdict);
            verdict == Verdict::Unresolved
                && lifecycle.is_some_and(|lifecycle| lifecycle.archival == Archival::Archived)
        })
        .map(|commitment| &commitment.id)
        .collect();
    for id in expired {
        facts.entry(format!("commitment-{id}")).or_default().expired = true;
    }
    for (key, title) in mcp_visible_via(&links, access.unwrap_or_default()) {
        facts.entry(key).or_default().mcp_visible_via = Some(title);
    }
    (facts, agent_activity(load, &lifecycles))
}
