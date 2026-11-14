//! What a notification can tell of, held as the board's changed nodes arrive.
//!
//! A [`BoardView`] keeps only the few fields of the board the push rules read: each Task's title,
//! whether it is generated and whether it is done; each Task's Overdue and archival state; the
//! open question under each Task; and which nodes the agent capacity lock blocks. It is built from
//! a whole board ([`BoardView::from_load`], or [`BoardView::from_json`] for a board as a host
//! published it) and kept true by the change events that follow ([`BoardView::apply`], ADR 0020).
//! Either way [`BoardView::observed`] reads the same facts, so a device that follows change events
//! is told what a server that derives the board would tell it.

use std::collections::{HashMap, HashSet};

use serde::Deserialize;
use serde_json::Value;

use crate::{
    block_reasons::model::{BlockReason, DerivedBlock},
    mindmap::model::{MindmapLoad, NodeFacts},
    nodes::origin::Origin,
    tasks::{
        lifecycle::{Archival, ItemLifecycle},
        model::{AgenticStatus, Status, Task, TaskStatus},
    },
};

use super::super::model::{Channel, Observed, PushEvent};

/// Why a change event could not be applied: its entries were not what the board's types say.
#[derive(Debug, thiserror::Error)]
#[error("the {collection} entry {key} could not be read: {source}")]
pub struct ViewError {
    /// The collection the entry belongs to.
    pub collection: &'static str,
    /// The entry's key.
    pub key: String,
    /// What was wrong with it.
    #[source]
    pub source: serde_json::Error,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TaskRow {
    title: String,
    generated: bool,
    done: bool,
}

impl From<&Task> for TaskRow {
    fn from(task: &Task) -> Self {
        Self {
            title: task.title.clone(),
            generated: matches!(task.origin, Origin::Habit(_) | Origin::Check(_)),
            done: matches!(
                task.status,
                Status::Ordinary(TaskStatus::Done) | Status::Agentic(AgenticStatus::Done)
            ),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LifecycleRow {
    overdue: bool,
    live: bool,
}

/// The slice of a board the push rules read. See the module's documentation.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BoardView {
    tasks: HashMap<String, TaskRow>,
    lifecycles: HashMap<String, LifecycleRow>,
    questions: HashMap<String, String>,
    capacity_blocked: HashSet<String>,
}

fn task_key(lifecycle: &ItemLifecycle) -> Option<String> {
    (lifecycle.node_type == "task").then(|| format!("task-{}", lifecycle.node_id))
}

fn lifecycle_row(lifecycle: &ItemLifecycle) -> LifecycleRow {
    LifecycleRow {
        overdue: lifecycle.overdue,
        live: lifecycle.archival == Archival::Live,
    }
}

fn blocks_by_capacity(reasons: &[BlockReason]) -> bool {
    reasons
        .iter()
        .any(|reason| reason.derived == Some(DerivedBlock::AgentCapacity))
}

fn entry<T: for<'de> Deserialize<'de>>(
    collection: &'static str,
    key: &str,
    value: &Value,
) -> Result<T, ViewError> {
    T::deserialize(value).map_err(|source| ViewError {
        collection,
        key: key.to_owned(),
        source,
    })
}

impl BoardView {
    /// The view of a whole derived board.
    pub fn from_load(load: &MindmapLoad) -> Self {
        let mut view = Self::default();
        for task in &load.tasks {
            view.tasks
                .insert(format!("task-{}", task.id), TaskRow::from(task));
        }
        for lifecycle in &load.lifecycles {
            if let Some(key) = task_key(lifecycle) {
                view.lifecycles.insert(key, lifecycle_row(lifecycle));
            }
        }
        for (key, facts) in &load.facts {
            if let Some(question) = &facts.open_question {
                view.questions.insert(key.clone(), question.to_string());
            }
        }
        for reason in &load.block_reasons {
            if reason.derived == Some(DerivedBlock::AgentCapacity) {
                view.capacity_blocked
                    .insert(format!("{}-{}", reason.owner_type, reason.owner_id));
            }
        }
        view
    }

    /// The view of a whole board as JSON, the way a host publishes it (`GET /board/current`).
    pub fn from_json(board: &Value) -> Result<Self, ViewError> {
        let mut view = Self::default();
        let mut changes = serde_json::Map::new();
        for collection in ["tasks", "lifecycles", "facts", "block_reasons"] {
            changes.insert(collection.to_owned(), whole_collection(board, collection));
        }
        view.apply(&Value::Object(changes))?;
        Ok(view)
    }

    /// Applies one change event's changes: an object from collection name to
    /// `{"set": [[key, value], ...], "del": [key, ...]}`. Collections the rules do not read are
    /// skipped. Nothing is half applied: on an error the view is left as it was.
    pub fn apply(&mut self, changes: &Value) -> Result<(), ViewError> {
        let mut next = self.clone();
        next.apply_all(changes)?;
        *self = next;
        Ok(())
    }

    fn apply_all(&mut self, changes: &Value) -> Result<(), ViewError> {
        for (name, collection) in sets_and_dels(changes) {
            for key in &collection.del {
                self.remove(name, key);
            }
            for (key, value) in &collection.set {
                self.set(name, key, value)?;
            }
        }
        Ok(())
    }

    fn remove(&mut self, collection: &str, key: &str) {
        match collection {
            "tasks" => self.tasks.remove(key).is_some(),
            "lifecycles" => self.lifecycles.remove(key).is_some(),
            "facts" => self.questions.remove(key).is_some(),
            "block_reasons" => self.capacity_blocked.remove(key),
            _ => false,
        };
    }

    fn set(&mut self, collection: &str, key: &str, value: &Value) -> Result<(), ViewError> {
        match collection {
            "tasks" => {
                let task: Task = entry("tasks", key, value)?;
                self.tasks.insert(key.to_owned(), TaskRow::from(&task));
            }
            "lifecycles" => {
                let lifecycle: ItemLifecycle = entry("lifecycles", key, value)?;
                if task_key(&lifecycle).is_some() {
                    self.lifecycles
                        .insert(key.to_owned(), lifecycle_row(&lifecycle));
                }
            }
            "facts" => {
                let facts: NodeFacts = entry("facts", key, value)?;
                match facts.open_question {
                    Some(question) => self.questions.insert(key.to_owned(), question.to_string()),
                    None => self.questions.remove(key),
                };
            }
            "block_reasons" => {
                let reasons: Vec<BlockReason> = entry("block_reasons", key, value)?;
                if blocks_by_capacity(&reasons) {
                    self.capacity_blocked.insert(key.to_owned());
                } else {
                    self.capacity_blocked.remove(key);
                }
            }
            _ => {}
        }
        Ok(())
    }

    /// Whether any node is blocked by the agent capacity lock: how a device with no agents of its
    /// own reads the lock off the board.
    pub fn capacity_locked(&self) -> bool {
        !self.capacity_blocked.is_empty()
    }

    /// The facts a notification could tell of, in key order. `at_capacity` is whether the lock is
    /// set.
    pub fn observed(&self, at_capacity: bool) -> Observed {
        let about = |key: &str, task: &TaskRow, prefix: &str, id: &str, channel| PushEvent {
            key: format!("{prefix}:{id}"),
            value: String::new(),
            channel,
            task: Some(key.to_owned()),
            title: Some(task.title.clone()),
        };
        let mut facts = Vec::new();
        for (key, question) in &self.questions {
            if let Some(task) = self.tasks.get(key) {
                facts.push(about(
                    key,
                    task,
                    "question",
                    question,
                    Channel::AgentQuestion,
                ));
            }
        }
        for (key, lifecycle) in &self.lifecycles {
            let Some(task) = self.tasks.get(key) else {
                continue;
            };
            let id = key.strip_prefix("task-").unwrap_or(key);
            if lifecycle.overdue {
                facts.push(about(key, task, "overdue", id, Channel::TaskOverdue));
            }
            if task.generated && !task.done && lifecycle.live {
                facts.push(about(key, task, "generated", id, Channel::TaskGenerated));
            }
        }
        facts.sort_by(|a, b| a.key.cmp(&b.key));
        Observed {
            facts,
            capacity_locked: at_capacity,
        }
    }
}

struct CollectionChanges {
    set: Vec<(String, Value)>,
    del: Vec<String>,
}

/// The collections of `changes` the view reads, with their entries. A malformed shape reads as no
/// change: the entries inside are what is checked.
fn sets_and_dels(changes: &Value) -> Vec<(&'static str, CollectionChanges)> {
    ["tasks", "lifecycles", "facts", "block_reasons"]
        .into_iter()
        .filter_map(|name| {
            let body = changes.get(name)?;
            let set = body
                .get("set")
                .and_then(Value::as_array)
                .map(|pairs| {
                    pairs
                        .iter()
                        .filter_map(|pair| {
                            let pair = pair.as_array()?;
                            Some((pair.first()?.as_str()?.to_owned(), pair.get(1)?.clone()))
                        })
                        .collect()
                })
                .unwrap_or_default();
            let del = body
                .get("del")
                .and_then(Value::as_array)
                .map(|keys| {
                    keys.iter()
                        .filter_map(|key| key.as_str().map(str::to_owned))
                        .collect()
                })
                .unwrap_or_default();
            Some((name, CollectionChanges { set, del }))
        })
        .collect()
}

/// A whole collection of a board as the `set` of a change: one entry per row, keyed as the board
/// keys it (`task-12`; a map collection is already keyed; block reasons group by owner).
fn whole_collection(board: &Value, collection: &str) -> Value {
    let Some(body) = board.get(collection) else {
        return Value::Null;
    };
    let pairs: Vec<Value> = match body {
        Value::Object(map) => map
            .iter()
            .map(|(key, value)| Value::Array(vec![Value::String(key.clone()), value.clone()]))
            .collect(),
        Value::Array(rows) if collection == "block_reasons" => group_by_owner(rows),
        Value::Array(rows) => rows
            .iter()
            .filter_map(|row| {
                Some(Value::Array(vec![
                    Value::String(row_key(collection, row)?),
                    row.clone(),
                ]))
            })
            .collect(),
        _ => Vec::new(),
    };
    serde_json::json!({ "set": pairs })
}

fn row_key(collection: &str, row: &Value) -> Option<String> {
    match collection {
        "tasks" => Some(format!("task-{}", id_text(row.get("id")?)?)),
        "lifecycles" => Some(format!(
            "{}-{}",
            row.get("node_type")?.as_str()?,
            id_text(row.get("node_id")?)?
        )),
        _ => None,
    }
}

fn group_by_owner(rows: &[Value]) -> Vec<Value> {
    let mut owners: Vec<(String, Vec<Value>)> = Vec::new();
    for row in rows {
        let (Some(kind), Some(id)) = (
            row.get("owner_type").and_then(Value::as_str),
            row.get("owner_id").and_then(id_text),
        ) else {
            continue;
        };
        let owner = format!("{kind}-{id}");
        match owners.iter_mut().find(|(key, _)| *key == owner) {
            Some((_, group)) => group.push(row.clone()),
            None => owners.push((owner, vec![row.clone()])),
        }
    }
    owners
        .into_iter()
        .map(|(owner, group)| Value::Array(vec![Value::String(owner), Value::Array(group)]))
        .collect()
}

/// A [`NodeId`](crate::nodes::id::NodeId) as the text of its key: a number or a string.
fn id_text(id: &Value) -> Option<String> {
    match id {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests;
