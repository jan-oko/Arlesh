//! A Done Task's **done date**: the instant it was completed (`docs/spec/resources.md`, *Tasks*).
//!
//! Recorded when the Task is marked Done and kept while it stays Done; the editor shows it and
//! lets it be set back, so work marked done late can say when it was really done. For a stored
//! Task it is `tasks.done_at`; a Habit occurrence keeps it in its overlay (see
//! [`crate::flows::done_date`]).

use chrono::NaiveDateTime;

use super::{error::TaskError, model::TaskStatus, waits, TaskOperator};
use crate::database::session::{Db, Transactional};

/// Refuses a done date that cannot be: one for a Task that is not Done, or one in the future.
///
/// Any instant up to `now` is accepted, one before the Task's window opened included: completing
/// work early is allowed, so an early done date names something that can have happened.
pub fn check_done_date(
    is_done: bool,
    at: NaiveDateTime,
    now: NaiveDateTime,
) -> Result<(), TaskError> {
    if !is_done {
        return Err(TaskError::NotDone);
    }
    if at > now {
        return Err(TaskError::DoneInFuture);
    }
    Ok(())
}

impl TaskOperator<'_> {
    /// A stored Task's status and stored done date, as the columns hold them.
    async fn done_columns(&mut self, id: i64) -> Result<(String, Option<String>), TaskError> {
        let row: Option<(String, Option<String>)> =
            sqlx::query_as("SELECT status, done_at FROM tasks WHERE id = ?")
                .bind(id)
                .fetch_optional(&mut *self.connection)
                .await?;
        row.ok_or(TaskError::TaskNotFound(id))
    }

    /// Writes a stored Task's done date.
    async fn write_done_at(&mut self, id: i64, at: NaiveDateTime) -> Result<(), TaskError> {
        sqlx::query("UPDATE tasks SET done_at = ? WHERE id = ?")
            .bind(waits::instant_column(at))
            .bind(id)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }
}

/// The instant a stored Task was done, or `None` while it is not Done (or was done before done
/// dates were recorded).
pub async fn stored_done_at(
    db: &mut Db<Transactional>,
    id: i64,
) -> Result<Option<NaiveDateTime>, TaskError> {
    let (status, done_at) = db.tasks().done_columns(id).await?;
    if status != TaskStatus::Done.as_str() {
        return Ok(None);
    }
    Ok(waits::instant_from_column(done_at))
}

/// Sets a Done stored Task's done date to `at`.
#[tracing::instrument(skip(db))]
pub async fn set_stored_done_at(
    db: &mut Db<Transactional>,
    id: i64,
    at: NaiveDateTime,
    now: NaiveDateTime,
) -> Result<(), TaskError> {
    let (status, _) = db.tasks().done_columns(id).await?;
    check_done_date(status == TaskStatus::Done.as_str(), at, now)?;
    db.tasks().write_done_at(id, at).await
}

#[cfg(test)]
mod tests;
