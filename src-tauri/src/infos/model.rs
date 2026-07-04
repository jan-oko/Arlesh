//! Info node resource model.

use serde::{Deserialize, Serialize};

/// Identifies an info row by its primary key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct InfoId(pub i64);

impl From<i64> for InfoId {
    fn from(value: i64) -> Self {
        Self(value)
    }
}
impl From<InfoId> for i64 {
    fn from(id: InfoId) -> Self {
        id.0
    }
}

/// A free-text info node attached to any other node type.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Info {
    /// Database primary key.
    pub id: i64,
    /// The one-line text content (title) of this info node.
    pub body: String,
    /// Optional longer supporting text (e.g. an error traceback); `None` when unset.
    pub details: Option<String>,
    /// The kind of the parent node (aspect, project, domain, goal, task, tag, info).
    pub parent_type: String,
    /// The database id of the parent node.
    pub parent_id: i64,
    /// Display order among siblings.
    pub position: i64,
    /// Whether this node is marked NSFW (hidden by the Work filter).
    pub nsfw: bool,
}

/// Request body for creating an info node.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateInfoRequest {
    /// One-line text content.
    pub body: String,
    /// Optional longer supporting text.
    #[serde(default)]
    pub details: Option<String>,
    /// Parent node kind.
    pub parent_type: String,
    /// Parent node database id.
    pub parent_id: i64,
    /// Display order.
    pub position: i64,
}

/// Request body for updating an info node.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct UpdateInfoRequest {
    /// New one-line text content, if changing.
    pub body: Option<String>,
    /// New details, if changing (`Some(None)` clears).
    pub details: Option<Option<String>>,
    /// New display order, if changing.
    pub position: Option<i64>,
    /// New parent kind, if re-parenting.
    pub parent_type: Option<String>,
    /// New parent id, if re-parenting.
    pub parent_id: Option<i64>,
    /// New NSFW flag, if changing.
    pub nsfw: Option<bool>,
}
