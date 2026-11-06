//! Agent operation errors.

use super::model::AgentId;

/// Errors that can occur while attaching, claiming or administering Agents.
#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    /// The PIN is not one that was issued, has been used, or has lapsed.
    #[error("that PIN is not valid: ask for a new one")]
    PinInvalid,
    /// Too many wrong PINs were presented lately; the door is shut for a while.
    #[error("too many wrong PINs: wait a few minutes, then ask for a new one")]
    PinLockedOut,
    /// Too many PINs are waiting to be used.
    #[error("too many PINs are waiting to be used: use or wait out the others first")]
    TooManyPins,
    /// The agent token is not one that was issued, or its agent was removed.
    #[error("that agent token is not valid: attach again with a PIN")]
    TokenInvalid,
    /// The session has not attached, or the Agent it attached as was removed.
    #[error(
        "this session is not attached: call arlesh_agents.attach with a PIN (or an agent token) first"
    )]
    NotAttached,
    /// There is no such Agent.
    #[error("agent {0} not found")]
    NotFound(AgentId),
    /// The Agent holds no Claim to change.
    #[error("agent {0} holds no claim")]
    NoClaim(AgentId),
    /// The node is not inside the user's MCP roots, is private, or is not a node.
    #[error("{0} is not inside the MCP roots, so it cannot be claimed")]
    OutsideRoots(crate::access::model::NodeKey),
    /// Another agent holds an active Claim that overlaps.
    #[error("{node} overlaps the active claim of agent {holder}")]
    Overlaps {
        /// The node asked for.
        node: crate::access::model::NodeKey,
        /// The holder's name.
        holder: String,
    },
    /// A name, account label or usage report is not acceptable.
    #[error("{0}")]
    Invalid(String),
    /// The operating system could not supply random bytes.
    #[error("no randomness for a secret: {0}")]
    Entropy(String),
    /// A stored row holds a value its constraints should have refused.
    #[error("unreadable stored agent data: {0}")]
    Corrupt(String),
    /// Resolving access failed.
    #[error(transparent)]
    Access(#[from] crate::access::error::AccessError),
    /// A database error occurred.
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}
