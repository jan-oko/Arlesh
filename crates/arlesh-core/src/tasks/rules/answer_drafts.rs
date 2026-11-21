//! **Staged answers**: what a draft may hold, and whether it can still be sent (ADR 0021).
//!
//! Pure functions over values. They are the release path's own rules
//! (`ExpectationWrite::require_release_answer`) applied early, so a draft that saved can be sent.

use crate::tasks::{
    answer_drafts::model::{DraftRequest, SkipReason},
    model::{Expectation, ExpectationArchival, ExpectationStatus},
    rules::review::is_open_question,
};

/// Why a draft is refused. Each message says what to change.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DraftRefusal {
    /// The wait is not an open question or review (it is gone, released, or not a question).
    #[error("only an open question or review can be answered; this wait is not one")]
    NotOpen,
    /// A question's answer is empty or only whitespace.
    #[error("a question needs an answer: write one before staging it")]
    BlankAnswer,
    /// A verdict was given for a question; only a review takes one.
    #[error("only a review takes a verdict")]
    VerdictOnQuestion,
    /// A review was given no verdict.
    #[error("a review needs a verdict (approved or changes_requested) before staging it")]
    VerdictMissing,
}

/// What a send does with one draft.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sendable {
    /// Release the wait with the draft.
    Release,
    /// Drop the draft and report the wait as skipped.
    Skip(SkipReason),
}

/// Checks `request` against the `wait` it answers and returns what is stored: a question's answer
/// trimmed; a review's note trimmed, and `None` when blank.
pub fn check(wait: &Expectation, request: &DraftRequest) -> Result<DraftRequest, DraftRefusal> {
    if !is_open_question(wait) {
        return Err(DraftRefusal::NotOpen);
    }
    let trimmed = request
        .answer
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string);
    if wait.review.is_some() {
        let verdict = request.verdict.ok_or(DraftRefusal::VerdictMissing)?;
        return Ok(DraftRequest {
            answer: trimmed,
            verdict: Some(verdict),
        });
    }
    if request.verdict.is_some() {
        return Err(DraftRefusal::VerdictOnQuestion);
    }
    match trimmed {
        Some(answer) => Ok(DraftRequest {
            answer: Some(answer),
            verdict: None,
        }),
        None => Err(DraftRefusal::BlankAnswer),
    }
}

/// What a send does with a draft whose wait is `wait`, or `None` when the wait is not on the
/// board at all.
pub fn check_sendable(wait: Option<&Expectation>) -> Sendable {
    let Some(wait) = wait else {
        return Sendable::Skip(SkipReason::Gone);
    };
    if !wait.agentic || !wait.question || wait.archival != ExpectationArchival::Live {
        return Sendable::Skip(SkipReason::Gone);
    }
    if wait.status == ExpectationStatus::Released {
        return Sendable::Skip(SkipReason::Released);
    }
    if is_open_question(wait) {
        Sendable::Release
    } else {
        Sendable::Skip(SkipReason::Gone)
    }
}

#[cfg(test)]
mod tests;
