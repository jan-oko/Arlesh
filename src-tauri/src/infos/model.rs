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
    /// The text content of this info node.
    pub body: String,
    /// The kind of the parent node (aspect, project, domain, goal, task, tag, info).
    pub parent_type: String,
    /// The database id of the parent node.
    pub parent_id: i64,
    /// Display order among siblings.
    pub position: i64,
}

/// Request body for creating an info node.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateInfoRequest {
    /// Text content.
    pub body: String,
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
    /// New text content, if changing.
    pub body: Option<String>,
    /// New display order, if changing.
    pub position: Option<i64>,
    /// New parent kind, if re-parenting.
    pub parent_type: Option<String>,
    /// New parent id, if re-parenting.
    pub parent_id: Option<i64>,
}
