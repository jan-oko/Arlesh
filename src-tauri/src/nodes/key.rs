//! A derived node's **value key**: what it is derived from, spelled out.
//!
//! The key is the data; the UUID ([`super::id`]) is only its hash. An occurrence of a Habit is
//! keyed by the template item it is drawn from, the iteration it is in — named by the value key of
//! the scope anchoring that iteration's window (ADR 0009), which spells the date it starts on —
//! and the cycle pair that drew it.
//!
//! A wait's derived rows are keyed the same way: a **check task** by the wait it checks on and when
//! that check fell due, a Task's **spawned wait** by the Task, and a delegated Task's **wait on its
//! delegate** by the Task.
//!
//! Every key has one canonical string spelling, [`DerivedKey::node_key`]. It is what the overlay
//! tables generate as their `node_key` column, what the relation tables store, and what the UUID
//! is hashed from, so the three can never disagree about which node they mean.

use std::fmt;

use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};

use super::id::{DerivedId, NodeId};
use crate::scopes::key::ScopeKey;
use crate::tasks::waits::{instant_column, WaitRef};

/// The cycle-pair sentinel of an occurrence no pair drew: the root, and an item declaring none.
pub const NO_CYCLE: i64 = 0;

/// Which template row an occurrence is drawn from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TemplateKind {
    /// The flow itself: an iteration's root is drawn from the flow row.
    FlowRoot,
    /// A flow goal item.
    FlowGoal,
    /// A flow task item.
    FlowTask,
}

impl TemplateKind {
    /// The spelling the overlay tables store in `item_type`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::FlowRoot => "flow_root",
            Self::FlowGoal => "flow_goal",
            Self::FlowTask => "flow_task",
        }
    }

    /// Parses an `item_type` column.
    pub fn from_db(value: &str) -> Option<Self> {
        match value {
            "flow_root" => Some(Self::FlowRoot),
            "flow_goal" => Some(Self::FlowGoal),
            "flow_task" => Some(Self::FlowTask),
            _ => None,
        }
    }
}

impl fmt::Display for TemplateKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// One template row: a flow (for an iteration root) or one of its items.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct TemplateItem {
    /// Which template table.
    pub item_type: TemplateKind,
    /// The row's id — the flow's own id for a root.
    pub item_id: i64,
}

/// One occurrence of a Habit: a template item in one iteration, drawn by one cycle pair.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct OccurrenceKey {
    /// The template row the occurrence is drawn from.
    pub item: TemplateItem,
    /// The scope anchoring the occurrence's iteration.
    pub iteration: ScopeKey,
    /// The cycle pair that drew it, or [`NO_CYCLE`].
    pub cycle: i64,
}

impl OccurrenceKey {
    /// The canonical spelling: `flow_task:12:week:2026-09-20:3` — item type, item id, the
    /// iteration's scope key, and the cycle pair.
    pub fn node_key(&self) -> String {
        format!(
            "{}:{}:{}:{}",
            self.item.item_type.as_str(),
            self.item.item_id,
            self.iteration,
            self.cycle
        )
    }

    /// Parses a canonical spelling back into the key. The scope key in the middle may itself hold
    /// colons, so the item is read off the front and the cycle pair off the back.
    pub fn parse(node_key: &str) -> Option<Self> {
        let mut front = node_key.splitn(3, ':');
        let item_type = TemplateKind::from_db(front.next()?)?;
        let item_id = front.next()?.parse().ok()?;
        let (scope, cycle) = front.next()?.rsplit_once(':')?;
        Some(Self {
            item: TemplateItem { item_type, item_id },
            iteration: scope.parse().ok()?,
            cycle: cycle.parse().ok()?,
        })
    }

    /// The row id the occurrence travels under.
    pub fn id(&self) -> DerivedId {
        DerivedId::of_key(&self.node_key())
    }
}

/// One check on a wait: the wait, and when the check fell due — which names it.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CheckKey {
    /// The wait: a stored Expectation, or the wait a stored Task or a Habit occurrence spawned.
    pub wait: WaitRef,
    /// When the check fell due.
    pub due_at: NaiveDateTime,
}

impl CheckKey {
    /// The canonical spelling: `check:stored:5@2026-09-20T09:00:00` — what `task_overlays`
    /// generates as `'check:' || wait_key || '@' || due_at`.
    pub fn node_key(&self) -> String {
        format!("check:{}@{}", self.wait_key(), instant_column(self.due_at))
    }

    /// The wait's own spelling, `stored:5`: the overlay's `wait_key` column.
    pub fn wait_key(&self) -> String {
        self.wait.spelling()
    }

    fn parse(rest: &str) -> Option<Self> {
        let (wait, due_at) = rest.rsplit_once('@')?;
        Some(Self {
            wait: WaitRef::parse(wait)?,
            due_at: NaiveDateTime::parse_from_str(due_at, "%Y-%m-%dT%H:%M:%S").ok()?,
        })
    }
}

/// A row id read back from its spelling: an integer is a stored row, anything else a UUID.
fn node_id_of(spelling: &str) -> NodeId {
    match spelling.parse::<i64>() {
        Ok(id) => NodeId::Stored(id),
        Err(_) => NodeId::Derived(DerivedId::from_existing(spelling)),
    }
}

/// What a derived node is derived from — its value key, whichever derivation made it.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum DerivedKey {
    /// A Habit occurrence.
    Occurrence(OccurrenceKey),
    /// A check task on a wait.
    Check(CheckKey),
    /// The wait an Asynchronous Task spawned, by the Task — stored, or a Habit occurrence.
    SpawnedWait(NodeId),
    /// The wait a delegated Task has on its delegate, by the Task — stored or itself derived.
    DelegationWait(NodeId),
}

impl DerivedKey {
    /// The canonical spelling every table stores and the UUID is hashed from.
    pub fn node_key(&self) -> String {
        match self {
            Self::Occurrence(key) => key.node_key(),
            Self::Check(key) => key.node_key(),
            Self::SpawnedWait(task) => format!("spawned_wait:{task}"),
            Self::DelegationWait(task) => format!("delegation_wait:{task}"),
        }
    }

    /// Parses a canonical spelling.
    pub fn parse(node_key: &str) -> Option<Self> {
        let (head, rest) = node_key.split_once(':')?;
        match head {
            "check" => CheckKey::parse(rest).map(Self::Check),
            "spawned_wait" => Some(Self::SpawnedWait(node_id_of(rest))),
            "delegation_wait" => Some(Self::DelegationWait(node_id_of(rest))),
            _ => OccurrenceKey::parse(node_key).map(Self::Occurrence),
        }
    }

    /// The row id the node travels under.
    pub fn id(&self) -> DerivedId {
        DerivedId::of_key(&self.node_key())
    }

    /// [`Self::id`], as the [`NodeId`] a row carries.
    pub fn node_id(&self) -> NodeId {
        NodeId::Derived(self.id())
    }

    /// The occurrence key, when this is one.
    pub fn occurrence(&self) -> Option<&OccurrenceKey> {
        match self {
            Self::Occurrence(key) => Some(key),
            _ => None,
        }
    }
}

impl From<OccurrenceKey> for DerivedKey {
    fn from(key: OccurrenceKey) -> Self {
        Self::Occurrence(key)
    }
}

impl From<CheckKey> for DerivedKey {
    fn from(key: CheckKey) -> Self {
        Self::Check(key)
    }
}

#[cfg(test)]
mod tests;
