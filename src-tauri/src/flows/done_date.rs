//! A Done Habit occurrence's **done date**: the instant it was completed, which its overlay keeps
//! as `resolved_at`, and which an Interval's next window and a Window Habit's cooldown count from
//! (`docs/spec/habits.md`, *Done date*).
//!
//! Setting it back is how a completion recorded late is put right: the Habit then reads as if it
//! had been ticked when it was done.

use chrono::NaiveDateTime;

use super::{
    clock_slots,
    error::FlowError,
    habits::{Clock, SlotWindow},
    occurrence_edit::resolved_at_ms,
    occurrences::{completion_inputs, CompletionInputs},
    parse_clock,
};
use crate::{
    database::session::{Db, Transactional},
    nodes::{key::OccurrenceKey, overlay::HabitOverlays},
    tasks::{done_date::check_done_date, model::Status},
};

/// The instant a Task occurrence was done, or `None` while it is not Done.
pub async fn occurrence_done_at(
    db: &mut Db<Transactional>,
    key: &OccurrenceKey,
) -> Result<Option<NaiveDateTime>, FlowError> {
    let overlay = db.overlays().task(key).await?;
    if !Status::is_done_db(overlay.status.as_deref()) {
        return Ok(None);
    }
    Ok(overlay
        .resolved_at
        .and_then(chrono::DateTime::from_timestamp_millis)
        .map(|instant| instant.naive_utc()))
}

/// Sets a Done Task occurrence's done date to `at`.
///
/// Refused when the occurrence is not Done, when `at` is in the future, and — for an **Interval**
/// Habit, whose next window is placed by this completion — when the new date would move a later
/// instance that already holds completed work: that instance's overlay is keyed by the window it
/// has now, so moving the window would leave the work behind, unread.
#[tracing::instrument(skip(db))]
pub async fn set_occurrence_done_at(
    db: &mut Db<Transactional>,
    key: &OccurrenceKey,
    at: NaiveDateTime,
    now: NaiveDateTime,
) -> Result<(), FlowError> {
    let flow_id = db.flows().occurrence_flow_id(key).await?;
    let mut overlay = db.overlays().task(key).await?;
    check_done_date(Status::is_done_db(overlay.status.as_deref()), at, now)?;
    let resolved_at = resolved_at_ms(at);
    if let Some(recurrence) = db.flows().get_recurrence(flow_id).await? {
        if parse_clock(&recurrence)? == Clock::Interval {
            let flow = db.flows().get(flow_id).await?;
            let before = completion_inputs(db, &flow, now).await?;
            let mut after = completion_inputs(db, &flow, now).await?;
            if let Some(changed) = after.overlays.tasks.get_mut(&key.node_key()) {
                changed.resolved_at = Some(resolved_at);
            }
            let chain = |inputs: &CompletionInputs| {
                clock_slots(&flow, &recurrence, Clock::Interval, now, |slot| {
                    inputs.completed_at(slot)
                })
            };
            refuse_moving_completed_work(key, &chain(&before)?, &chain(&after)?, &before)?;
        }
    }
    overlay.resolved_at = Some(resolved_at);
    db.overlays().put_task(flow_id.0, key, &overlay).await?;
    Ok(())
}

/// Refuses when an instance after `key`'s in the chain `before` is gone from `after` — its window
/// moved — while it holds completed work.
fn refuse_moving_completed_work(
    key: &OccurrenceKey,
    before: &[SlotWindow],
    after: &[SlotWindow],
    inputs: &CompletionInputs,
) -> Result<(), FlowError> {
    let later = before
        .iter()
        .skip_while(|slot| slot.scope_id != key.iteration)
        .skip(1);
    for slot in later {
        let kept = after.iter().any(|moved| moved.scope_id == slot.scope_id);
        if !kept && holds_completed_work(inputs, slot) {
            return Err(FlowError::Refused(
                "this done date would move the next instance, which is already done; \
                 change that one's first"
                    .to_string(),
            ));
        }
    }
    Ok(())
}

/// Whether any instance of the iteration in `slot` is done (a Task — a compound one by its derived
/// status) or achieved (a Goal).
fn holds_completed_work(inputs: &CompletionInputs, slot: &SlotWindow) -> bool {
    inputs.keys.iter().any(|(item, cycle)| {
        let node_key = OccurrenceKey {
            item: *item,
            iteration: slot.scope_id,
            cycle: *cycle,
        }
        .node_key();
        completed(&inputs.overlays, &node_key)
            || inputs
                .readings
                .get(&node_key)
                .is_some_and(|reading| reading.status.is_done())
    })
}

fn completed(overlays: &HabitOverlays, node_key: &str) -> bool {
    overlays
        .tasks
        .get(node_key)
        .is_some_and(|overlay| Status::is_done_db(overlay.status.as_deref()))
        || overlays
            .goals
            .get(node_key)
            .is_some_and(|overlay| overlay.status.as_deref() == Some("achieved"))
}
