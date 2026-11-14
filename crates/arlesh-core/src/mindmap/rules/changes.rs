//! What changed between two derived boards, and the digest that lets a client prove it holds what
//! was published (ADR 0020).
//!
//! The board is cut into **entries**: a row, a group of rows, or a map entry, each under a key both
//! sides compute (decision 11). [`diff`] compares two boards entry by entry with `PartialEq` and
//! serialises only the entries that differ; [`BoardDigests`] keeps the order-free sum of every
//! entry's FNV-1a digest, which a client recomputes from the JSON it holds.
//!
//! Pure: a function of two finished board loads.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Serialize, Serializer};

use crate::{
    block_reasons::model::BlockReason,
    domains::model::Domain,
    flows::model::{
        Flow, FlowCommitment, FlowDependency, FlowExpectation, FlowGoal, FlowItemCycle, FlowTask,
        TargetRef,
    },
    infos::model::Info,
    mindmap::model::{AgentActivity, FlowHabitEntry, MindmapLoad, NodeFacts},
    tasks::{
        lifecycle::ItemLifecycle,
        model::{Commitment, Expectation, Goal, Task, TaskDependencyEdge},
    },
};

/// One collection of the board: a [`MindmapLoad`] field that travels as entries.
///
/// `plans` and `derived_in_progress` are never sent and are not collections.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Collection {
    /// `domains`.
    Domains,
    /// `goals`.
    Goals,
    /// `tasks`.
    Tasks,
    /// `commitments`.
    Commitments,
    /// `expectations`.
    Expectations,
    /// `infos`.
    Infos,
    /// `flows`.
    Flows,
    /// `flow_goals`.
    FlowGoals,
    /// `flow_tasks`.
    FlowTasks,
    /// `flow_commitments`.
    FlowCommitments,
    /// `flow_expectations`.
    FlowExpectations,
    /// `flow_cycles`.
    FlowCycles,
    /// `flow_dependencies`.
    FlowDependencies,
    /// `block_reasons`: one entry per owner.
    BlockReasons,
    /// `task_dependencies`: one entry per dependent Task.
    TaskDependencies,
    /// `flow_instance_nodes`.
    FlowInstanceNodes,
    /// `lifecycles`.
    Lifecycles,
    /// `habits`.
    Habits,
    /// `short_ids`.
    ShortIds,
    /// `facts`.
    Facts,
    /// `agent_activity`: the one value.
    AgentActivity,
}

impl Collection {
    /// Every collection, in the order of the [`MindmapLoad`] fields.
    pub const ALL: [Collection; 21] = [
        Self::Domains,
        Self::Goals,
        Self::Tasks,
        Self::Commitments,
        Self::Expectations,
        Self::Infos,
        Self::Flows,
        Self::FlowGoals,
        Self::FlowTasks,
        Self::FlowCommitments,
        Self::FlowExpectations,
        Self::FlowCycles,
        Self::FlowDependencies,
        Self::BlockReasons,
        Self::TaskDependencies,
        Self::FlowInstanceNodes,
        Self::Lifecycles,
        Self::Habits,
        Self::ShortIds,
        Self::Facts,
        Self::AgentActivity,
    ];

    /// The collection's name on the wire: the field's name.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Domains => "domains",
            Self::Goals => "goals",
            Self::Tasks => "tasks",
            Self::Commitments => "commitments",
            Self::Expectations => "expectations",
            Self::Infos => "infos",
            Self::Flows => "flows",
            Self::FlowGoals => "flow_goals",
            Self::FlowTasks => "flow_tasks",
            Self::FlowCommitments => "flow_commitments",
            Self::FlowExpectations => "flow_expectations",
            Self::FlowCycles => "flow_cycles",
            Self::FlowDependencies => "flow_dependencies",
            Self::BlockReasons => "block_reasons",
            Self::TaskDependencies => "task_dependencies",
            Self::FlowInstanceNodes => "flow_instance_nodes",
            Self::Lifecycles => "lifecycles",
            Self::Habits => "habits",
            Self::ShortIds => "short_ids",
            Self::Facts => "facts",
            Self::AgentActivity => "agent_activity",
        }
    }

    /// The collection named `name` on the wire, if there is one.
    pub fn from_name(name: &str) -> Option<Collection> {
        Self::ALL
            .into_iter()
            .find(|collection| collection.as_str() == name)
    }
}

