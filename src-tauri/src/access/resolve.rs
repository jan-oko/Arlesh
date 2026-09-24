//! Effective MCP access: what the MCP may do with every stored node, given the MCP roots.
//!
//! The rules, settled with the user on 2026-09-24 (see `docs/spec/mcp-server.md`, "Access"):
//!
//! 1. **Nothing by default.** A node that is not an MCP root and has no root above it is
//!    invisible. With no roots at all, the MCP sees nothing.
//! 2. **Inside a root, everything is readable** — the whole subtree, however deep.
//! 3. **An Agentic Task inside a root is writable too.** Agentic is read the way the app reads it:
//!    a Task's own flag, or the nearest flagged ancestor's, and only a Task is ever Agentic
//!    itself. Everything else is read-only.
//! 4. **Private nodes stay hidden**, root or no root. Privacy covers a subtree, as Private Mode
//!    reads it, so a node under a private one is private too, wherever the root sits.
//!
//! This is the one definition. The MCP tools filter by it, and the app's "visible to the MCP"
//! badge is drawn from [`AccessMap::effective`] rather than from a second resolver in TypeScript.

use std::collections::{HashMap, HashSet};

use super::model::{AccessLevel, EffectiveAccess, NodeKey, NodeTable, StoredNode};

/// What resolution learned about one node.
#[derive(Debug, Clone, Copy)]
struct Resolved {
    /// The nearest MCP root at or above the node, if any.
    root: Option<NodeKey>,
    /// Whether the node or any ancestor is marked private.
    private: bool,
    /// What the node reads as for Agentic: its own flag, or the nearest flagged ancestor's.
    agentic: bool,
}

/// Every stored node's effective access, resolved once and read many times.
#[derive(Debug, Clone, Default)]
pub struct AccessMap {
    resolved: HashMap<NodeKey, Resolved>,
}

impl AccessMap {
    /// Resolves every node in `nodes` against the MCP `roots`.
    ///
    /// A root naming a node that is not in `nodes` opens nothing. A parent reference naming a
    /// node that is not in `nodes` ends the climb there, as the top of the board would. A parent
    /// cycle — which the schema cannot express but no constraint forbids — is broken where it
    /// closes, so every node on it still resolves and none of them inherits from itself.
    pub fn resolve(nodes: &[StoredNode], roots: &[NodeKey]) -> Self {
        let by_key: HashMap<NodeKey, &StoredNode> =
            nodes.iter().map(|node| (node.key, node)).collect();
        let roots: HashSet<NodeKey> = roots.iter().copied().collect();

        let mut resolved: HashMap<NodeKey, Resolved> = HashMap::with_capacity(nodes.len());
        for node in nodes {
            resolve_chain(node.key, &by_key, &roots, &mut resolved);
        }
        Self { resolved }
    }

    /// What the MCP may do with `node`: [`AccessLevel::None`] for a node that is not stored, is
    /// outside every root, or is private; [`AccessLevel::Write`] for an Agentic Task inside a
    /// root; [`AccessLevel::Read`] for everything else inside one.
    pub fn level(&self, node: NodeKey) -> AccessLevel {
        self.visible(node)
            .map_or(AccessLevel::None, |(_, level)| level)
    }

    /// Whether the MCP can read `node`.
    pub fn can_read(&self, node: NodeKey) -> bool {
        self.level(node).permits(AccessLevel::Read)
    }

    /// Whether the MCP can write `node`.
    pub fn can_write(&self, node: NodeKey) -> bool {
        self.level(node).permits(AccessLevel::Write)
    }

    /// The nearest MCP root at or above `node`, when the MCP can see `node` at all.
    pub fn root_of(&self, node: NodeKey) -> Option<NodeKey> {
        self.visible(node).map(|(root, _)| root)
    }

    /// Every node the MCP can see, with the root it is seen through, in node order.
    pub fn effective(&self) -> Vec<EffectiveAccess> {
        let mut entries: Vec<EffectiveAccess> = self
            .resolved
            .keys()
            .filter_map(|&node| {
                let root = self.root_of(node)?;
                Some(EffectiveAccess {
                    node_kind: node.node_kind,
                    node_id: node.node_id,
                    root_kind: root.node_kind,
                    root_id: root.node_id,
                })
            })
            .collect();
        entries.sort_by_key(|entry| (entry.node_kind, entry.node_id));
        entries
    }

    /// The root opening `node` and the level it gets, unless the node is invisible.
    fn visible(&self, node: NodeKey) -> Option<(NodeKey, AccessLevel)> {
        let resolved = self.resolved.get(&node)?;
        let root = resolved.root?;
        if resolved.private {
            return None;
        }
        let level = if node.node_kind == NodeTable::Task && resolved.agentic {
            AccessLevel::Write
        } else {
            AccessLevel::Read
        };
        Some((root, level))
    }
}

/// Resolves `start` and every unresolved ancestor above it.
///
/// Climbs to the first node that is already resolved, the top of the board, or a node already
/// on this climb (a cycle), then resolves the chain top-down so each node reads its parent's
/// answer. Iterative, so a deep tree cannot overflow the stack.
fn resolve_chain(
    start: NodeKey,
    by_key: &HashMap<NodeKey, &StoredNode>,
    roots: &HashSet<NodeKey>,
    resolved: &mut HashMap<NodeKey, Resolved>,
) {
    let mut chain: Vec<NodeKey> = Vec::new();
    let mut on_chain: HashSet<NodeKey> = HashSet::new();
    let mut cursor = Some(start);

    while let Some(key) = cursor {
        if resolved.contains_key(&key) || !on_chain.insert(key) {
            break;
        }
        let Some(node) = by_key.get(&key) else {
            break;
        };
        chain.push(key);
        cursor = node.parent;
    }

    for key in chain.into_iter().rev() {
        let Some(node) = by_key.get(&key) else {
            continue;
        };
        // The parent is resolved by now unless the climb stopped at it: a missing row or the
        // node that closed a cycle. Either way it has nothing to hand down.
        let inherited = node
            .parent
            .and_then(|parent| resolved.get(&parent))
            .copied();
        let own_root = roots.contains(&key).then_some(key);
        resolved.insert(
            key,
            Resolved {
                root: own_root.or(inherited.and_then(|parent| parent.root)),
                private: node.is_private || inherited.is_some_and(|parent| parent.private),
                agentic: node
                    .agentic
                    .unwrap_or(inherited.is_some_and(|parent| parent.agentic)),
            },
        );
    }
}

#[cfg(test)]
mod tests;
