//! **Gesture operations**: what the app does as one Gesture over several nodes, as one operation.
//!
//! On the desktop a multi-node gesture used to be a run of commands inside one open Gesture: a
//! delete of five nodes was five deletes and one Ctrl+Z. In Client mode a Gesture cannot stay open
//! across requests (the ambient Gesture is one row the whole database shares), so the user ruled
//! on 2026-10-30 that **each such gesture is its own operation and its own REST endpoint**: the
//! whole gesture runs server-side in one request — one transaction, one Gesture, one undo step on
//! the calling client's stack. The app calls the same operation in Standalone mode, so both modes
//! run one implementation. See `docs/spec/client-mode.md`, *Undo*.
//!
//! Each operation takes the session its caller opened and does not commit: the caller's
//! transaction is the gesture's.

use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};

use crate::{
    database::session::{Db, Transactional},
    domains::model::DomainId,
    error::WireError,
    flows::model::{FlowId, FlowItemType},
    nodes::{composite, id::NodeId, write},
};

/// One node a gesture acts on: its kind, as the board names it, and its id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct GestureNode {
    /// `task`, `goal`, `commitment`, `expectation`, `info`, `flow`, a flow item kind
    /// (`flow_task`…), or `domain`, `project` or `tag`.
    pub kind: String,
    /// Its id: a row id, or a derived node's UUID where the kind has derived rows.
    pub id: NodeId,
}

/// Deletes every node in `nodes`, in order, as one gesture: a multi-selection, or a subtree the
/// confirm dialog expanded into its nodes. All or nothing: the first refusal rolls back the whole
/// transaction its caller opened.
pub async fn delete_nodes(
    db: &mut Db<Transactional>,
    nodes: &[GestureNode],
    now: NaiveDateTime,
) -> Result<(), WireError> {
    for node in nodes {
        delete_one(db, node, now).await?;
    }
    Ok(())
}

async fn delete_one(
    db: &mut Db<Transactional>,
    node: &GestureNode,
    now: NaiveDateTime,
) -> Result<(), WireError> {
    let kind = node.kind.as_str();
    match kind {
        "task" | "goal" | "commitment" => write::delete(db, kind, &node.id, now)
            .await
            .map_err(WireError::from_error),
        "expectation" => composite::delete_wait(db, &node.id, now).await,
        "info" => composite::delete_info(db, stored(node)?).await,
        "flow" => crate::flows::delete_flow(db, FlowId(stored(node)?))
            .await
            .map_err(WireError::from_error),
        "flow_goal" => delete_item(db, FlowItemType::FlowGoal, node).await,
        "flow_task" => delete_item(db, FlowItemType::FlowTask, node).await,
        "flow_commitment" => delete_item(db, FlowItemType::FlowCommitment, node).await,
        "flow_expectation" => delete_item(db, FlowItemType::FlowExpectation, node).await,
        "domain" | "project" | "tag" => db
            .domains()
            .delete(DomainId(stored(node)?))
            .await
            .map_err(WireError::from_error),
        other => Err(WireError::invalid_request(format!(
            "a {other} cannot be deleted"
        ))),
    }
}

/// The stored row id a kind with no derived rows is named by.
fn stored(node: &GestureNode) -> Result<i64, WireError> {
    node.id.stored().ok_or_else(|| {
        WireError::invalid_request(format!("a derived {} cannot be deleted by id", node.kind))
    })
}

async fn delete_item(
    db: &mut Db<Transactional>,
    item_type: FlowItemType,
    node: &GestureNode,
) -> Result<(), WireError> {
    db.flows()
        .delete_item(item_type, stored(node)?)
        .await
        .map_err(WireError::from_error)
}
