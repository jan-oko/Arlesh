//! Block-reason resource model — an ordered list of explicit reasons a task or goal is blocked.

use serde::{Deserialize, Serialize};

/// A single block reason attached to a task or goal: one the user wrote, or — when
/// [`Self::derived`] says so — one the backend derived and nobody can edit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockReason {
    /// Owning node kind: `task` or `goal`.
    pub owner_type: String,
    /// Owning node: a stored row, or a derived one (a Habit occurrence's own list).
    pub owner_id: crate::nodes::id::NodeId,
    /// The reason text.
    pub reason: String,
    /// Order among the owner's reasons.
    pub position: i64,
    /// Why this reason was derived rather than written, when it was. Absent for a stored reason —
    /// and left off the wire then, so a board with no derived reason reads exactly as before.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derived: Option<DerivedBlock>,
}

/// What derived a [`BlockReason`] that no one wrote.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DerivedBlock {
    /// The owner is a **Compound** Task, and every one of its open counted items is blocked. It
    /// goes when one of them is unblocked or finished. See [`crate::tasks::compound`].
    Compound,
}
