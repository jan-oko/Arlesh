//! Enforcing the MCP roots at the tools' edges, and telling an agent what they are.
//!
//! A thin layer on purpose. Each tool asks one question on the way in — may the MCP touch the node
//! this request names? — and applies one filter on the way out — drop what it may not see, and
//! every relation pointing at it. The tools' own logic is unchanged underneath, and resolution
//! itself lives in [`crate::access`], so a change to either side stays on its side.
//!
//! Two answers, deliberately different (see `docs/spec/mcp-server.md`, "Access"):
//!
//! - **Bulk reads omit.** A listing or a snapshot page without a node reads as a board without it,
//!   with nothing to say that anything was left out.
//! - **A request naming a node is refused** with `not_permitted` — including a node that does not
//!   exist, so the error kind cannot be used to probe for what is there.

use std::collections::{HashMap, HashSet};

use rmcp::model::{CallToolResult, ErrorData};

use super::result;
use crate::{
    access::{
        model::{AccessLevel, CatalogueNode, KnowledgeBaseReference, NodeKey, NodeTable},
        resolve::AccessMap,
    },
    mindmap::model::MindmapLoad,
    nodes::id::{DerivedId, NodeId},
    tasks::model::{Dependency, Task},
};

/// The refusal for a request naming a node the MCP may not touch at `needed`.
///
/// Worded the same whether the node is outside the roots or does not exist, for the reason the
/// module docs give.
pub(super) fn refuse(
    node_type: &str,
    node_id: impl std::fmt::Display,
    needed: AccessLevel,
) -> Result<CallToolResult, ErrorData> {
    result::not_permitted(match needed {
        AccessLevel::Write => format!(
            "{node_type} {node_id} is not an Agentic task inside the MCP roots, so it cannot be \
             written"
        ),
        AccessLevel::Read | AccessLevel::None => {
            format!("{node_type} {node_id} is not inside the MCP roots")
        }
    })
}

/// Whether `map` lets the MCP hold `needed` on the node a board reference names. A reference to
/// something that is not a stored row is never permitted.
pub(super) fn permits(map: &AccessMap, node_type: &str, node_id: i64, needed: AccessLevel) -> bool {
    NodeKey::from_reference(node_type, node_id).is_some_and(|node| map.level(node).permits(needed))
}

/// Whether `map` lets the MCP read the node a board reference names.
pub(super) fn reads(map: &AccessMap, node_type: &str, node_id: i64) -> bool {
    permits(map, node_type, node_id, AccessLevel::Read)
}

fn reads_row(map: &AccessMap, table: NodeTable, id: i64) -> bool {
    map.can_read(NodeKey::new(table, id))
}

/// A flow item reference inside a Flow the MCP can already read. `flow_root` names the Flow
/// itself, so it is readable exactly when the Flow is.
fn reads_flow_item(map: &AccessMap, item_type: &str, item_id: i64) -> bool {
    match NodeTable::from_reference(item_type) {
        Some(table) => reads_row(map, table, item_id),
        None => true,
    }
}

/// Drops the tag ids that name a Tag the MCP cannot read.
fn keep_readable_tags(tag_ids: &mut Vec<i64>, map: &AccessMap) {
    tag_ids.retain(|&tag| reads_row(map, NodeTable::Domain, tag));
}

/// Cuts a Task down to what the MCP can read: its tags, and its Expectation template's tags.
pub(super) fn restrict_task(task: &mut Task, map: &AccessMap) {
    keep_readable_tags(&mut task.tag_ids, map);
    if let Some(template) = task.async_template.as_mut() {
        keep_readable_tags(&mut template.tag_ids, map);
    }
}

/// Removes the "Blocked by …" reasons that name a dependency the MCP cannot read.
///
/// The reasons arrive as text from `tasks::get_task_with_blockers`, which writes each derived one
/// as `Blocked by {kind} {id} ({title})`; this matches that prefix. A reason the user typed is
/// never dropped, since it names nothing.
pub(super) fn restrict_block_reasons(
    reasons: &mut Vec<String>,
    dependencies: &[Dependency],
    map: &AccessMap,
) {
    let hidden: Vec<String> = dependencies
        .iter()
        .filter_map(|dependency| {
            let (kind, id) = match dependency {
                Dependency::Task { id } => ("task", id.clone()),
                Dependency::Goal { id } => ("goal", id.clone()),
                Dependency::Expectation { id } => ("expectation", NodeId::Stored(*id)),
            };
            // A derived dependency (an occurrence) is kept only when its stored end is visible;
            // without the snapshot to climb, a reason naming one is dropped as unseen.
            let seen = id.stored().is_some_and(|stored| reads(map, kind, stored));
            (!seen).then(|| format!("Blocked by {kind} {id} ("))
        })
        .collect();
    reasons.retain(|reason| !hidden.iter().any(|prefix| reason.starts_with(prefix)));
}

