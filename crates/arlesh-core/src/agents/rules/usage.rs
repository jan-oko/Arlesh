//! Capacity per account: an agent is at capacity while any limit window of its account sits at
//! 100% before it resets, or while it or its account is locked by hand.
//!
//! Derived from the last reports and `now`, never stored as a flag, so it lifts by itself at the
//! window's reset — a missed timer, a restart or a client that never reports again cannot leave an
//! agent stuck.

use chrono::NaiveDateTime;

use crate::agents::model::CapacityCause;

#[cfg(test)]
mod tests;

/// A limit window, as reported.
#[derive(Debug, Clone, PartialEq)]
pub struct Window {
    /// Which window.
    pub kind: String,
    /// How much of it is used, as a percentage.
    pub percent_used: f64,
    /// When it resets.
    pub resets_at: NaiveDateTime,
}

/// The window, if any, that keeps an account out of capacity at `now`: full, and not yet reset.
/// When several are, the one that resets last decides when the account is free.
pub fn full_until(windows: &[Window], now: NaiveDateTime) -> Option<&Window> {
    windows
        .iter()
        .filter(|window| window.percent_used >= 100.0 && window.resets_at > now)
        .max_by_key(|window| window.resets_at)
}

/// Why an agent is at capacity at `now`, or `None` when it has room. A manual lock on the agent
/// outranks one on its account, which outranks usage.
pub fn cause(
    agent_locked: bool,
    account_locked: bool,
    windows: &[Window],
    now: NaiveDateTime,
) -> Option<CapacityCause> {
    if agent_locked {
        return Some(CapacityCause::AgentLocked);
    }
    if account_locked {
        return Some(CapacityCause::AccountLocked);
    }
    full_until(windows, now).map(|window| CapacityCause::UsageLimit {
        window: window.kind.clone(),
        resets_at: window.resets_at.format("%Y-%m-%dT%H:%M:%S").to_string(),
    })
}
