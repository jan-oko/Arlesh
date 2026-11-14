//! What a phone is told, and when: the pure half of push notifications.
//!
//! [`observe`] reads the facts a notification could tell of off a derived board, and [`plan`]
//! compares them with what a device was already told. The server looks again whenever the board
//! changes and whenever time may have moved it (a part of day begins, a day starts), and each look
//! is these two functions: nothing here reads a clock or a database.

use std::collections::{HashMap, HashSet};

use crate::{
    mindmap::model::MindmapLoad,
    nodes::origin::Origin,
    tasks::{
        lifecycle::{Archival, ItemLifecycle},
        model::{AgenticStatus, Status, Task, TaskStatus},
    },
};

use super::model::{Channel, Observed, Plan, PushEvent, SentEntry, CAPACITY_KEY};

const LOCKED: &str = "locked";
const CLEAR: &str = "clear";

/// The facts of `load` a notification could tell of, in key order.
pub fn observe(load: &MindmapLoad, at_capacity: bool) -> Observed {
    let by_key: HashMap<String, &Task> = load
        .tasks
        .iter()
        .map(|task| (format!("task-{}", task.id), task))
        .collect();
    let lifecycles: HashMap<String, &ItemLifecycle> = load
        .lifecycles
        .iter()
        .filter(|lifecycle| lifecycle.node_type == "task")
        .map(|lifecycle| (format!("task-{}", lifecycle.node_id), lifecycle))
        .collect();
    let about = |key: &str, task: &Task, prefix: &str, id: String, channel| PushEvent {
        key: format!("{prefix}:{id}"),
        value: String::new(),
        channel,
        task: Some(key.to_owned()),
        title: Some(task.title.clone()),
    };

    let mut facts = Vec::new();
    for (key, node) in &load.facts {
        let (Some(question), Some(task)) = (&node.open_question, by_key.get(key)) else {
            continue;
        };
        facts.push(about(
            key,
            task,
            "question",
            question.to_string(),
            Channel::AgentQuestion,
        ));
    }
    for (key, lifecycle) in &lifecycles {
        let Some(task) = by_key.get(key) else {
            continue;
        };
        if lifecycle.overdue {
            facts.push(about(
                key,
                task,
                "overdue",
                task.id.to_string(),
                Channel::TaskOverdue,
            ));
        }
        if is_generated(task) && !is_done(task) && lifecycle.archival == Archival::Live {
            facts.push(about(
                key,
                task,
                "generated",
                task.id.to_string(),
                Channel::TaskGenerated,
            ));
        }
    }
    facts.sort_by(|a, b| a.key.cmp(&b.key));
    Observed {
        facts,
        capacity_locked: at_capacity,
    }
}

fn is_generated(task: &Task) -> bool {
    matches!(task.origin, Origin::Habit(_) | Origin::Check(_))
}

fn is_done(task: &Task) -> bool {
    matches!(
        task.status,
        Status::Ordinary(TaskStatus::Done) | Status::Agentic(AgenticStatus::Done)
    )
}

/// What a device that was told `sent` is to be told now.
pub fn plan(observed: &Observed, sent: &[SentEntry]) -> Plan {
    let told: HashMap<&str, &str> = sent
        .iter()
        .map(|entry| (entry.key.as_str(), entry.value.as_str()))
        .collect();
    let holding: HashSet<&str> = observed
        .facts
        .iter()
        .map(|fact| fact.key.as_str())
        .collect();

    let mut send: Vec<PushEvent> = observed
        .facts
        .iter()
        .filter(|fact| !told.contains_key(fact.key.as_str()))
        .cloned()
        .collect();
    if let Some(change) = lock_change(observed, &told) {
        send.push(change);
    }
    let forget = sent
        .iter()
        .filter(|entry| entry.key != CAPACITY_KEY && !holding.contains(entry.key.as_str()))
        .map(|entry| entry.key.clone())
        .collect();
    Plan { send, forget }
}

/// The lock's change since the device was told, if it changed. A device never told of the lock
/// counts as told it was clear.
fn lock_change(observed: &Observed, told: &HashMap<&str, &str>) -> Option<PushEvent> {
    let now = if observed.capacity_locked {
        LOCKED
    } else {
        CLEAR
    };
    let before = told.get(CAPACITY_KEY).copied().unwrap_or(CLEAR);
    (before != now).then(|| PushEvent {
        key: CAPACITY_KEY.to_owned(),
        value: now.to_owned(),
        channel: if observed.capacity_locked {
            Channel::CapacityLocked
        } else {
            Channel::CapacityCleared
        },
        task: None,
        title: None,
    })
}

/// What a device that starts being notified now is taken to have been told: everything already
/// true, so it hears only of what happens after.
pub fn baseline(observed: &Observed) -> Vec<SentEntry> {
    let mut entries: Vec<SentEntry> = observed
        .facts
        .iter()
        .map(|fact| SentEntry {
            key: fact.key.clone(),
            value: String::new(),
        })
        .collect();
    entries.push(SentEntry {
        key: CAPACITY_KEY.to_owned(),
        value: if observed.capacity_locked {
            LOCKED
        } else {
            CLEAR
        }
        .to_owned(),
    });
    entries
}

#[cfg(test)]
mod tests;
