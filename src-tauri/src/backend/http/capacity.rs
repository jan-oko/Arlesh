//! [`HttpBackend`]'s agent capacity lock: the server's, shared by every device and every agent.

use reqwest::Method;

use super::{Call, HttpBackend};
use crate::{backend::capacity::CapacityPort, capacity::CapacityState, error::WireError};

#[async_trait::async_trait]
impl CapacityPort for HttpBackend {
    async fn agent_capacity(&self) -> Result<CapacityState, WireError> {
        self.read(Call::new(Method::GET, "/capacity".to_owned()))
            .await
    }

    async fn set_agent_capacity(&self, at_capacity: bool) -> Result<CapacityState, WireError> {
        self.write(
            Call::new(Method::PUT, "/capacity".to_owned()).json(&CapacityState { at_capacity }),
        )
        .await
    }
}
