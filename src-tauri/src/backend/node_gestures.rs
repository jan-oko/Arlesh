//! The **gesture operations** of the [`Backend`](super::Backend) port: each gesture the app makes
//! over several nodes, as one operation — one request to a server, one transaction, one Gesture,
//! one undo step. See [`crate::nodes::gestures`].

use crate::{
    error::WireError,
    nodes::gestures::{steps::StepEntry, GestureName, GestureNode},
};

/// The multi-node gestures a backend serves, each as one operation.
#[async_trait::async_trait]
pub trait NodeGesturesPort: Send + Sync {
    /// Deletes every node in `nodes`, all or nothing: a multi-selection, or an expanded subtree.
    async fn delete_nodes(&self, nodes: Vec<GestureNode>) -> Result<(), WireError>;

    /// Runs the gesture `name` — its listed writes, in order — answering each one's result.
    async fn run_gesture(
        &self,
        name: GestureName,
        steps: Vec<StepEntry>,
    ) -> Result<Vec<serde_json::Value>, WireError>;
}
