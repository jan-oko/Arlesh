//! Saving a flow item's cycle pairs without losing what its occurrences carry.
//!
//! A pair's id is part of every occurrence's value key — its overlay, its relations and the nodes
//! hung on it are all keyed on it — so replacing an item's pairs wholesale, as saving the item
//! used to, orphaned every one of them on any save, a title-only one included. The pairs are
//! diffed instead ([`diff_cycles`]): a pair whose Cycle Scope is still asked for keeps its row,
//! only pairs that really went are deleted, and only new ones inserted. An unchanged set writes
//! nothing at all.
//!
//! A change that would still orphan something recorded — a pair removed, or an item that had none
//! given some — is refused until the caller answers the Habit editor's own question (see
//! [`Reconcile`]): **Archive & new** or **Discard & regenerate**.

use chrono::NaiveDateTime;

use super::{
    error::FlowError,
    model::{FlowCycleInput, FlowId, FlowItemCycle, FlowItemType, UpdateFlowRequest, NO_CYCLE},
    stop_recurring,
};
use crate::database::session::{Db, Transactional};

/// A kept pair: the stored pair's id, and the index of the asked-for pair it becomes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeptPair {
    /// The stored pair's id, which survives.
    pub id: i64,
    /// Its index in the asked-for list, which is also its new position.
    pub position: usize,
}

/// How an item's stored cycle pairs become the asked-for ones.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CycleDiff {
    /// Pairs that survive, keeping their ids.
    pub kept: Vec<KeptPair>,
    /// Indices, in the asked-for list, of pairs that are new.
    pub added: Vec<usize>,
    /// Ids of stored pairs that go.
    pub removed: Vec<i64>,
}

/// Matches asked-for cycle pairs to stored ones by **Cycle Scope**: a pair whose `(scope_kind,
/// scope_index)` is still asked for survives, whatever became of its Cycle Plan, because it still
/// draws the same occurrence in the same window. Repeated scopes match in order. A pair whose
/// Cycle Scope moved is a different occurrence — it is removed and a new one added — since an
/// edit recorded against the old window would not belong to the new one.
pub fn diff_cycles(existing: &[FlowItemCycle], wanted: &[FlowCycleInput]) -> CycleDiff {
    let mut unmatched: Vec<&FlowItemCycle> = existing.iter().collect();
    let mut diff = CycleDiff::default();
    for (position, pair) in wanted.iter().enumerate() {
        let found = unmatched.iter().position(|stored| {
            stored.scope_kind == pair.scope_kind && stored.scope_index == pair.scope_index
        });
        match found {
            Some(index) => {
                let stored = unmatched.remove(index);
                diff.kept.push(KeptPair {
                    id: stored.id,
                    position,
                });
            }
            None => diff.added.push(position),
        }
    }
    diff.removed = unmatched.iter().map(|stored| stored.id).collect();
    diff
}

/// The occurrence keys (`cycle_id`s) a cycle edit leaves behind: every removed pair's, and the
/// no-pair sentinel's when an item that had no pairs is given some — its occurrences stop being
/// drawn by [`NO_CYCLE`].
pub fn orphaned_cycle_ids(
    existing: &[FlowItemCycle],
    wanted: &[FlowCycleInput],
    diff: &CycleDiff,
) -> Vec<i64> {
    let mut orphaned = diff.removed.clone();
    if existing.is_empty() && !wanted.is_empty() {
        orphaned.push(NO_CYCLE);
    }
    orphaned
}

/// What a cycle edit that would orphan recorded edits does instead of losing them — the Habit
/// editor's own two answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Reconcile {
    /// Archive & new: the edit lands on a fork of the Habit, and the original keeps its history.
    Fork,
    /// Discard & regenerate: the Habit's recorded edits are cleared, and the edit lands on it.
    Discard,
}

/// The fork an "Archive & new" item edit landed on: the new flow, and old→new item ids, so the
/// rest of the save (title, dependencies) can be applied to the fork's copy of the item.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ForkedTemplate {
    /// The fork's flow id.
    pub flow_id: i64,
    /// Old→new `flow_goals` ids.
    pub goals: Vec<(i64, i64)>,
    /// Old→new `flow_tasks` ids.
    pub tasks: Vec<(i64, i64)>,
}

