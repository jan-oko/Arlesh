//! **Staged answers** (ADR 0021, Task `de16`): the user's answer to a question, or a review's
//! verdict, kept as a draft until the user sends the batch.
//!
//! A draft is a row of its own table, keyed by the wait's id; a row means "staged". Agents never
//! read the table, so a draft is invisible to them until [`send_drafts`] releases the waits.
//! Single-table SQL lives on [`AnswerDraftOperator`]; the three operations are free functions over
//! a [`Db`] session because they read the board and release waits as well.

pub mod model;

use std::collections::{BTreeMap, BTreeSet};

use chrono::{NaiveDateTime, Timelike};
pub use model::{
    AnswerDraft, DraftRequest, SendOutcome, SendRequest, SentDraft, SkipReason, SkippedDraft,
};

use crate::capacity::blocks::Blocking;
use crate::database::session::{Db, Transactional};
use crate::error::AppError;
use crate::nodes::id::NodeId;
use crate::tasks::error::TaskError;
use crate::tasks::model::{
    Expectation, ExpectationStatus, ReviewVerdict, UpdateExpectationRequest,
};
use crate::tasks::rules::answer_drafts::{check, check_sendable, DraftRefusal, Sendable};
use crate::tasks::waits::instant_from_column;
use arlesh_rules::tasks::waits::INSTANT_FORMAT;

/// An `answer_drafts` row as the database returns it. Its id and verdict are spelled as text, so
/// it converts to the model with [`TryFrom`]: a spelling that does not parse is no draft.
#[derive(sqlx::FromRow)]
struct AnswerDraftRow {
    wait_id: String,
    answer: Option<String>,
    verdict: Option<String>,
    saved_at: String,
}

impl TryFrom<AnswerDraftRow> for AnswerDraft {
    type Error = String;

    fn try_from(row: AnswerDraftRow) -> Result<Self, Self::Error> {
        let wait_id = row
            .wait_id
            .parse::<NodeId>()
            .map_err(|_| format!("draft for {:?}: not a wait id", row.wait_id))?;
        let saved_at = instant_from_column(Some(row.saved_at))
            .ok_or_else(|| format!("draft for {wait_id}: unreadable saved_at"))?;
        Ok(Self {
            wait_id,
            answer: row.answer,
            verdict: row.verdict.as_deref().and_then(ReviewVerdict::from_db),
            saved_at,
        })
    }
}

/// Reads and writes draft rows on a session's connection.
///
/// Obtained as `db.answer_drafts()` and used inline; see [`Db`] for the borrow rules.
pub struct AnswerDraftOperator<'session> {
    /// The session's connection, borrowed for the duration of this operator's life.
    connection: &'session mut sqlx::SqliteConnection,
}

impl<'session> AnswerDraftOperator<'session> {
    /// Wraps the connection a session is lending.
    pub(crate) fn new(connection: &'session mut sqlx::SqliteConnection) -> Self {
        Self { connection }
    }

    /// Every draft, the oldest save first. A row that does not read back is skipped and logged.
    pub async fn list(&mut self) -> Result<Vec<AnswerDraft>, sqlx::Error> {
        let rows = sqlx::query_as::<_, AnswerDraftRow>(
            "SELECT wait_id, answer, verdict, saved_at FROM answer_drafts
              ORDER BY saved_at, wait_id",
        )
        .fetch_all(&mut *self.connection)
        .await?;
        Ok(rows
            .into_iter()
            .filter_map(|row| match AnswerDraft::try_from(row) {
                Ok(draft) => Some(draft),
                Err(reason) => {
                    tracing::warn!(reason = %reason, "an unreadable answer draft was ignored");
                    None
                }
            })
            .collect())
    }

    /// Writes `draft`, replacing any earlier one for the same wait: the last save wins. The row
    /// keeps its rowid when it is replaced in place.
    pub async fn upsert(&mut self, draft: &AnswerDraft) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO answer_drafts (wait_id, answer, verdict, saved_at) VALUES (?, ?, ?, ?)
             ON CONFLICT (wait_id) DO UPDATE SET
                 answer = excluded.answer,
                 verdict = excluded.verdict,
                 saved_at = excluded.saved_at",
        )
        .bind(draft.wait_id.to_string())
        .bind(&draft.answer)
        .bind(draft.verdict.map(|verdict| verdict.as_str()))
        .bind(draft.saved_at.format(INSTANT_FORMAT).to_string())
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Deletes the draft for `wait_id`; answers whether there was one.
    pub async fn delete(&mut self, wait_id: &NodeId) -> Result<bool, sqlx::Error> {
        let done = sqlx::query("DELETE FROM answer_drafts WHERE wait_id = ?")
            .bind(wait_id.to_string())
            .execute(&mut *self.connection)
            .await?;
        Ok(done.rows_affected() > 0)
    }
}

