//! What an Agent, its Claim and its account are: plain values, with no database in them.

use serde::{Deserialize, Serialize};

use crate::access::model::NodeKey;

/// An Agent's identity: its row in `agents`.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    PartialOrd,
    Ord,
    Serialize,
    Deserialize,
    schemars::JsonSchema,
)]
#[serde(transparent)]
pub struct AgentId(pub i64);

impl std::fmt::Display for AgentId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

/// Whether a Claim is held or has been set aside.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ClaimStatus {
    /// Held: no other active Claim may cover any node of its subtree.
    Active,
    /// Set aside, by the agent or by hand. The agent keeps its token and reads its subtree, but
    /// cannot write it, and another agent may claim the subtree meanwhile.
    Paused,
}

/// A subtree an Agent holds: its whole view of the board.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Claim {
    /// The subtree's root. A stored node, inside the user's MCP roots.
    pub root: NodeKey,
    /// Whether the Claim is held or paused.
    pub status: ClaimStatus,
    /// When the Claim was made (ISO 8601 local time): of two Claims that come to overlap, the
    /// older keeps its place.
    pub claimed_at: String,
}

/// An Agent: a session of an AI client, attached with a PIN.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Agent {
    /// The Agent's identity.
    pub id: AgentId,
    /// What Settings → Agents calls it. Unique.
    pub name: String,
    /// The label of the account it works under; usage is kept per account.
    pub account: String,
    /// The client's session id, as it last attached with it.
    pub session_uuid: String,
    /// Its Claim, if it holds one.
    pub claim: Option<Claim>,
    /// A manual lock: its claimed Agentic Tasks read blocked while it is on.
    pub locked: bool,
    /// When it first attached.
    pub created_at: String,
    /// When a session last used its token or attached with it.
    pub last_seen_at: Option<String>,
    /// The Agent this one is a child of: a subagent the mod registered under its session's Agent.
    /// `None` for an Agent. For a child, `session_uuid` is the client's id for the subagent.
    pub parent_id: Option<AgentId>,
}

/// How much of one limit window an account has used, as an agent reported it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct UsageWindow {
    /// Which window: `five_hour`, `seven_day`, whatever the client calls its plan limits.
    pub kind: String,
    /// How much of it is used, 0 to 100 (more is capped by the rule, not refused).
    pub percent_used: f64,
    /// When the window resets (ISO 8601 local time). The account is free of this window then.
    pub resets_at: String,
}

/// An account the agents work under, with what it has used.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Account {
    /// The label agents declare.
    pub label: String,
    /// A manual lock on every agent of the account.
    pub locked: bool,
    /// The last report of each limit window.
    pub windows: Vec<UsageWindow>,
}

/// A PIN a signed-in client asked for, to hand to an agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct IssuedPin {
    /// The digits to give the agent.
    pub pin: String,
    /// When the PIN lapses (ISO 8601 local time).
    pub expires_at: String,
}

/// Why an Agent's Agentic Tasks read blocked.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CapacityCause {
    /// The agent is locked by hand.
    AgentLocked,
    /// The agent's account is locked by hand.
    AccountLocked,
    /// A window of the agent's account is at its limit until it resets.
    UsageLimit {
        /// The window that is full.
        window: String,
        /// When it resets (ISO 8601 local time).
        resets_at: String,
    },
}

/// Where an Agent's Claim stands among the others.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentStanding {
    /// It holds no Claim: it sees nothing.
    Unclaimed,
    /// Its Claim is held.
    Active,
    /// Its Claim is paused.
    Paused,
    /// Its Claim is held but now overlaps an older active Claim (a node was moved), so it sees
    /// nothing until the overlap is gone.
    Shadowed,
    /// Its Claim's root left the user's MCP roots, was deleted or went private, so it sees
    /// nothing.
    Unreachable,
}

/// One Agent as Settings → Agents lists it: the Agent, where its Claim stands, and whether it is
/// at capacity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct AgentSummary {
    /// The Agent.
    pub agent: Agent,
    /// Where its Claim stands.
    pub standing: AgentStanding,
    /// Why its Agentic Tasks read blocked, when they do.
    pub at_capacity: Option<CapacityCause>,
}

/// Every Agent and account, as Settings → Agents lists them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct AgentsOverview {
    /// The Agents, oldest first.
    pub agents: Vec<AgentSummary>,
    /// The accounts they work under, with usage.
    pub accounts: Vec<Account>,
}

/// A change the user makes to an Agent by hand.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum AgentAction {
    /// Pauses its Claim.
    Pause,
    /// Makes its paused Claim active again; refused while another active Claim overlaps.
    Resume,
    /// Lets go of its Claim.
    Release,
    /// Locks (`true`) or unlocks (`false`) the agent.
    Lock {
        /// Whether the lock is on.
        locked: bool,
    },
    /// Removes the Agent; its token stops working.
    Remove,
}