/// How many iterations hold something recorded that a cycle edit would orphan: an overlay, a
/// relation or an added child keyed on one of the occurrence keys the edit leaves behind. Zero
/// means the edit is safe to make as it stands.
pub async fn orphaned_edits(
    db: &mut Db<Transactional>,
    item_type: FlowItemType,
    item_id: i64,
    cycles: &[FlowCycleInput],
) -> Result<i64, FlowError> {
    let existing = db.flows().item_cycles(item_type, item_id).await?;
    let diff = diff_cycles(&existing, cycles);
    let orphaned = orphaned_cycle_ids(&existing, cycles, &diff);
    if orphaned.is_empty() {
        return Ok(0);
    }
    db.flows()
        .iterations_keyed_on(item_type, item_id, &orphaned)
        .await
}

/// Saves an item's cycle pairs, answering a would-be orphaning with `reconcile` when the caller
/// has asked the question. `None` writes as asked — the caller checks [`orphaned_edits`] first.
///
/// - **Discard** clears the Habit's recorded edits, exactly as the Habit editor's
///   delete-and-regenerate does, then saves.
/// - **Fork** is the Habit editor's "Archive & new": the template is forked with none of the
///   history, and the original is archived — it stops recurring after the Day holding `now`,
///   keeping the iterations already begun. The fork carries the Recurrence and privacy the item
///   editor does not restate. The pairs are saved on the fork's copy of the item, and the old→new
///   ids are returned so the rest of the save lands there too.
#[tracing::instrument(skip(db))]
pub async fn set_item_cycles(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    item_type: FlowItemType,
    item_id: i64,
    cycles: &[FlowCycleInput],
    reconcile: Option<Reconcile>,
    now: Option<NaiveDateTime>,
) -> Result<Option<ForkedTemplate>, FlowError> {
    match reconcile {
        None => {
            db.flows()
                .set_cycles(flow_id.0, item_type, item_id, cycles)
                .await?;
            Ok(None)
        }
        Some(Reconcile::Discard) => {
            db.flows().clear_habit_modifications(flow_id).await?;
            db.flows()
                .set_cycles(flow_id.0, item_type, item_id, cycles)
                .await?;
            Ok(None)
        }
        Some(Reconcile::Fork) => {
            let now = now.ok_or_else(|| {
                FlowError::Invalid("archive & new needs the time it is archived at".to_string())
            })?;
            let fork = fork_and_set_cycles(db, flow_id, item_type, item_id, cycles).await?;
            stop_recurring(db, flow_id, now).await?;
            Ok(Some(fork))
        }
    }
}

/// The "Archive & new" half of [`set_item_cycles`].
async fn fork_and_set_cycles(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    item_type: FlowItemType,
    item_id: i64,
    cycles: &[FlowCycleInput],
) -> Result<ForkedTemplate, FlowError> {
    let source = db.flows().get(flow_id).await?;
    let clone = db.flows().clone_template(flow_id, None).await?;
    let fork = FlowId(clone.flow.id);
    db.flows().copy_recurrence(flow_id, fork).await?;
    for (old, new) in &clone.goals {
        db.flows()
            .copy_item_privacy(FlowItemType::FlowGoal, *old, *new)
            .await?;
    }
    for (old, new) in &clone.tasks {
        db.flows()
            .copy_item_privacy(FlowItemType::FlowTask, *old, *new)
            .await?;
    }
    if source.is_private {
        db.flows()
            .update(
                fork,
                UpdateFlowRequest {
                    is_private: Some(true),
                    ..Default::default()
                },
            )
            .await?;
    }
    let ids = match item_type {
        FlowItemType::FlowGoal => &clone.goals,
        FlowItemType::FlowTask => &clone.tasks,
    };
    let forked_item = *ids.get(&item_id).ok_or_else(|| {
        FlowError::Invalid("the item is not part of the habit it was edited in".to_string())
    })?;
    db.flows()
        .set_cycles(fork.0, item_type, forked_item, cycles)
        .await?;
    let mut goals: Vec<(i64, i64)> = clone.goals.into_iter().collect();
    let mut tasks: Vec<(i64, i64)> = clone.tasks.into_iter().collect();
    goals.sort_unstable();
    tasks.sort_unstable();
    Ok(ForkedTemplate {
        flow_id: fork.0,
        goals,
        tasks,
    })
}

#[cfg(test)]
mod tests;
