//! A wait's derived rows, where they touch the database: [`WaitData::read`] reads what every
//! wait, check task and spawned wait is drawn from, and [`derive_waits`] draws them with
//! [`crate::nodes::rules::waits::derive_waits_in`].
//!
//! What the rows are — check tasks, spawned waits, delegation waits — is pure and lives in
//! [`crate::nodes::rules::waits`], whose names are re-exported here (ADR 0010).

use std::collections::HashMap;

use chrono::NaiveDateTime;

use crate::{
    database::session::{Db, SessionMode},
    error::AppError,
    tasks::{
        model::{
            AsyncTemplate, Expectation, ExpectationArchival, ExpectationStatus, SpawnedWait, Task,
        },
        waits::{CheckRecord, WaitRef, WaitSources},
    },
};

pub(crate) use super::rules::waits::occurrence_key;
pub use super::rules::waits::WaitRows;
use super::rules::waits::{derive_waits_in, CheckState, WaitBoardSources, WaitState};
use super::{overlay::TaskOverlay, wait_overlay::ExpectationOverlay};

/// Everything a board's waits are drawn from, read once.
pub struct WaitData {
    expectations: Vec<Expectation>,
    checks: HashMap<WaitRef, Vec<CheckRecord>>,
    spawned: Vec<SpawnedWait>,
    templates: HashMap<i64, AsyncTemplate>,
    wait_overlays: HashMap<String, ExpectationOverlay>,
    check_state: CheckState,
    wait_state: WaitState,
    task_overlays: HashMap<String, TaskOverlay>,
    spawned_states: HashMap<String, (ExpectationStatus, ExpectationArchival)>,
}

impl WaitData {
    /// Reads every source a board's waits are drawn from: one query each.
    pub async fn read<M: SessionMode>(db: &mut Db<M>) -> Result<Self, AppError> {
        let wait_overlays = db.overlays().expectations().await?;
        Ok(Self {
            expectations: db.expectations().list().await?,
            checks: db.tasks().all_wait_checks().await?,
            spawned: db.tasks().spawned_waits().await?,
            templates: db.tasks().async_templates().await?,
            check_state: CheckState {
                overlays: db.overlays().check_tasks().await?,
                tags: db.relations().tags_without_habit().await?,
                reasons: db.relations().block_reasons_without_habit().await?,
            },
            wait_state: WaitState {
                overlays: wait_overlays.clone(),
                tags: db.relations().expectation_tags().await?,
            },
            wait_overlays,
            task_overlays: db.overlays().task_overlays().await?,
            spawned_states: db.overlays().spawned_wait_states().await?,
        })
    }

    /// Every Task overlay, by node key.
    pub fn task_overlays(&self) -> &HashMap<String, TaskOverlay> {
        &self.task_overlays
    }

    /// The sources, borrowed for one derivation.
    pub fn sources(&self) -> WaitBoardSources<'_> {
        WaitBoardSources {
            windows: WaitSources {
                expectations: &self.expectations,
                checks: &self.checks,
                spawned: &self.spawned,
                templates: &self.templates,
                overlays: &self.wait_overlays,
            },
            checks: &self.check_state,
            waits: &self.wait_state,
            task_overlays: &self.task_overlays,
            spawned_states: &self.spawned_states,
        }
    }
}

/// Derives every wait's rows at `now`. `tasks` is the Task table the waits hang on — stored and
/// derived — which is what says which Tasks are delegated; `waits` holds the wait item
/// occurrences whose checks are drawn here.
pub async fn derive_waits<M: SessionMode>(
    db: &mut Db<M>,
    now: NaiveDateTime,
    tasks: &[Task],
    waits: &[Expectation],
) -> Result<WaitRows, AppError> {
    let data = WaitData::read(db).await?;
    derive_waits_in(&data.sources(), now, tasks, waits)
}
