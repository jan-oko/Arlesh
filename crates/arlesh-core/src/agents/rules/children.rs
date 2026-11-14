//! When a child agent holds nothing open (ADR 0019).
//!
//! A subagent that has stopped leaves its child agent behind. Listing every one of them, one per
//! run, would bury the few that matter, so a child whose subagent has stopped is **removed unless
//! it still holds something**. What a child can hold, from the model:
//!
//! - **A lock**: none. A child cannot be locked; capacity is its parent's.
//! - **A Claim on a Task not yet handed back**: the Task is still *On Agent*. A Task that was set
//!   Done removes its child by itself (a trigger); a Task given back (To Do), taken by the user
//!   (Doing) or never an Agentic Task is not held.
//! - **An open wait under its Task**: a pending, live agentic wait (a question, a review, a wait
//!   on CI) there means the work is waiting on someone, and the child is how it is shown.
//! - **A Claim on anything but a Task** (a Goal, a Domain, ...): there is no "handed back" for it,
//!   so it is held until released or until its parent goes.
//!
//! A child with no Claim holds nothing.

/// What a child's sub-Claim is on, as far as this rule cares.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Claimed {
    /// No sub-Claim.
    Nothing,
    /// A stored Task.
    Task {
        /// Whether its stored status is On Agent.
        on_agent: bool,
        /// How many pending, live agentic waits hang directly under it.
        open_waits: usize,
    },
    /// Any other node.
    Other,
}

/// What a finished child still holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Holds {
    /// A Task that is still On Agent.
    Task,
    /// An open wait under its Task.
    OpenWaits,
    /// A Claim on a node that is not a Task.
    Claim,
}

/// What the child still holds, or `None` when it holds nothing open and may be removed.
pub fn holds(claimed: Claimed) -> Option<Holds> {
    match claimed {
        Claimed::Nothing => None,
        Claimed::Other => Some(Holds::Claim),
        Claimed::Task { on_agent: true, .. } => Some(Holds::Task),
        Claimed::Task { open_waits, .. } if open_waits > 0 => Some(Holds::OpenWaits),
        Claimed::Task { .. } => None,
    }
}

#[cfg(test)]
mod tests;
