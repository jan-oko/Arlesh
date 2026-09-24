//! Where a node row came from.
//!
//! Every node of a kind is one row shape, stored or derived, and **`origin`** is the one field that
//! says which (ADR 0008, decision 9). The few rules that genuinely differ for a derived row — it
//! cannot be moved out of its iteration, retyped or deleted — key off it, and nothing else does.
//! A wait's check task, a spawned wait and a delegated Task's wait are derived rows too, each with
//! an origin of its own.

use chrono::{NaiveDate, NaiveDateTime};
use serde::{Deserialize, Serialize};

use super::id::NodeId;
use super::key::TemplateKind;
use crate::flows::model::IterationStatus;
use crate::scopes::key::ScopeKey;
use crate::tasks::waits::WaitKind;

/// Where a node row came from. Discriminated on `kind` on the wire.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Origin {
    /// A stored row, made by hand (or by starting a plain Flow, which makes ordinary copies).
    #[default]
    Manual,
    /// An occurrence of a Habit, derived from its template and overlaid with what differs.
    Habit(HabitOrigin),
    /// A check on a wait: a Task drawn while the check is due, and kept, done, once it is made.
    Check(CheckOrigin),
    /// The wait an Asynchronous Task spawned when it was done, drawn from its Expectation template.
    SpawnedWait(WaitOrigin),
    /// The wait a delegated Task has on its delegate, drawn while the Task is not done.
    DelegationWait(WaitOrigin),
}

impl Origin {
    /// Whether the row is derived rather than stored.
    pub fn is_derived(&self) -> bool {
        !matches!(self, Self::Manual)
    }

    /// The Habit occurrence this row is, when it is one.
    pub fn habit(&self) -> Option<&HabitOrigin> {
        match self {
            Self::Habit(habit) => Some(habit),
            _ => None,
        }
    }
}

/// Which check on which wait a check task is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CheckOrigin {
    /// A stored Expectation's check, or one on the wait a Task spawned.
    pub wait_kind: WaitKind,
    /// The Expectation's id, or the spawning Task's.
    pub wait_id: i64,
    /// When the check fell due.
    pub due_at: NaiveDateTime,
}

/// The Task a derived wait belongs to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WaitOrigin {
    /// The Task that spawned the wait, or that is delegated.
    pub task_id: NodeId,
}

/// A Habit occurrence's provenance: which Habit, which iteration, which template row and pair.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HabitOrigin {
    /// The Habit (flow) the occurrence belongs to.
    pub habit_id: i64,
    /// The iteration the occurrence is in.
    pub iteration_scope: IterationScope,
    /// The template table the occurrence is drawn from — `flow_root` for the iteration's root.
    pub item_type: TemplateKind,
    /// The template row's id (the flow's own for the root).
    pub item_id: i64,
    /// The cycle pair that drew it, or `0`.
    pub cycle_id: i64,
}

impl HabitOrigin {
    /// Whether this occurrence is its iteration's root.
    pub fn is_root(&self) -> bool {
        self.item_type == TemplateKind::FlowRoot
    }
}

/// One iteration of a Habit, as its occurrences carry it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IterationScope {
    /// Zero-based ordinal from the Repetition Start.
    pub index: i64,
    /// The date the iteration's window starts on — the occurrence key's date.
    pub start_date: NaiveDate,
    /// The window's exclusive end.
    pub window_end: NaiveDateTime,
    /// The scope anchoring the window's first period — the occurrence key's iteration.
    pub scope_id: ScopeKey,
    /// The scope kind one period of the window is (`day`, `week`, …, `part`), the Habit's own.
    pub kind: Option<String>,
    /// The iteration's derived state at the reference instant.
    pub status: IterationStatus,
}

#[cfg(test)]
mod tests;
