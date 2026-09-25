//! Full ids and short ids: how an agent names a node, and how a name is read back.
//!
//! Nothing here is stored. A node's **full id** is a UUID-v5 in the one namespace every derived
//! row's id already lives in (`nodes::id`): a derived row keeps the UUID it has, and a stored row's
//! is the UUID-v5 of `{kind}:{row id}` — deterministic, so it never needs keeping. Its **short id**
//! is the shortest prefix of that UUID's hex digits, 3 at least, that no other node the MCP can see
//! **right now** shares — worked out from a sorted list at each read.
//!
//! The trade-off, accepted with the user on 2026-09-24: a prefix an agent saw earlier can become
//! ambiguous as nodes are added. It then refuses as `ambiguous_id`, listing the candidates, rather
//! than ever naming the wrong node.

use std::collections::HashMap;

use serde::Serialize;
use serde_json::Value;

use crate::{
    access::model::NodeTable,
    mindmap::model::MindmapLoad,
    nodes::id::{uuid_v5, NodeId, NODE_NAMESPACE},
};

/// The fewest hex characters a short id has.
const SHORTEST: usize = 3;

/// How many ancestors a candidate's path names before eliding the rest.
const PATH_SEGMENTS: usize = 3;

/// A node's full id: its derived UUID, or the UUID-v5 of `{kind}:{row id}` for a stored row.
pub(super) fn full_id(table: NodeTable, id: &NodeId) -> String {
    match id {
        NodeId::Stored(row) => uuid_v5(&NODE_NAMESPACE, &format!("{}:{row}", table.as_str())),
        NodeId::Derived(derived) => derived.as_str().to_string(),
    }
}

/// The hex digits of an id or a prefix of one, lower-cased — `None` when it holds anything else.
fn hex_digits(text: &str) -> Option<String> {
    let digits: String = text
        .chars()
        .filter(|character| *character != '-')
        .collect::<String>()
        .to_ascii_lowercase();
    digits
        .chars()
        .all(|character| character.is_ascii_hexdigit())
        .then_some(digits)
}

/// One node the MCP can see, as an id names it.
#[derive(Debug, Clone, Serialize)]
pub(super) struct Named {
    /// Its shortest unique prefix among the nodes the MCP can see now.
    pub short_id: String,
    /// Its full id.
    pub id: String,
    /// Its row id when stored, its UUID when derived — what the snapshot's `id` field holds.
    pub node_id: NodeId,
    /// `domain`/`project`/`aspect`/`tag`, `goal`, `task`, `commitment`, `expectation`, `info`,
    /// `flow`, `flow_goal` or `flow_task`.
    pub kind: String,
    /// Its title (an Info's body).
    pub title: String,
    /// Its nearest ancestors the MCP can see, outermost first: `Growth › CODE › ARLESH`.
    pub path: String,
    #[serde(skip)]
    table: NodeTable,
    #[serde(skip)]
    hex: String,
}

impl Named {
    /// The table the node is a row of — or would be, for a derived row.
    pub fn table(&self) -> NodeTable {
        self.table
    }
}

/// Why a quoted id named nothing it can be read as.
#[derive(Debug, Clone)]
pub(super) enum IdRefusal {
    /// No node the MCP can see matches.
    Unknown,
    /// Several do; each is listed.
    Ambiguous(Vec<Named>),
}

/// Every node the MCP can see, by full id, with the short id each goes by right now.
#[derive(Debug, Clone, Default)]
pub(super) struct NodeNames {
    /// Sorted by hex digits.
    nodes: Vec<Named>,
    by_node: HashMap<(NodeTable, NodeId), usize>,
    /// Every domain-table row's true subtype, visible or not — what a parent reference to one
    /// is reported as.
    subtypes: HashMap<i64, String>,
}

/// A node by table and id.
type NodeRef = (NodeTable, NodeId);

/// Each node's title and parent, for spelling paths.
type Titles = HashMap<NodeRef, (String, Option<NodeRef>)>;

/// One entry before its short id and path are known.
struct Entry {
    table: NodeTable,
    id: NodeId,
    kind: String,
    title: String,
    parent: Option<(NodeTable, NodeId)>,
}

