//! Block-reason resource model — an ordered list of explicit reasons a task or goal is blocked.

use serde::{Deserialize, Serialize};

/// A single explicit block reason attached to a task or goal.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockReason {
    /// Owning node kind: `task` or `goal`.
    pub owner_type: String,
    /// Owning node database id.
    pub owner_id: i64,
    /// The reason text.
    pub reason: String,
    /// Order among the owner's reasons.
    pub position: i64,
}
