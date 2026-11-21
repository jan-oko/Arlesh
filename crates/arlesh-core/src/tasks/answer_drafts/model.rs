//! What a staged answer is, and what saving, clearing and sending one say: plain values, with no
//! database in them (ADR 0021; the row that stores a draft lives in persistence).

use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};

use crate::nodes::id::NodeId;
use crate::tasks::model::ReviewVerdict;

/// An answer written but not yet sent. Its existence means the wait is **staged**.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct AnswerDraft {
    /// The wait it answers: a stored or a derived wait's id.
    pub wait_id: NodeId,
    /// A question's answer, or a review's note (optional there).
    pub answer: Option<String>,
    /// A review's verdict; `None` on a question.
    pub verdict: Option<ReviewVerdict>,
    /// When the last save landed.
    pub saved_at: NaiveDateTime,
}

/// The content of a draft to save, as the user gave it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct DraftRequest {
    /// A question's answer, or a review's note.
    #[serde(default)]
    pub answer: Option<String>,
    /// A review's verdict.
    #[serde(default)]
    pub verdict: Option<ReviewVerdict>,
}

/// A request to send the staged answers.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct SendRequest {
    /// The waits the caller's screen showed as staged: one that has no draft any more is reported
    /// as skipped rather than passed over in silence.
    #[serde(default)]
    pub shown: Vec<NodeId>,
}

/// Why a staged answer was not sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SkipReason {
    /// The wait was already released.
    Released,
    /// The wait no longer exists, is archived, or is no longer an agentic question.
    Gone,
    /// The wait is still open, but its draft was cleared on another device.
    Unstaged,
}

/// A draft that was sent: its wait is released.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct SentDraft {
    /// The wait released.
    pub wait_id: NodeId,
    /// The Task it hangs under.
    pub task_id: NodeId,
}

/// A staged answer that was not sent, named so the client can say so.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct SkippedDraft {
    /// The wait.
    pub wait_id: NodeId,
    /// The Task it hangs under, when the wait is still known.
    pub task_id: Option<NodeId>,
    /// The wait's title, when the wait is still known.
    pub title: Option<String>,
    /// Why it was skipped.
    pub reason: SkipReason,
}

/// What a send did.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct SendOutcome {
    /// The waits released.
    pub sent: Vec<SentDraft>,
    /// The staged answers not sent.
    pub skipped: Vec<SkippedDraft>,
}
