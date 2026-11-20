//! Info node resource model.

use crate::nodes::id::RowId;
use serde::{Deserialize, Serialize};

use crate::nodes::id::NodeId;

/// Identifies an info row by its primary key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct InfoId(#[schemars(with = "String")] pub RowId);

impl From<RowId> for InfoId {
    fn from(value: RowId) -> Self {
        Self(value)
    }
}
impl From<InfoId> for RowId {
    fn from(id: InfoId) -> Self {
        id.0
    }
}

/// A free-text info node attached to any other node type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Info {
    /// Database primary key.
    #[schemars(with = "String")]
    pub id: RowId,
    /// The one-line text content (title) of this info node.
    pub body: String,
    /// Optional longer supporting text (e.g. an error traceback); `None` when unset.
    pub details: Option<String>,
    /// The kind of the parent node (aspect, project, domain, goal, task, commitment, tag, info).
    pub parent_type: String,
    /// The parent node: a stored row, or a derived one (a Habit occurrence).
    pub parent_id: NodeId,
    /// Display order among siblings.
    pub position: i64,
    /// Whether this node is private (hidden unless Private Mode is on).
    pub is_private: bool,
}

/// Request body for creating an info node.
#[derive(Debug, Clone, Deserialize, schemars::JsonSchema, serde::Serialize)]
pub struct CreateInfoRequest {
    /// The new row's id, chosen by the caller (a client that has already shown the row under it);
    /// the server mints one when it is absent. Must be a UUID that is not a derived node's.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::nodes::id::deserialize_chosen_id"
    )]
    #[schemars(with = "Option<String>")]
    pub id: Option<RowId>,
    /// One-line text content.
    pub body: String,
    /// Optional longer supporting text.
    #[serde(default)]
    pub details: Option<String>,
    /// Parent node kind.
    pub parent_type: String,
    /// Parent node database id.
    pub parent_id: NodeId,
    /// Display order.
    pub position: i64,
}

/// Request body for updating an info node.
#[derive(Debug, Clone, Default, Deserialize, schemars::JsonSchema, serde::Serialize)]
pub struct UpdateInfoRequest {
    /// New one-line text content, if changing.
    pub body: Option<String>,
    /// New details, if changing (`Some(None)` clears).
    #[serde(
        default,
        deserialize_with = "crate::wire::null_clears",
        skip_serializing_if = "Option::is_none"
    )]
    pub details: Option<Option<String>>,
    /// New display order, if changing.
    pub position: Option<i64>,
    /// New parent kind, if re-parenting.
    pub parent_type: Option<String>,
    /// New parent id, if re-parenting.
    pub parent_id: Option<NodeId>,
    /// New private flag, if changing.
    pub is_private: Option<bool>,
}
