//! The kinds a node, a filter and the parenting table distinguish.

use serde::{Deserialize, Serialize};

/// The kinds a filter distinguishes, in the frontend's own vocabulary.
///
/// `Aspect`, `Project`, `Domain` and `Tag` are the four subtypes of the single domains table;
/// they are separate variants here because the presets treat them differently.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    /// A top-level colour-coded container.
    Aspect,
    /// A Project — the one container that carries a status of its own.
    Project,
    /// A general-purpose container.
    Domain,
    /// A tag marker.
    Tag,
    /// A Goal.
    Goal,
    /// A Task.
    Task,
    /// A Commitment.
    Commitment,
    /// An Expectation — a wait. Real, or virtual: the one a delegated Task waits on.
    Expectation,
    /// A free-text note attached to another node.
    Info,
    /// A Flow's root.
    Flow,
    /// A Flow's goal item.
    FlowGoal,
    /// A Flow's task item.
    FlowTask,
    /// A Flow's Commitment item.
    FlowCommitment,
    /// A Flow's wait (Expectation) item.
    FlowExpectation,
    /// The display-only stand-in for a run of passed Habit iterations.
    HabitGroup,
}

impl NodeKind {
    /// Whether this is a structural container: one with no status of its own to be judged on, so
    /// in a filtered preset it shows only as the ancestor of a content match.
    pub fn is_structural(self) -> bool {
        matches!(
            self,
            Self::Aspect | Self::Project | Self::Domain | Self::Tag
        )
    }

    /// Whether this is part of a Flow's subtree, which hides as a unit.
    pub fn is_flow(self) -> bool {
        matches!(
            self,
            Self::Flow
                | Self::FlowGoal
                | Self::FlowTask
                | Self::FlowCommitment
                | Self::FlowExpectation
        )
    }
}
