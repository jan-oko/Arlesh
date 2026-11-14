//! The shapes the agents' queries decode into, and the conversions to the domain's values.
//!
//! Domain types carry no `sqlx`; a query decodes into a row here and converts with `From`.

use super::{
    error::AgentError,
    model::{Agent, AgentId, Claim, ClaimStatus, UsageWindow},
};
use crate::access::model::NodeKey;

/// A row of `agents`.
#[derive(sqlx::FromRow)]
pub(super) struct AgentRow {
    pub id: i64,
    pub name: String,
    pub account: String,
    pub session_uuid: String,
    pub claim_kind: Option<String>,
    pub claim_id: Option<i64>,
    pub claim_paused: bool,
    pub claimed_at: Option<String>,
    pub locked: bool,
    pub created_at: String,
    pub last_seen_at: Option<String>,
    pub parent_id: Option<i64>,
}

/// The columns [`AgentRow`] reads.
pub(super) const AGENT_COLUMNS: &str = "id, name, account, session_uuid, claim_kind, claim_id, \
     claim_paused, claimed_at, locked, created_at, last_seen_at, parent_id";

impl TryFrom<AgentRow> for Agent {
    type Error = AgentError;

    fn try_from(row: AgentRow) -> Result<Self, Self::Error> {
        let claim = match (row.claim_kind, row.claim_id, row.claimed_at) {
            (Some(kind), Some(id), Some(claimed_at)) => {
                let root = NodeKey::from_reference(&kind, id)
                    .ok_or_else(|| AgentError::Corrupt(format!("claim node kind {kind:?}")))?;
                let status = if row.claim_paused {
                    ClaimStatus::Paused
                } else {
                    ClaimStatus::Active
                };
                Some(Claim {
                    root,
                    status,
                    claimed_at,
                })
            }
            _ => None,
        };
        Ok(Self {
            id: AgentId(row.id),
            name: row.name,
            account: row.account,
            session_uuid: row.session_uuid,
            claim,
            locked: row.locked,
            created_at: row.created_at,
            last_seen_at: row.last_seen_at,
            parent_id: row.parent_id.map(AgentId),
        })
    }
}

/// A row of `agent_account_usage`.
#[derive(sqlx::FromRow)]
pub(super) struct UsageRow {
    pub account: String,
    pub window_kind: String,
    pub percent_used: f64,
    pub resets_at: String,
}

impl From<UsageRow> for (String, UsageWindow) {
    fn from(row: UsageRow) -> Self {
        (
            row.account,
            UsageWindow {
                kind: row.window_kind,
                percent_used: row.percent_used,
                resets_at: row.resets_at,
            },
        )
    }
}
