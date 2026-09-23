//! Block-reason resource model — an ordered list of explicit reasons a task or goal is blocked.

use serde::{Deserialize, Serialize};

/// A single explicit block reason attached to a task or goal.
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
}
