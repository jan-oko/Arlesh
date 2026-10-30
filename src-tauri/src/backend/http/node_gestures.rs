//! [`HttpBackend`]'s gesture operations: each one request to `/gestures`, which the server runs as
//! one transaction and one undo step on this device's stack.

use reqwest::Method;

use super::{Call, HttpBackend};
use crate::{
    backend::node_gestures::NodeGesturesPort, error::WireError, nodes::gestures::GestureNode,
};

#[async_trait::async_trait]
impl NodeGesturesPort for HttpBackend {
    async fn delete_nodes(&self, nodes: Vec<GestureNode>) -> Result<(), WireError> {
        self.write(Call::new(Method::POST, "/gestures/delete-nodes".to_owned()).json(&nodes))
            .await
    }
}