/// The value of one entry, borrowed from the board it was cut from.
#[derive(Debug, PartialEq)]
pub enum EntryValue<'a> {
    /// A `domains` row.
    Domain(&'a Domain),
    /// A `goals` row.
    Goal(&'a Goal),
    /// A `tasks` row.
    Task(&'a Task),
    /// A `commitments` row.
    Commitment(&'a Commitment),
    /// An `expectations` row.
    Expectation(&'a Expectation),
    /// An `infos` row.
    Info(&'a Info),
    /// A `flows` row.
    Flow(&'a Flow),
    /// A `flow_goals` row.
    FlowGoal(&'a FlowGoal),
    /// A `flow_tasks` row.
    FlowTask(&'a FlowTask),
    /// A `flow_commitments` row.
    FlowCommitment(&'a FlowCommitment),
    /// A `flow_expectations` row.
    FlowExpectation(&'a FlowExpectation),
    /// A `flow_cycles` row.
    FlowCycle(&'a FlowItemCycle),
    /// A `flow_dependencies` row.
    FlowDependency(&'a FlowDependency),
    /// All the block reasons of one owner, in board order.
    BlockReasons(Vec<&'a BlockReason>),
    /// All the dependency edges of one Task, in board order.
    TaskDependencies(Vec<&'a TaskDependencyEdge>),
    /// A `flow_instance_nodes` row.
    FlowInstanceNode(&'a TargetRef),
    /// A `lifecycles` row.
    Lifecycle(&'a ItemLifecycle),
    /// A `habits` row.
    Habit(&'a FlowHabitEntry),
    /// A `short_ids` map entry.
    ShortId(&'a String),
    /// A `facts` map entry.
    Facts(&'a NodeFacts),
    /// The `agent_activity` value.
    AgentActivity(&'a AgentActivity),
}

impl Serialize for EntryValue<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Domain(value) => value.serialize(serializer),
            Self::Goal(value) => value.serialize(serializer),
            Self::Task(value) => value.serialize(serializer),
            Self::Commitment(value) => value.serialize(serializer),
            Self::Expectation(value) => value.serialize(serializer),
            Self::Info(value) => value.serialize(serializer),
            Self::Flow(value) => value.serialize(serializer),
            Self::FlowGoal(value) => value.serialize(serializer),
            Self::FlowTask(value) => value.serialize(serializer),
            Self::FlowCommitment(value) => value.serialize(serializer),
            Self::FlowExpectation(value) => value.serialize(serializer),
            Self::FlowCycle(value) => value.serialize(serializer),
            Self::FlowDependency(value) => value.serialize(serializer),
            Self::BlockReasons(value) => value.serialize(serializer),
            Self::TaskDependencies(value) => value.serialize(serializer),
            Self::FlowInstanceNode(value) => value.serialize(serializer),
            Self::Lifecycle(value) => value.serialize(serializer),
            Self::Habit(value) => value.serialize(serializer),
            Self::ShortId(value) => value.serialize(serializer),
            Self::Facts(value) => value.serialize(serializer),
            Self::AgentActivity(value) => value.serialize(serializer),
        }
    }
}

/// One entry of the board: its collection, its key and its value.
#[derive(Debug, PartialEq)]
pub struct Entry<'a> {
    /// The collection the entry belongs to.
    pub collection: Collection,
    /// The key both sides compute (ADR 0020, decision 11).
    pub key: String,
    /// The entry's value.
    pub value: EntryValue<'a>,
}

impl Entry<'_> {
    /// The value as compact JSON, exactly as the core serialises it.
    pub fn json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(&self.value)
    }
}

fn rows<'a, T>(
    out: &mut Vec<Entry<'a>>,
    collection: Collection,
    items: &'a [T],
    key: impl Fn(&T) -> String,
    value: impl Fn(&'a T) -> EntryValue<'a>,
) {
    out.extend(items.iter().map(|item| Entry {
        collection,
        key: key(item),
        value: value(item),
    }));
}

/// Items grouped under a key, keeping the order owners first appear in and the order inside each.
fn grouped<'a, T>(items: &'a [T], key: impl Fn(&T) -> String) -> Vec<(String, Vec<&'a T>)> {
    let mut groups: Vec<(String, Vec<&'a T>)> = Vec::new();
    let mut at: HashMap<String, usize> = HashMap::new();
    for item in items {
        let owner = key(item);
        match at.get(&owner) {
            Some(&index) => {
                if let Some((_, group)) = groups.get_mut(index) {
                    group.push(item);
                }
            }
            None => {
                at.insert(owner.clone(), groups.len());
                groups.push((owner, vec![item]));
            }
        }
    }
    groups
}

/// Every entry of `load`, in the order of its collections.
///
/// Destructures [`MindmapLoad`] with no `..`: a field added to the board fails to compile here
/// until it is given a collection (or named as never sent).
pub fn entries(load: &MindmapLoad) -> Vec<Entry<'_>> {
    let MindmapLoad {
        domains,
        goals,
        tasks,
        commitments,
        expectations,
        infos,
        flows,
        flow_goals,
        flow_tasks,
        flow_commitments,
        flow_expectations,
        flow_cycles,
        flow_dependencies,
        block_reasons,
        task_dependencies,
        flow_instance_nodes,
        lifecycles,
        habits,
        short_ids,
        facts,
        agent_activity,
        plans: _,
        derived_in_progress: _,
    } = load;
    let mut out = Vec::new();
    rows(
        &mut out,
        Collection::Domains,
        domains,
        |r| r.id.to_string(),
        EntryValue::Domain,
    );
    rows(
        &mut out,
        Collection::Goals,
        goals,
        |r| format!("goal-{}", r.id),
        EntryValue::Goal,
    );
    rows(
        &mut out,
        Collection::Tasks,
        tasks,
        |r| format!("task-{}", r.id),
        EntryValue::Task,
    );
    rows(
        &mut out,
        Collection::Commitments,
        commitments,
        |r| format!("commitment-{}", r.id),
        EntryValue::Commitment,
    );
    rows(
        &mut out,
        Collection::Expectations,
        expectations,
        |r| format!("expectation-{}", r.id),
        EntryValue::Expectation,
    );
    rows(
        &mut out,
        Collection::Infos,
        infos,
        |r| r.id.to_string(),
        EntryValue::Info,
    );
    rows(
        &mut out,
        Collection::Flows,
        flows,
        |r| r.id.to_string(),
        EntryValue::Flow,
    );
    rows(
        &mut out,
        Collection::FlowGoals,
        flow_goals,
        |r| r.id.to_string(),
        EntryValue::FlowGoal,
    );
    rows(
        &mut out,
        Collection::FlowTasks,
        flow_tasks,
        |r| r.id.to_string(),
        EntryValue::FlowTask,
    );
    rows(
        &mut out,
        Collection::FlowCommitments,
        flow_commitments,
        |r| r.id.to_string(),
        EntryValue::FlowCommitment,
    );
    rows(
        &mut out,
        Collection::FlowExpectations,
        flow_expectations,
        |r| r.id.to_string(),
        EntryValue::FlowExpectation,
    );
    rows(
        &mut out,
        Collection::FlowCycles,
        flow_cycles,
        |r| r.id.to_string(),
        EntryValue::FlowCycle,
    );
    rows(
        &mut out,
        Collection::FlowDependencies,
        flow_dependencies,
        |r| r.id.to_string(),
        EntryValue::FlowDependency,
    );
    for (owner, group) in grouped(block_reasons, |r| {
        format!("{}-{}", r.owner_type, r.owner_id)
    }) {
        out.push(Entry {
            collection: Collection::BlockReasons,
            key: owner,
            value: EntryValue::BlockReasons(group),
        });
    }
    for (owner, group) in grouped(task_dependencies, |r| format!("task-{}", r.task_id)) {
        out.push(Entry {
            collection: Collection::TaskDependencies,
            key: owner,
            value: EntryValue::TaskDependencies(group),
        });
    }
    rows(
        &mut out,
        Collection::FlowInstanceNodes,
        flow_instance_nodes,
        |r| format!("{}-{}", r.node_type, r.node_id),
        EntryValue::FlowInstanceNode,
    );
    rows(
        &mut out,
        Collection::Lifecycles,
        lifecycles,
        |r| format!("{}-{}", r.node_type, r.node_id),
        EntryValue::Lifecycle,
    );
    rows(
        &mut out,
        Collection::Habits,
        habits,
        |r| r.flow_id.to_string(),
        EntryValue::Habit,
    );
    // A map has no order of its own; sorting keeps the wire and the corpus the same every time.
    let mut short_ids: Vec<_> = short_ids.iter().collect();
    short_ids.sort_by_key(|(key, _)| key.as_str());
    for (key, value) in short_ids {
        out.push(Entry {
            collection: Collection::ShortIds,
            key: key.clone(),
            value: EntryValue::ShortId(value),
        });
    }
    let mut facts: Vec<_> = facts.iter().collect();
    facts.sort_by_key(|(key, _)| key.as_str());
    for (key, value) in facts {
        out.push(Entry {
            collection: Collection::Facts,
            key: key.clone(),
            value: EntryValue::Facts(value),
        });
    }
    if let Some(activity) = agent_activity {
        out.push(Entry {
            collection: Collection::AgentActivity,
            key: "agent_activity".to_string(),
            value: EntryValue::AgentActivity(activity),
        });
    }
    out
}

const FNV_OFFSET_BASIS: u32 = 0x811c_9dc5;
const FNV_PRIME: u32 = 0x0100_0193;

fn fnv(hash: u32, bytes: &[u8]) -> u32 {
    bytes.iter().fold(hash, |hash, byte| {
        (hash ^ u32::from(*byte)).wrapping_mul(FNV_PRIME)
    })
}

/// The digest of one entry: FNV-1a 32 over `collection`, a zero byte, `key`, a zero byte and the
/// entry's compact `json`, as UTF-8.
pub fn digest(collection: Collection, key: &str, json: &str) -> u32 {
    let hash = fnv(FNV_OFFSET_BASIS, collection.as_str().as_bytes());
    let hash = fnv(hash, &[0]);
    let hash = fnv(hash, key.as_bytes());
    let hash = fnv(hash, &[0]);
    fnv(hash, json.as_bytes())
}

/// The changes inside one collection: entries to set (by key, as compact JSON) and keys to drop.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CollectionChanges {
    /// Entries added or replaced: `(key, compact JSON of the value)`.
    pub set: Vec<(String, String)>,
    /// Keys of the entries gone.
    pub del: Vec<String>,
}

impl CollectionChanges {
    fn is_empty(&self) -> bool {
        self.set.is_empty() && self.del.is_empty()
    }
}

/// What changed between two boards, by collection. Collections that did not change are absent.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BoardChanges {
    /// The changes of each collection that has any.
    pub by_collection: BTreeMap<Collection, CollectionChanges>,
}

fn json_string(text: &str) -> Result<String, serde_json::Error> {
    serde_json::to_string(text)
}

impl BoardChanges {
    /// Whether nothing changed.
    pub fn is_empty(&self) -> bool {
        self.by_collection.values().all(CollectionChanges::is_empty)
    }

    /// The size in bytes of [`Self::to_json`], computed without building it.
    pub fn wire_len(&self) -> usize {
        self.to_json().map(|json| json.len()).unwrap_or(usize::MAX)
    }

    /// The changes as the change event carries them (ADR 0020, decision 16): an object from
    /// collection to `{"set": [[key, value], ...], "del": [key, ...]}`. Values are written raw.
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        let mut out = String::from("{");
        let mut first = true;
        for (collection, changes) in &self.by_collection {
            if changes.is_empty() {
                continue;
            }
            if !first {
                out.push(',');
            }
            first = false;
            out.push_str(&json_string(collection.as_str())?);
            out.push_str(":{\"set\":[");
            for (index, (key, json)) in changes.set.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push('[');
                out.push_str(&json_string(key)?);
                out.push(',');
                out.push_str(json);
                out.push(']');
            }
            out.push_str("],\"del\":[");
            for (index, key) in changes.del.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push_str(&json_string(key)?);
            }
            out.push_str("]}");
        }
        out.push('}');
        Ok(out)
    }
}

/// What changed from `prev` to `next`: every entry of `next` that is new or unequal to `prev`'s,
/// and the keys of `prev`'s entries `next` no longer has. Only the changed values are serialised.
pub fn diff(prev: &MindmapLoad, next: &MindmapLoad) -> Result<BoardChanges, serde_json::Error> {
    let before = entries(prev);
    let after = entries(next);
    let held: HashMap<(Collection, &str), &Entry<'_>> = before
        .iter()
        .map(|entry| ((entry.collection, entry.key.as_str()), entry))
        .collect();
    let mut changes = BoardChanges::default();
    let mut present: HashSet<(Collection, &str)> = HashSet::new();
    for entry in &after {
        present.insert((entry.collection, entry.key.as_str()));
        let unchanged = held
            .get(&(entry.collection, entry.key.as_str()))
            .is_some_and(|old| old.value == entry.value);
        if !unchanged {
            changes
                .by_collection
                .entry(entry.collection)
                .or_default()
                .set
                .push((entry.key.clone(), entry.json()?));
        }
    }
    for entry in &before {
        if !present.contains(&(entry.collection, entry.key.as_str())) {
            changes
                .by_collection
                .entry(entry.collection)
                .or_default()
                .del
                .push(entry.key.clone());
        }
    }
    Ok(changes)
}

/// The digest of every entry of a board, and their order-free sums: per collection and in all.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BoardDigests {
    by_entry: HashMap<(Collection, String), u32>,
    sums: BTreeMap<Collection, u32>,
    total: u32,
}

impl BoardDigests {
    /// Digests every entry of `load`, serialising each once.
    pub fn seed(load: &MindmapLoad) -> Result<Self, serde_json::Error> {
        let mut digests = Self::default();
        for entry in entries(load) {
            let json = entry.json()?;
            let entry_digest = digest(entry.collection, &entry.key, &json);
            digests.put(entry.collection, entry.key, entry_digest);
        }
        Ok(digests)
    }

    /// Takes `changes` into the digests: the digest of each dropped or replaced entry leaves the
    /// sums, the digest of each set entry joins them.
    pub fn apply(&mut self, changes: &BoardChanges) {
        for (collection, change) in &changes.by_collection {
            for key in &change.del {
                self.remove(*collection, key);
            }
            for (key, json) in &change.set {
                self.remove(*collection, key);
                self.put(*collection, key.clone(), digest(*collection, key, json));
            }
        }
    }

    /// The sum of every entry's digest, wrapping at 2^32: the board hash.
    pub fn total(&self) -> u32 {
        self.total
    }

    /// The sum of each collection's digests.
    pub fn sums(&self) -> &BTreeMap<Collection, u32> {
        &self.sums
    }

    fn put(&mut self, collection: Collection, key: String, digest: u32) {
        self.total = self.total.wrapping_add(digest);
        let sum = self.sums.entry(collection).or_insert(0);
        *sum = sum.wrapping_add(digest);
        self.by_entry.insert((collection, key), digest);
    }

    fn remove(&mut self, collection: Collection, key: &str) {
        let Some(old) = self.by_entry.remove(&(collection, key.to_string())) else {
            return;
        };
        self.total = self.total.wrapping_sub(old);
        if let Some(sum) = self.sums.get_mut(&collection) {
            *sum = sum.wrapping_sub(old);
        }
    }
}

#[cfg(test)]
mod tests;
