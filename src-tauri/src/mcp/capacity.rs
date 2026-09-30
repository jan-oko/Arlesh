//! The agent capacity lock tool: read it, set it, clear it.
//!
//! The lock is [`crate::capacity`]: one app-wide on/off state, not a node, so it needs no MCP root
//! and is never journaled. Its effect is entirely on the user's side — the app's Start preset stops
//! offering Agentic Tasks while it is on — and nothing an agent reads changes:
//! the snapshot's own Start filter ignores it.

use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ErrorData},
    tool, tool_router,
};

use super::{params::CapacityOperation, result, ArleshMcp};

#[tool_router(router = capacity_router, vis = "pub(super)")]
impl ArleshMcp {
    /// The agent capacity lock: one app-wide switch meaning "agents are at capacity".
    ///
    /// While it is on, the user's own Start view stops offering Agentic tasks (every one not yet
    /// done), so they are not prompted to hand out work no agent can pick up. Nothing you read
    /// changes: `arlesh_snapshot`'s Start filter ignores the lock, so you still see the work.
    ///
    /// Set it (`set` with `at_capacity: true`) when you cannot take on more Agentic work — every
    /// agent you run is busy. Clear it (`set` with `at_capacity: false`) as soon as there is room
    /// for another task, and before you stop; a lock left on hides the user's Agentic work from
    /// Start until someone clears it. `get` reads it. The user can set and clear it too, so read
    /// it rather than assuming it is still where you left it. It belongs to no node: it needs no
    /// MCP root, and it is not an undoable edit.
    #[tool(
        name = "arlesh_capacity",
        annotations(
            title = "Arlesh agent capacity lock",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true
        )
    )]
    pub async fn capacity(
        &self,
        Parameters(operation): Parameters<CapacityOperation>,
    ) -> Result<CallToolResult, ErrorData> {
        match operation {
            CapacityOperation::Get => result::ok(self.capacity.get().await),
            CapacityOperation::Set { at_capacity } => match self.capacity.set(at_capacity).await {
                Ok(state) => result::ok(state),
                Err(error) => result::internal(error.to_string()),
            },
        }
    }
}
