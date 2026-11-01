//! [`SqliteBackend`]'s gesture operations: each one transaction over the local file.

use super::SqliteBackend;
use crate::{
    backend::node_gestures::NodeGesturesPort,
    error::WireError,
    nodes::gestures::{self, steps::StepEntry, GestureName, GestureNode},
};

#[async_trait::async_trait]
impl NodeGesturesPort for SqliteBackend {
    async fn delete_nodes(&self, nodes: Vec<GestureNode>) -> Result<(), WireError> {
        let now = chrono::Local::now().naive_local();
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        gestures::delete_nodes(&mut db, &nodes, now).await?;
        db.commit().await.map_err(WireError::from_error)
    }

    async fn run_gesture(
        &self,
        name: GestureName,
        steps: Vec<StepEntry>,
    ) -> Result<Vec<serde_json::Value>, WireError> {
        let now = chrono::Local::now().naive_local();
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let answers = gestures::run(&mut db, name, steps, now).await?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(answers)
    }
}
