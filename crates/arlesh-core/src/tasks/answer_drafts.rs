//! **Staged answers** (ADR 0021, Task `de16`): the user's answer to a question, or a review's
//! verdict, kept as a draft until the user sends the batch.

pub mod model;

pub use model::{
    AnswerDraft, DraftRequest, SendOutcome, SendRequest, SentDraft, SkipReason, SkippedDraft,
};
