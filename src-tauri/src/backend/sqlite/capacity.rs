//! [`SqliteBackend`]'s agent capacity lock: the one beside the local file.

use super::SqliteBackend;
use crate::{backend::capacity::CapacityPort, capacity::CapacityState, error::WireError};

#[async_trait::async_trait]
impl CapacityPort for SqliteBackend {
    async fn agent_capacity(&self) -> Result<CapacityState, WireError> {
        Ok(self.capacity.get().await)
    }

    async fn set_agent_capacity(&self, at_capacity: bool) -> Result<CapacityState, WireError> {
        self.capacity
            .set(at_capacity)
            .await
            .map_err(|error| WireError::internal(error.to_string()))
    }
}
