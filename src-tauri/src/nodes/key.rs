//! A derived node's **value key**: what it is derived from, spelled out.
//!
//! The key is the data; the UUID ([`super::id`]) is only its hash. An occurrence of a Habit is
//! keyed by the template item it is drawn from, the **date** its iteration starts on, and the
//! cycle pair that drew it — a date and not a scope row id, so the key survives scopes being
//! derived rather than stored (Arlesh-9o1).
//!
//! Every key has one canonical string spelling, [`DerivedKey::node_key`]. It is what the overlay
//! tables generate as their `node_key` column, what the relation tables store, and what the UUID
//! is hashed from, so the three can never disagree about which node they mean.

use std::fmt;

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use super::id::{DerivedId, NodeId};

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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct OccurrenceKey {
    /// The template row the occurrence is drawn from.
    pub item: TemplateItem,
    /// The date the occurrence's iteration starts on.
    pub iteration: NaiveDate,
    /// The cycle pair that drew it, or [`NO_CYCLE`].
    pub cycle: i64,
}

impl OccurrenceKey {
    /// The canonical spelling: `flow_task:12:2026-09-20:3`.
    pub fn node_key(&self) -> String {
        format!(
            "{}:{}:{}:{}",
            self.item.item_type.as_str(),
            self.item.item_id,
            self.iteration.format("%Y-%m-%d"),
            self.cycle
        )
    }

    /// Parses a canonical spelling back into the key.
    pub fn parse(node_key: &str) -> Option<Self> {
        let mut parts = node_key.split(':');
        let item_type = TemplateKind::from_db(parts.next()?)?;
        let item_id = parts.next()?.parse().ok()?;
        let iteration = NaiveDate::parse_from_str(parts.next()?, "%Y-%m-%d").ok()?;
        let cycle = parts.next()?.parse().ok()?;
        if parts.next().is_some() {
            return None;
        }
        Some(Self {
            item: TemplateItem { item_type, item_id },
            iteration,
            cycle,
        })
    }

    /// The row id the occurrence travels under.
    pub fn id(&self) -> DerivedId {
        DerivedId::of_key(&self.node_key())
    }
}

/// What a derived node is derived from — its value key, whichever derivation made it.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum DerivedKey {
    /// A Habit occurrence.
    Occurrence(OccurrenceKey),
}

impl DerivedKey {
    /// The canonical spelling every table stores and the UUID is hashed from.
    pub fn node_key(&self) -> String {
        match self {
            Self::Occurrence(key) => key.node_key(),
        }
    }

    /// Parses a canonical spelling.
    pub fn parse(node_key: &str) -> Option<Self> {
        OccurrenceKey::parse(node_key).map(Self::Occurrence)
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
        }
    }
}

impl From<OccurrenceKey> for DerivedKey {
    fn from(key: OccurrenceKey) -> Self {
        Self::Occurrence(key)
    }
}

#[cfg(test)]
mod tests;
