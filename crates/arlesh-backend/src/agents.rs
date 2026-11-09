//! The `agents` part of the [`Backend`](super::Backend) port: the Agents, their Claims and the
//! accounts they work under, as Settings → Agents lists and changes them, and the PIN a signed-in
//! client asks for to give an agent.
//!
//! An agent's own operations (attach, claim, pause) are the MCP's, not the port's: they are made
//! over an MCP session, bound to the agent. These are the user's.

use arlesh_core::{
    agents::model::{AgentAction, AgentsOverview, IssuedPin},
    error::WireError,
};

/// The agents operations a backend serves.
#[async_trait::async_trait]
pub trait AgentsPort: Send + Sync {
    /// Every Agent and account, with where each Claim stands and why an agent is at capacity.
    async fn list_agents(&self) -> Result<AgentsOverview, WireError>;

    /// A one-time PIN to give an agent, so it can attach.
    async fn issue_agent_pin(&self) -> Result<IssuedPin, WireError>;

    /// Changes an Agent by hand: pauses, resumes or releases its Claim, locks it, removes it.
    async fn apply_agent_action(&self, id: i64, action: AgentAction) -> Result<(), WireError>;

    /// Locks or unlocks a whole account by hand.
    async fn set_agent_account_locked(&self, label: String, locked: bool) -> Result<(), WireError>;
}