/// What the MCP can see of one snapshot's rows, stored and derived alike.
///
/// A stored row is visible when the MCP roots reach it ([`AccessMap`]). A derived row — a Habit
/// occurrence, a wait's check task, a spawned or delegation wait — is a row of nothing, is never a
/// root and never writable, and is visible exactly when it is not private and the nearest stored
/// row above it is visible. Its parents are read off the snapshot itself, since a derived row's
/// parent can be derived too (an occurrence under its iteration's root).
struct SnapshotView<'map> {
    map: &'map AccessMap,
    derived: HashMap<DerivedId, bool>,
}

impl<'map> SnapshotView<'map> {
    fn of(load: &MindmapLoad, map: &'map AccessMap) -> Self {
        let mut parents: HashMap<DerivedId, (String, NodeId, bool)> = HashMap::new();
        let mut note = |id: &NodeId, parent_type: &str, parent_id: &NodeId, private: bool| {
            if let NodeId::Derived(derived) = id {
                parents.insert(
                    derived.clone(),
                    (parent_type.to_string(), parent_id.clone(), private),
                );
            }
        };
        for row in &load.tasks {
            note(&row.id, &row.parent_type, &row.parent_id, row.is_private);
        }
        for row in &load.goals {
            note(&row.id, &row.parent_type, &row.parent_id, row.is_private);
        }
        for row in &load.commitments {
            note(&row.id, &row.parent_type, &row.parent_id, row.is_private);
        }
        for row in &load.expectations {
            note(&row.id, &row.parent_type, &row.parent_id, row.is_private);
        }

        let mut derived: HashMap<DerivedId, bool> = HashMap::with_capacity(parents.len());
        for start in parents.keys() {
            // Climb to the first stored parent, a row already decided, or a loop; then decide the
            // whole chain from there down.
            let mut chain: Vec<&DerivedId> = Vec::new();
            let mut cursor = start;
            let answer = loop {
                if let Some(&known) = derived.get(cursor) {
                    break known;
                }
                if chain.contains(&cursor) {
                    break false;
                }
                chain.push(cursor);
                let Some((parent_type, parent_id, private)) = parents.get(cursor) else {
                    break false;
                };
                if *private {
                    break false;
                }
                match parent_id {
                    NodeId::Stored(id) => break reads(map, parent_type, *id),
                    NodeId::Derived(parent) => cursor = parent,
                }
            };
            for id in chain {
                // A private row anywhere on the chain hides everything below it, not above it.
                let private = parents.get(id).is_some_and(|(_, _, private)| *private);
                derived.insert(id.clone(), answer && !private);
            }
        }
        Self { map, derived }
    }

    /// Whether the MCP can see the node a board reference names.
    fn sees(&self, node_type: &str, id: &NodeId) -> bool {
        match id {
            NodeId::Stored(id) => reads(self.map, node_type, *id),
            NodeId::Derived(id) => self.derived.get(id).copied().unwrap_or(false),
        }
    }
}

/// Cuts a snapshot down to what the MCP can see.
///
/// Every node section loses the rows outside the roots — derived rows included, which take their
/// visibility from the nearest stored row above them — and every section pointing at a node loses
/// the entries naming one it dropped: lifecycles, block reasons, dependency edges, tag ids, flow
/// cycles and dependencies, instance links and Habit outcomes. A Flow's sections travel with the
/// Flow.
///
/// Parent references and a Flow's target are kept. They say where a visible node hangs, and the
/// top of a root's subtree always hangs somewhere the MCP cannot see.
pub(super) fn restrict_snapshot(load: &mut MindmapLoad, map: &AccessMap) {
    let view = SnapshotView::of(load, map);

    load.domains
        .retain(|domain| reads_row(map, NodeTable::Domain, domain.id));
    load.goals.retain(|goal| view.sees("goal", &goal.id));
    load.tasks.retain(|task| view.sees("task", &task.id));
    load.commitments
        .retain(|commitment| view.sees("commitment", &commitment.id));
    load.expectations
        .retain(|expectation| view.sees("expectation", &expectation.id));
    load.infos
        .retain(|info| reads_row(map, NodeTable::Info, info.id));
    load.flows
        .retain(|flow| reads_row(map, NodeTable::Flow, flow.id));
    load.flow_goals
        .retain(|item| reads_row(map, NodeTable::FlowGoal, item.id));
    load.flow_tasks
        .retain(|item| reads_row(map, NodeTable::FlowTask, item.id));

    for task in &mut load.tasks {
        restrict_task(task, map);
    }
    for goal in &mut load.goals {
        keep_readable_tags(&mut goal.tag_ids, map);
    }
    for commitment in &mut load.commitments {
        keep_readable_tags(&mut commitment.tag_ids, map);
    }
    for expectation in &mut load.expectations {
        keep_readable_tags(&mut expectation.tag_ids, map);
    }

    load.lifecycles
        .retain(|lifecycle| view.sees(&lifecycle.node_type, &lifecycle.node_id));
    load.block_reasons
        .retain(|reason| view.sees(&reason.owner_type, &reason.owner_id));
    load.task_dependencies.retain(|edge| {
        view.sees("task", &edge.task_id) && view.sees(&edge.dependency_type, &edge.dependency_id)
    });
    load.flow_instance_nodes
        .retain(|node| reads(map, &node.node_type, node.node_id));

    load.flow_cycles.retain(|cycle| {
        reads_row(map, NodeTable::Flow, cycle.flow_id)
            && reads_flow_item(map, &cycle.item_type, cycle.item_id)
    });
    load.flow_dependencies.retain(|dependency| {
        reads_row(map, NodeTable::Flow, dependency.flow_id)
            && reads_flow_item(map, &dependency.dependent_type, dependency.dependent_id)
            && reads_flow_item(map, &dependency.depends_on_type, dependency.depends_on_id)
    });
    load.habits
        .retain(|entry| reads_row(map, NodeTable::Flow, entry.flow_id));
}