impl NodeNames {
    /// Names every node in `load` — which the caller has already cut to what the MCP can see, so
    /// a hidden node neither gets a name nor makes anyone else's longer.
    pub fn of(load: &MindmapLoad) -> Self {
        let mut entries: Vec<Entry> = Vec::new();
        let parent = |parent_type: &str, parent_id: NodeId| {
            NodeTable::from_reference(parent_type).map(|table| (table, parent_id))
        };
        for domain in &load.domains {
            entries.push(Entry {
                table: NodeTable::Domain,
                id: NodeId::Stored(domain.id),
                kind: domain.subtype.clone(),
                title: domain.title.clone(),
                parent: domain
                    .parent_id
                    .map(|id| (NodeTable::Domain, NodeId::Stored(id))),
            });
        }
        for goal in &load.goals {
            entries.push(Entry {
                table: NodeTable::Goal,
                id: goal.id.clone(),
                kind: "goal".into(),
                title: goal.title.clone(),
                parent: parent(&goal.parent_type, goal.parent_id.clone()),
            });
        }
        for task in &load.tasks {
            entries.push(Entry {
                table: NodeTable::Task,
                id: task.id.clone(),
                kind: "task".into(),
                title: task.title.clone(),
                parent: parent(&task.parent_type, task.parent_id.clone()),
            });
        }
        for commitment in &load.commitments {
            entries.push(Entry {
                table: NodeTable::Commitment,
                id: commitment.id.clone(),
                kind: "commitment".into(),
                title: commitment.title.clone(),
                parent: parent(&commitment.parent_type, commitment.parent_id.clone()),
            });
        }
        for expectation in &load.expectations {
            entries.push(Entry {
                table: NodeTable::Expectation,
                id: expectation.id.clone(),
                kind: "expectation".into(),
                title: expectation.title.clone(),
                parent: parent(&expectation.parent_type, expectation.parent_id.clone()),
            });
        }
        for info in &load.infos {
            entries.push(Entry {
                table: NodeTable::Info,
                id: NodeId::Stored(info.id),
                kind: "info".into(),
                title: info.body.clone(),
                parent: parent(&info.parent_type, info.parent_id.clone()),
            });
        }
        for flow in &load.flows {
            entries.push(Entry {
                table: NodeTable::Flow,
                id: NodeId::Stored(flow.id),
                kind: "flow".into(),
                title: flow.title.clone(),
                parent: parent(&flow.parent_type, NodeId::Stored(flow.parent_id)),
            });
        }
        for item in &load.flow_goals {
            entries.push(Entry {
                table: NodeTable::FlowGoal,
                id: NodeId::Stored(item.id),
                kind: "flow_goal".into(),
                title: item.title.clone(),
                parent: parent(&item.parent_type, NodeId::Stored(item.parent_id)),
            });
        }
        for item in &load.flow_tasks {
            entries.push(Entry {
                table: NodeTable::FlowTask,
                id: NodeId::Stored(item.id),
                kind: "flow_task".into(),
                title: item.title.clone(),
                parent: parent(&item.parent_type, NodeId::Stored(item.parent_id)),
            });
        }
        Self::from_entries(entries)
    }

    fn from_entries(entries: Vec<Entry>) -> Self {
        let titles: Titles = entries
            .iter()
            .map(|entry| {
                (
                    (entry.table, entry.id.clone()),
                    (entry.title.clone(), entry.parent.clone()),
                )
            })
            .collect();
        let nodes: Vec<Named> = entries
            .into_iter()
            .map(|entry| {
                let id = full_id(entry.table, &entry.id);
                Named {
                    short_id: String::new(),
                    hex: hex_digits(&id).unwrap_or_default(),
                    id,
                    path: path_above(entry.parent.clone(), &titles),
                    node_id: entry.id,
                    kind: entry.kind,
                    title: entry.title,
                    table: entry.table,
                }
            })
            .collect();
        Self::from_named(nodes)
    }

    /// Sorts `nodes`, gives each its short id and indexes them.
    fn from_named(mut nodes: Vec<Named>) -> Self {
        nodes.sort_by(|left, right| left.hex.cmp(&right.hex));

        // The shortest unique prefix of each is one past the longest prefix it shares with a
        // neighbour in sorted order.
        let shared: Vec<usize> = nodes
            .windows(2)
            .map(|pair| common_prefix(&pair[0].hex, &pair[1].hex))
            .collect();
        for (index, node) in nodes.iter_mut().enumerate() {
            let before = index
                .checked_sub(1)
                .and_then(|previous| shared.get(previous))
                .copied()
                .unwrap_or(0);
            let after = shared.get(index).copied().unwrap_or(0);
            let length = before.max(after) + 1;
            node.short_id = lettered(&node.hex, length, &node.id);
        }

        let by_node = nodes
            .iter()
            .enumerate()
            .map(|(index, node)| ((node.table, node.node_id.clone()), index))
            .collect();
        Self {
            nodes,
            by_node,
            subtypes: HashMap::new(),
        }
    }

    /// Records every domain-table row's true subtype, from the whole board, visible or not.
    pub fn with_subtypes(mut self, domains: &[crate::domains::model::Domain]) -> Self {
        self.subtypes = domains
            .iter()
            .map(|domain| (domain.id, domain.subtype.clone()))
            .collect();
        self
    }

    /// The true subtype of the domain-table row `id`, when it is one.
    pub fn subtype(&self, id: i64) -> Option<&str> {
        self.subtypes.get(&id).map(String::as_str)
    }

