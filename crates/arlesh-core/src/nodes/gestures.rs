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

pub mod steps;

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

/// The gesture operations made of listed writes: each its own endpoint (`POST /gestures/<name>`),
/// each one transaction and one undo step. Each admits only the writes its gesture makes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum GestureName {
    /// Paste: copies, or moves, the clipboard's nodes under a target.
    Paste,
    /// Insert parent: makes a node, then moves a node under it.
    InsertParent,
    /// A drag: moves a node, after clamping the windows the move would leave outside.
    MoveNode,
    /// Quick plan: plans or unplans a run of Tasks, each allowed to be refused alone.
    PlanTasks,
    /// A Plan View move: the same, for the rows dragged between its panes.
    PlanMove,
    /// The Task editor's Save.
    SaveTask,
    /// The Goal editor's Save.
    SaveGoal,
    /// The Commitment editor's Save.
    SaveCommitment,
    /// The Project and Domain editor's Save.
    SaveProject,
    /// The wait editor's Save.
    SaveWait,
    /// The Flow and Habit editor's Save, its *Archive & new* included.
    SaveFlow,
    /// The Flow item editor's Save.
    SaveFlowItem,
    /// The new Flow or Habit editor's Create.
    NewFlow,
    /// A hand archive or unarchive of Tasks, Commitments and Domains, as one undo step.
    ArchiveNodes,
}

impl GestureName {
    /// Every gesture operation, as the routes list them.
    pub const ALL: [GestureName; 14] = [
        GestureName::Paste,
        GestureName::InsertParent,
        GestureName::MoveNode,
        GestureName::PlanTasks,
        GestureName::PlanMove,
        GestureName::SaveTask,
        GestureName::SaveGoal,
        GestureName::SaveCommitment,
        GestureName::SaveProject,
        GestureName::SaveWait,
        GestureName::SaveFlow,
        GestureName::SaveFlowItem,
        GestureName::NewFlow,
        GestureName::ArchiveNodes,
    ];

    /// Whether this gesture makes `step`.
    fn admits(self, step: &steps::GestureStep) -> bool {
        use steps::GestureStep as S;
        match self {
            Self::Paste => matches!(step, S::Move { .. } | S::Duplicate { .. }),
            Self::InsertParent => matches!(
                step,
                S::Move { .. }
                    | S::CreateTask { .. }
                    | S::CreateGoal { .. }
                    | S::CreateCommitment { .. }
                    | S::CreateInfo { .. }
                    | S::CreateDomain { .. }
                    | S::CreateFlowItem { .. }
            ),
            Self::MoveNode => matches!(
                step,
                S::Move { .. } | S::UpdateTask { .. } | S::UpdateGoal { .. }
            ),
            // A hand archive is an update of the node's archival state: nothing is created,
            // moved, copied or deleted.
            Self::ArchiveNodes => matches!(
                step,
                S::UpdateTask { .. } | S::UpdateCommitment { .. } | S::UpdateDomain { .. }
            ),
            Self::PlanTasks | Self::PlanMove => matches!(step, S::UpdateTask { .. }),
            // An editor's Save writes the node and what hangs on it, and may fork a Habit; it
            // never deletes, copies or moves another node.
            Self::SaveTask
            | Self::SaveGoal
            | Self::SaveCommitment
            | Self::SaveProject
            | Self::SaveWait
            | Self::SaveFlow
            | Self::SaveFlowItem
            | Self::NewFlow => !matches!(
                step,
                S::Delete { .. } | S::Duplicate { .. } | S::Move { .. }
            ),
        }
    }
}

/// Runs the gesture `name` — its `steps`, in order — answering each step's result. A step this
/// gesture does not make is refused before anything is written.
pub async fn run(
    db: &mut Db<Transactional>,
    name: GestureName,
    steps: Vec<steps::StepEntry>,
    now: NaiveDateTime,
) -> Result<Vec<serde_json::Value>, WireError> {
    if let Some(stray) = steps.iter().find(|entry| !name.admits(&entry.step)) {
        return Err(WireError::invalid_request(format!(
            "the {name:?} gesture does not make {:?}",
            stray.step
        )));
    }
    steps::run(db, steps, now).await
}
