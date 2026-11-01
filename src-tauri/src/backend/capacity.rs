//! The `capacity` part of the [`Backend`](super::Backend) port: the agent capacity lock.

use crate::{capacity::CapacityState, error::WireError};

/// The agent capacity lock, as a backend serves it.
#[async_trait::async_trait]
pub trait CapacityPort: Send + Sync {
    /// The lock as it stands.
    async fn agent_capacity(&self) -> Result<CapacityState, WireError>;

    /// Sets the lock on or off.
    async fn set_agent_capacity(&self, at_capacity: bool) -> Result<CapacityState, WireError>;
}