    /// Stamps a node's JSON with the ids it goes by — `short_id` and `full_id` beside its `id` —
    /// and names a domain-table parent by its true subtype, whatever spelling it was stored with.
    /// A node this list does not hold, such as one written a moment ago, gets the short id it
    /// would have among them.
    pub fn stamp(&self, item: &mut Value, table: NodeTable) {
        let Value::Object(fields) = item else {
            return;
        };
        let Some(id) = fields
            .get("id")
            .and_then(|id| serde_json::from_value::<NodeId>(id.clone()).ok())
        else {
            return;
        };
        let full = full_id(table, &id);
        let short = match self.short_id(table, &id) {
            Some(short) => short.to_string(),
            None => self.short_id_among(&full),
        };
        fields.insert("short_id".into(), Value::String(short));
        fields.insert("full_id".into(), Value::String(full));

        let parent_row = fields.get("parent_id").and_then(Value::as_i64);
        let under_domain = fields
            .get("parent_type")
            .and_then(Value::as_str)
            .and_then(NodeTable::from_reference)
            == Some(NodeTable::Domain);
        if let (true, Some(subtype)) = (under_domain, parent_row.and_then(|row| self.subtype(row)))
        {
            fields.insert("parent_type".into(), Value::String(subtype.to_string()));
        }
    }

    /// `value` serialised and [stamped](Self::stamp).
    pub fn stamped(&self, value: impl Serialize, table: NodeTable) -> Value {
        let mut value = serde_json::to_value(value).unwrap_or(Value::Null);
        self.stamp(&mut value, table);
        value
    }

    /// The short id of one node, when the MCP can see it.
    pub fn short_id(&self, table: NodeTable, id: &NodeId) -> Option<&str> {
        self.by_node
            .get(&(table, id.clone()))
            .and_then(|&index| self.nodes.get(index))
            .map(|node| node.short_id.as_str())
    }

    /// The short id the node with full id `full` goes by among these nodes — whether or not it is
    /// one of them, as a node written a moment ago is not.
    pub fn short_id_among(&self, full: &str) -> String {
        let hex = hex_digits(full).unwrap_or_default();
        let at = self.nodes.partition_point(|node| node.hex < hex);
        let before = at
            .checked_sub(1)
            .and_then(|index| self.nodes.get(index))
            .map_or(0, |node| common_prefix(&node.hex, &hex));
        let after = self
            .nodes
            .iter()
            .skip(at)
            .find(|node| node.hex != hex)
            .map_or(0, |node| common_prefix(&node.hex, &hex));
        lettered(&hex, before.max(after) + 1, full)
    }

    /// The one node the MCP can see whose full id starts with `text` — a short id, a longer
    /// prefix, or the full id, with or without its hyphens. An exact full id wins outright.
    pub fn resolve(&self, text: &str) -> Result<&Named, IdRefusal> {
        let Some(wanted) = hex_digits(text.trim()) else {
            return Err(IdRefusal::Unknown);
        };
        if wanted.len() < SHORTEST {
            return Err(IdRefusal::Unknown);
        }
        let matches: Vec<&Named> = self
            .nodes
            .iter()
            .filter(|node| node.hex.starts_with(&wanted))
            .collect();
        if let Some(exact) = matches.iter().find(|node| node.hex == wanted) {
            return Ok(*exact);
        }
        match matches.as_slice() {
            [] => Err(IdRefusal::Unknown),
            [one] => Ok(*one),
            several => Err(IdRefusal::Ambiguous(
                several.iter().map(|node| (*node).clone()).collect(),
            )),
        }
    }
}

/// The short id `hex` goes by when `unique` digits tell it apart: that prefix, at least
/// [`SHORTEST`] long, and **never all digits** — extended until it holds a hex letter.
///
/// An all-digit string is one an MCP client may send as a number, against a node-id schema that
/// takes a row id or a string, and a number is read as a row id — so `"269"` would name row 269.
/// Extending keeps the prefix unique (it only grows past the point where it already was) and
/// deterministic. A full id with no letter at all, vanishingly unlikely, goes by `full`, whose
/// hyphens keep it a string.
fn lettered(hex: &str, unique: usize, full: &str) -> String {
    let length = unique.max(SHORTEST).min(hex.len());
    let is_letter = |byte: &u8| byte.is_ascii_alphabetic();
    if hex.as_bytes()[..length].iter().any(is_letter) {
        return hex[..length].to_string();
    }
    match hex.as_bytes()[length..].iter().position(is_letter) {
        Some(offset) => hex[..length + offset + 1].to_string(),
        None => full.to_string(),
    }
}

fn common_prefix(left: &str, right: &str) -> usize {
    left.bytes()
        .zip(right.bytes())
        .take_while(|(a, b)| a == b)
        .count()
}

/// The titles of the nearest visible ancestors, outermost first — at most [`PATH_SEGMENTS`], with
/// `…` for the rest — the form the server's instructions name roots in.
fn path_above(mut cursor: Option<(NodeTable, NodeId)>, titles: &Titles) -> String {
    let mut segments: Vec<&str> = Vec::new();
    let mut seen: Vec<(NodeTable, NodeId)> = Vec::new();
    let mut elided = false;
    while let Some(key) = cursor {
        let Some((title, parent)) = titles.get(&key) else {
            break;
        };
        if seen.contains(&key) {
            break;
        }
        if segments.len() == PATH_SEGMENTS {
            elided = true;
            break;
        }
        segments.push(title.as_str());
        seen.push(key);
        cursor = parent.clone();
    }
    if elided {
        segments.push("…");
    }
    segments.reverse();
    segments.join(" › ")
}

#[cfg(test)]
mod tests;
