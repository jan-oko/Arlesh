//! MCP access models: which stored nodes are MCP roots, and what the MCP may do with a node.

use std::fmt;

use serde::{Deserialize, Serialize};

/// The table a stored node is a row of — the half of its identity an MCP root is keyed by.
///
/// Deliberately the **table**, not the display kind: an Aspect, Project, Domain and Tag are all
/// rows of `domains` and are all [`NodeTable::Domain`], keyed by `domains.id`, exactly as the
/// node's own table keys it. A derived node (a Habit occurrence, a wait's check task, a delegated
/// Task's wait) is a row of nothing and has no `NodeTable`: it is visible when the nearest stored
/// node above it is, and never writable, having no row to write.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeTable {
    /// A row of `domains`: an Aspect, Project, Domain or Tag.
    Domain,
    /// A row of `goals`.
    Goal,
    /// A row of `tasks`.
    Task,
    /// A row of `commitments`.
    Commitment,
    /// A row of `expectations` — a stored wait.
    Expectation,
    /// A row of `infos`.
    Info,
    /// A row of `flows`.
    Flow,
    /// A row of `flow_goals` — a Goal item of a Flow template.
    FlowGoal,
    /// A row of `flow_tasks` — a Task item of a Flow template.
    FlowTask,
}

impl NodeTable {
    /// The stored spelling, as `mcp_roots.node_kind` holds it.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Domain => "domain",
            Self::Goal => "goal",
            Self::Task => "task",
            Self::Commitment => "commitment",
            Self::Expectation => "expectation",
            Self::Info => "info",
            Self::Flow => "flow",
            Self::FlowGoal => "flow_goal",
            Self::FlowTask => "flow_task",
        }
    }

    /// Parses a node reference as the board spells it anywhere a row names another row: a
    /// `parent_type`, a dependency's type, a lifecycle's `node_type`, an MCP `node_type`.
    ///
    /// Those columns name a domain-table row by its **subtype** (`aspect`, `project`, `domain`,
    /// `tag`), so all four read as [`NodeTable::Domain`]. Anything that is not a stored row —
    /// `flow_root`, `expectation_check`, a typo — is `None`.
    pub fn from_reference(value: &str) -> Option<Self> {
        match value {
            "aspect" | "project" | "domain" | "tag" => Some(Self::Domain),
            "goal" => Some(Self::Goal),
            "task" => Some(Self::Task),
            "commitment" => Some(Self::Commitment),
            "expectation" => Some(Self::Expectation),
            "info" => Some(Self::Info),
            "flow" => Some(Self::Flow),
            "flow_goal" => Some(Self::FlowGoal),
            "flow_task" => Some(Self::FlowTask),
            _ => None,
        }
    }
}

impl fmt::Display for NodeTable {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// One stored node: its table and its row id there.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct NodeKey {
    /// The table the node is a row of.
    pub node_kind: NodeTable,
    /// Its primary key in that table.
    pub node_id: i64,
}

impl NodeKey {
    /// The node `node_id` of `node_kind`.
    pub fn new(node_kind: NodeTable, node_id: i64) -> Self {
        Self { node_kind, node_id }
    }

    /// The node a board reference names — see [`NodeTable::from_reference`] — or `None` when the
    /// reference is not to a stored row.
    pub fn from_reference(node_type: &str, node_id: i64) -> Option<Self> {
        NodeTable::from_reference(node_type).map(|node_kind| Self::new(node_kind, node_id))
    }
}

impl fmt::Display for NodeKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{} {}", self.node_kind, self.node_id)
    }
}

/// What the MCP endpoint may do with one node.
///
/// Derived, never stored: a node's level follows from the MCP roots, privacy and Agentic (see
/// [`crate::access::resolve`]). Ordered `None < Read < Write`, and write implies read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccessLevel {
    /// Invisible: outside every root, or private.
    None,
    /// Readable.
    Read,
    /// Readable and writable — an Agentic Task inside a root.
    Write,
}

impl AccessLevel {
    /// Whether holding `self` is enough for something that needs `needed`.
    pub fn permits(self, needed: AccessLevel) -> bool {
        self >= needed
    }
}

/// One stored node as access resolution sees it: where it hangs, and the two flags of its own
/// that access reads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StoredNode {
    /// The node.
    pub key: NodeKey,
    /// The stored node it hangs under, or `None` for a root of the board (an Aspect) or a parent
    /// reference that names no stored row.
    pub parent: Option<NodeKey>,
    /// The node's **own** private flag. Privacy covers a subtree, so a node under a private one
    /// is private too; resolution works that out.
    pub is_private: bool,
    /// The node's **own** Agentic flag — a Task's `agentic`, `None` on a Task that inherits and
    /// on every other kind. Resolution passes it down the way the app does.
    pub agentic: Option<bool>,
}

/// One stored node as the MCP access page lists it: enough to find it by title and name it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CatalogueNode {
    /// The node's table.
    pub node_kind: NodeTable,
    /// The node's row id.
    pub node_id: i64,
    /// For a domain-table row, its subtype (`aspect`, `project`, `domain` or `tag`); `None`
    /// otherwise.
    pub subtype: Option<String>,
    /// Its title — an Info's body.
    pub title: String,
    /// The table of the stored node it hangs under, if any.
    pub parent_kind: Option<NodeTable>,
    /// The row id of the stored node it hangs under, if any.
    pub parent_id: Option<i64>,
    /// Its own private flag.
    pub is_private: bool,
    /// Its own Agentic flag, for a Task that sets one.
    pub agentic: Option<bool>,
}

impl CatalogueNode {
    /// The node itself.
    pub fn key(&self) -> NodeKey {
        NodeKey::new(self.node_kind, self.node_id)
    }

    /// The node it hangs under, if any.
    pub fn parent(&self) -> Option<NodeKey> {
        self.parent_kind
            .zip(self.parent_id)
            .map(|(kind, id)| NodeKey::new(kind, id))
    }

    /// Where it hangs and what it says about itself, as resolution reads it.
    pub fn stored(&self) -> StoredNode {
        StoredNode {
            key: self.key(),
            parent: self.parent(),
            is_private: self.is_private,
            agentic: self.agentic,
        }
    }
}

/// One node the MCP can see, and the root it is seen through.
///
/// What the app's node badge reads. It carries no level: whether the MCP may also write a node is
/// whether the node is an Agentic Task, which the node's own Agentic badge already says.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct EffectiveAccess {
    /// The node's table.
    pub node_kind: NodeTable,
    /// The node's row id.
    pub node_id: i64,
    /// The table of the nearest MCP root at or above the node.
    pub root_kind: NodeTable,
    /// The row id of that root.
    pub root_id: i64,
}

/// A knowledge-base entity a stored node points at: a Person a Task is delegated to, or a
/// Person, Event or Thread a Task or Goal links.
///
/// People, Events and Threads hang on no node, so no root contains them. The MCP sees one exactly
/// when a node it can read points at it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct KnowledgeBaseReference {
    /// The node doing the pointing.
    pub owner: NodeKey,
    /// `person`, `event` or `thread`.
    pub entity_type: String,
    /// The entity's row id.
    pub entity_id: i64,
}