/// The knowledge-base entities the MCP can see: those a readable node points at.
///
/// People, Events and Threads hang on no node, so no root contains them; one is visible exactly
/// when a Task or Goal the MCP can read is delegated to it or links it.
pub(super) fn visible_knowledge_base(
    references: &[KnowledgeBaseReference],
    map: &AccessMap,
) -> HashSet<(String, i64)> {
    references
        .iter()
        .filter(|reference| map.can_read(reference.owner))
        .map(|reference| (reference.entity_type.clone(), reference.entity_id))
        .collect()
}

/// How many of a root's segments its path spells out before eliding the rest.
const PATH_SEGMENTS: usize = 3;

/// The part of the server's instructions that tells an agent what it can see: every MCP root by
/// kind, id and short path, and the rules that follow from them.
///
/// A root the MCP cannot see — a private one, or one inside a private subtree — is left out: its
/// title is private too, and naming it would tell the agent about something it cannot read.
pub(super) fn roots_instructions(
    nodes: &[CatalogueNode],
    roots: &[NodeKey],
    map: &AccessMap,
) -> String {
    let by_key: HashMap<NodeKey, &CatalogueNode> =
        nodes.iter().map(|node| (node.key(), node)).collect();
    let listed: Vec<String> = roots
        .iter()
        .filter(|&&root| map.can_read(root))
        .filter_map(|root| by_key.get(root))
        .map(|node| {
            format!(
                "- {} ({} {})",
                short_path(node, &by_key),
                display_kind(node),
                node.node_id
            )
        })
        .collect();

    if listed.is_empty() {
        return "MCP ROOTS: none. The user has not opened any part of the board to you, so \
                every tool answers as though the board were empty and a request naming a node is \
                refused as not_permitted. If you need the board, ask the user to add an MCP root \
                under Settings › MCP access."
            .to_string();
    }

    format!(
        "MCP ROOTS. You can see these nodes and everything inside them, private nodes excepted; \
         nothing outside them exists for you, and a request naming a node outside them is \
         refused as not_permitted:\n{}\nInside them, Agentic tasks (a task's own `agentic` \
         flag, or its nearest flagged ancestor's) are writable; everything else is read-only.",
        listed.join("\n")
    )
}

/// A node's title, preceded by its nearest ancestors' — outermost first, at most
/// [`PATH_SEGMENTS`] in all, with `…` standing in for the rest.
fn short_path(node: &CatalogueNode, by_key: &HashMap<NodeKey, &CatalogueNode>) -> String {
    let mut segments: Vec<&str> = vec![node.title.as_str()];
    let mut seen: HashSet<NodeKey> = HashSet::from([node.key()]);
    let mut cursor = node.parent();
    let mut elided = false;
    while let Some(key) = cursor {
        let Some(ancestor) = by_key.get(&key) else {
            break;
        };
        if !seen.insert(key) {
            break;
        }
        if segments.len() == PATH_SEGMENTS {
            elided = true;
            break;
        }
        segments.push(ancestor.title.as_str());
        cursor = ancestor.parent();
    }
    if elided {
        segments.push("…");
    }
    segments.reverse();
    segments.join(" › ")
}

/// The kind an agent sees a node as: a domain-table row by its subtype, everything else by its
/// table.
fn display_kind(node: &CatalogueNode) -> &str {
    node.subtype
        .as_deref()
        .unwrap_or_else(|| node.node_kind.as_str())
}

#[cfg(test)]
mod tests;