/// Every wait on the board, stored and derived, by id.
async fn waits_by_id(
    db: &mut Db<Transactional>,
    now: NaiveDateTime,
) -> Result<BTreeMap<NodeId, Expectation>, AppError> {
    let load = crate::mindmap::load_blocked(db, now, Blocking::default()).await?;
    Ok(load
        .expectations
        .into_iter()
        .map(|wait| (wait.id.clone(), wait))
        .collect())
}

/// Stages an answer: checks it against the wait it answers (an open question or review), then
/// stores it, replacing an earlier draft for the same wait. Writes nothing when refused.
#[tracing::instrument(skip(db))]
pub async fn save_draft(
    db: &mut Db<Transactional>,
    wait_id: &NodeId,
    request: DraftRequest,
    now: NaiveDateTime,
) -> Result<AnswerDraft, AppError> {
    let waits = waits_by_id(db, now).await?;
    let wait = waits
        .get(wait_id)
        .ok_or(TaskError::AnswerDraft(DraftRefusal::NotOpen))?;
    let stored = check(wait, &request).map_err(TaskError::from)?;
    let draft = AnswerDraft {
        wait_id: wait_id.clone(),
        answer: stored.answer,
        verdict: stored.verdict,
        // The column holds whole seconds, so the answer says what a read will.
        saved_at: now.with_nanosecond(0).unwrap_or(now),
    };
    db.answer_drafts().upsert(&draft).await?;
    Ok(draft)
}

/// Unstages a wait: deletes its draft. Idempotent: a wait with no draft passes and writes nothing.
#[tracing::instrument(skip(db))]
pub async fn clear_draft(db: &mut Db<Transactional>, wait_id: &NodeId) -> Result<(), AppError> {
    db.answer_drafts().delete(wait_id).await?;
    Ok(())
}

/// Sends every staged answer on the board as the caller's write, in the transaction `db` holds:
/// each sendable draft's wait is released with the draft's answer and verdict, and every draft read
/// is deleted, the stale ones included. `request.shown` names the waits the caller's screen showed
/// as staged; one with no draft is reported as skipped. A release refused for any reason refuses
/// the whole send, so the caller must not commit.
#[tracing::instrument(skip(db, request))]
pub async fn send_drafts(
    db: &mut Db<Transactional>,
    request: SendRequest,
    now: NaiveDateTime,
) -> Result<SendOutcome, AppError> {
    let drafts = db.answer_drafts().list().await?;
    let waits = waits_by_id(db, now).await?;
    let mut outcome = SendOutcome::default();
    for draft in &drafts {
        let wait = waits.get(&draft.wait_id);
        match check_sendable(wait) {
            Sendable::Release => {
                if let Some(wait) = wait {
                    release(db, wait, draft, now).await?;
                    outcome.sent.push(SentDraft {
                        wait_id: wait.id.clone(),
                        task_id: wait.parent_id.clone(),
                    });
                }
            }
            Sendable::Skip(reason) => outcome.skipped.push(skipped(&draft.wait_id, wait, reason)),
        }
        db.answer_drafts().delete(&draft.wait_id).await?;
    }
    let staged: BTreeSet<&NodeId> = drafts.iter().map(|draft| &draft.wait_id).collect();
    for shown in request.shown.iter().filter(|id| !staged.contains(id)) {
        let wait = waits.get(shown);
        outcome
            .skipped
            .push(skipped(shown, wait, unstaged_reason(wait)));
    }
    Ok(outcome)
}

/// Why a shown wait that has no draft was not sent.
fn unstaged_reason(wait: Option<&Expectation>) -> SkipReason {
    match check_sendable(wait) {
        Sendable::Skip(reason) => reason,
        Sendable::Release => SkipReason::Unstaged,
    }
}

fn skipped(wait_id: &NodeId, wait: Option<&Expectation>, reason: SkipReason) -> SkippedDraft {
    SkippedDraft {
        wait_id: wait_id.clone(),
        task_id: wait.map(|wait| wait.parent_id.clone()),
        title: wait.map(|wait| wait.title.clone()),
        reason,
    }
}

/// Releases `wait` with `draft`: the write a single Send makes, so every rule and derived
/// consequence of releasing is the existing one. A refusal names the wait.
async fn release(
    db: &mut Db<Transactional>,
    wait: &Expectation,
    draft: &AnswerDraft,
    now: NaiveDateTime,
) -> Result<(), AppError> {
    let request = UpdateExpectationRequest {
        status: Some(ExpectationStatus::Released),
        answer: draft.answer.clone().map(Some),
        verdict: draft.verdict,
        ..Default::default()
    };
    crate::nodes::write::update_expectation(db, &wait.id, request, now)
        .await
        .map(|_| ())
        .map_err(|error| {
            TaskError::DraftSendRefused {
                title: wait.title.clone(),
                reason: error.to_string(),
            }
            .into()
        })
}

#[cfg(test)]
mod tests;
