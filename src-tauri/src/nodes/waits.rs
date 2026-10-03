//! A wait's derived rows, where they touch the database: [`derive_waits`] reads what every wait,
//! check task and spawned wait is drawn from, and draws them with
//! [`crate::nodes::rules::waits::derive_waits_in`].
//!
//! What the rows are — check tasks, spawned waits, delegation waits — is pure and lives in
//! [`crate::nodes::rules::waits`], whose names are re-exported here (ADR 0010).

use chrono::NaiveDateTime;

use crate::{
    database::session::{Db, SessionMode},
    error::AppError,
    tasks::{model::Task, waits::WaitSources},
};

pub(crate) use super::rules::waits::occurrence_key;
pub use super::rules::waits::WaitRows;
use super::rules::waits::{derive_waits_in, CheckState, WaitBoardSources, WaitState};

/// Derives every wait's rows at `now`. `tasks` is the Task table the waits hang on — stored and
/// derived — which is what says which Tasks are delegated.
pub async fn derive_waits<M: SessionMode>(
    db: &mut Db<M>,
    now: NaiveDateTime,
    tasks: &[Task],
) -> Result<WaitRows, AppError> {
    let expectations = db.expectations().list().await?;
    let checks = db.tasks().all_wait_checks().await?;
    let spawned = db.tasks().spawned_waits().await?;
    let templates = db.tasks().async_templates().await?;
    let wait_overlays = db.overlays().expectations().await?;
    let check_state = CheckState {
        overlays: db.overlays().check_tasks().await?,
        tags: db.relations().tags_without_habit().await?,
        reasons: db.relations().block_reasons_without_habit().await?,
    };
    let wait_state = WaitState {
        overlays: wait_overlays.clone(),
        tags: db.relations().expectation_tags().await?,
    };
    let task_overlays = db.overlays().task_overlays().await?;
    let spawned_states = db.overlays().spawned_wait_states().await?;
    derive_waits_in(
        &WaitBoardSources {
            windows: WaitSources {
                expectations: &expectations,
                checks: &checks,
                spawned: &spawned,
                templates: &templates,
                overlays: &wait_overlays,
            },
            checks: check_state,
            waits: wait_state,
            task_overlays: &task_overlays,
            spawned_states: &spawned_states,
        },
        now,
        tasks,
    )
}
