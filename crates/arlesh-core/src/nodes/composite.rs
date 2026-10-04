//! Composite writes: the operations a host calls that put a guard in front of a write, or make
//! one write out of several.
//!
//! They used to sit in the Tauri commands. They live here so that every host — the desktop app and
//! the Python bindings — runs the same composition rather than each re-assembling it from parts,
//! which is how two hosts drift apart. Each joins the caller's transaction (ADR 0004).
//!
//! A guard that **asks** — a write that would close over unfinished work, or orphan what Habit
//! iterations recorded — refuses with [`WireErrorKind::NeedsConfirmation`] and the details of what
//! is at stake, until the caller says `confirmed`. That refusal is a [`WireError`] directly: it is
//! not a failure of any domain, and its details are the whole point of it.
//!
//! [`WireErrorKind::NeedsConfirmation`]: crate::error::WireErrorKind::NeedsConfirmation

use chrono::NaiveDateTime;

use super::{id::NodeId, write};
use crate::{
    database::session::{Db, Transactional},
    error::WireError,
    flows::{
        self,
        cycles::{ForkedTemplate, Reconcile},
        error::FlowError,
        model::{
            Flow, FlowCycleInput, FlowId, FlowItemType, FlowRecurrence, SetRecurrenceRequest,
            UnfinishedChild, UpdateFlowRequest,
        },
    },
    infos::model::InfoId,
    mindmap::{
        plan_guard,
        rules::plans::{self, PlanClampTarget},
    },
    tasks::model::{
        DescendantPlans, ExpectationId, Goal, GoalStatus, Task, TimeScope, UpdateGoalRequest,
        UpdateTaskRequest,
    },
};

/// The refusal a completion with unfinished children comes back as.
///
/// The children are named, not counted. A prompt the user can only accept blind is not consent,
/// and the whole point of the guard is being able to see what is about to be closed over.
pub fn unfinished_refusal(open: &[UnfinishedChild]) -> WireError {
    WireError::needs_confirmation(
        format!(
            "this occurrence still holds {} unfinished item(s)",
            open.len()
        ),
        serde_json::json!({
            "reason": "unfinished_children",
            "children": open,
        }),
    )
}

/// Writes `request` to the Task `id` — through the guard that asks, unless `confirmed`, before a
/// Habit occurrence is marked done while it still holds unfinished children it would close over —
/// settling the Tasks below whose own Plan a new Plan would leave outside as `descendant_plans`
/// says (clamped, or cleared to inherit). Without `descendant_plans` such a write is refused.
#[tracing::instrument(skip(db, request))]
pub async fn update_task_confirmed(
    db: &mut Db<Transactional>,
    id: &NodeId,
    request: UpdateTaskRequest,
    confirmed: bool,
    descendant_plans: Option<DescendantPlans>,
    now: NaiveDateTime,
) -> Result<Task, WireError> {
    if request.status.is_some_and(|status| status.is_done()) && !confirmed {
        refuse_over_unfinished_children(db, id, now).await?;
    }
    write::plan_task(db, id, request, now, descendant_plans)
        .await
        .map_err(WireError::from_error)
}

/// The Tasks below the Task `id` whose own Plan `plan` would leave outside the Plan they inherit,
/// each with what clamping would give it — what the clamp-or-cancel prompt shows. Nearest first.
#[tracing::instrument(skip(db))]
pub async fn plan_containment_conflicts(
    db: &mut Db<Transactional>,
    id: &NodeId,
    plan: Option<&TimeScope>,
    now: NaiveDateTime,
) -> Result<Vec<PlanClampTarget>, WireError> {
    let audit = plan_guard::audit(db, now)
        .await
        .map_err(WireError::from_error)?;
    Ok(plans::clamp_targets(&audit, id, plan))
}

/// Updates the Flow `id`, refused when the change leaves a Plan rule broken within its reach.
#[tracing::instrument(skip(db, request))]
pub async fn update_flow_checked(
    db: &mut Db<Transactional>,
    id: FlowId,
    request: UpdateFlowRequest,
    now: NaiveDateTime,
) -> Result<Flow, WireError> {
    let flow = flows::update_flow(db, id, request)
        .await
        .map_err(WireError::from_error)?;
    check_flow_plans(db, id, now).await?;
    Ok(flow)
}

/// Sets the Flow `id`'s Recurrence, refused when the change leaves a Plan rule broken.
#[tracing::instrument(skip(db, request))]
pub async fn set_flow_recurrence_checked(
    db: &mut Db<Transactional>,
    id: FlowId,
    request: SetRecurrenceRequest,
    now: NaiveDateTime,
) -> Result<FlowRecurrence, WireError> {
    let recurrence = flows::set_flow_recurrence(db, id, request)
        .await
        .map_err(WireError::from_error)?;
    check_flow_plans(db, id, now).await?;
    Ok(recurrence)
}

/// Refuses a write to the Flow `id` that left a Plan rule broken within its reach.
async fn check_flow_plans(
    db: &mut Db<Transactional>,
    id: FlowId,
    now: NaiveDateTime,
) -> Result<(), WireError> {
    plan_guard::check(db, now, &[format!("flow-{}", id.0)])
        .await
        .map_err(WireError::from_error)
}

/// Writes `request` to the Goal `id` — through the same guard as [`update_task_confirmed`], asked
/// before a Goal is marked Achieved.
#[tracing::instrument(skip(db, request))]
pub async fn update_goal_confirmed(
    db: &mut Db<Transactional>,
    id: &NodeId,
    request: UpdateGoalRequest,
    confirmed: bool,
    now: NaiveDateTime,
) -> Result<Goal, WireError> {
    if matches!(request.status, Some(GoalStatus::Achieved)) && !confirmed {
        refuse_over_unfinished_children(db, id, now).await?;
    }
    write::update_goal(db, id, request, now)
        .await
        .map_err(WireError::from_error)
}

/// Refuses for confirmation when the node `id` holds unfinished children.
async fn refuse_over_unfinished_children(
    db: &mut Db<Transactional>,
    id: &NodeId,
    now: NaiveDateTime,
) -> Result<(), WireError> {
    let open = write::unfinished_children(db, id, now)
        .await
        .map_err(WireError::from_error)?;
    if open.is_empty() {
        return Ok(());
    }
    Err(unfinished_refusal(&open))
}

/// Sets a Flow item's cycles — through the guard that asks, unless `reconcile` says how, before
/// the change would orphan what Habit iterations recorded against the old cycles. `fork_at` is
/// the instant a fork is taken at; `now` the instant the Plan rules are checked at.
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(skip(db, cycles))]
pub async fn set_item_cycles_confirmed(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    item_type: FlowItemType,
    item_id: i64,
    cycles: &[FlowCycleInput],
    reconcile: Option<Reconcile>,
    fork_at: Option<NaiveDateTime>,
    now: NaiveDateTime,
) -> Result<Option<ForkedTemplate>, WireError> {
    if reconcile.is_none() {
        let orphaned = flows::cycles::orphaned_edits(db, item_type, item_id, cycles)
            .await
            .map_err(WireError::from_error)?;
        if orphaned > 0 {
            return Err(WireError::needs_confirmation(
                format!("changing these cycles would orphan what {orphaned} iteration(s) recorded"),
                serde_json::json!({
                    "reason": "orphaned_edits",
                    "iterations": orphaned,
                }),
            ));
        }
    }
    let fork =
        flows::cycles::set_item_cycles(db, flow_id, item_type, item_id, cycles, reconcile, fork_at)
            .await
            .map_err(WireError::from_error)?;
    check_flow_plans(db, flow_id, now).await?;
    Ok(fork)
}

/// Deletes the wait `id`. A stored wait is deleted with its notes and every edge aimed at it; a
/// Habit's wait item occurrence is archived, as every occurrence is; any other derived wait is
/// refused — it goes with its Task, by completing it again or taking its template away.
#[tracing::instrument(skip(db))]
pub async fn delete_wait(
    db: &mut Db<Transactional>,
    id: &NodeId,
    now: NaiveDateTime,
) -> Result<(), WireError> {
    let derived = match id {
        NodeId::Stored(id) => {
            return crate::tasks::delete_expectation(db, ExpectationId(*id))
                .await
                .map_err(WireError::from_error)
        }
        NodeId::Derived(derived) => derived,
    };
    let key = crate::nodes::table::resolve_key(db, derived, now)
        .await
        .map_err(WireError::from_error)?;
    let crate::nodes::key::DerivedKey::Occurrence(key) = key else {
        return Err(WireError::from_error(FlowError::Refused(
            "a derived wait is not deleted; it goes with its Task".to_string(),
        )));
    };
    crate::flows::occurrence_edit::archive(db, &key)
        .await
        .map_err(WireError::from_error)
}

/// Deletes the Info `id`, and the attachment naming it when it is an added child of a Habit
/// occurrence — two writes, so that the attachment never outlives the row it names.
#[tracing::instrument(skip(db))]
pub async fn delete_info(db: &mut Db<Transactional>, id: i64) -> Result<(), WireError> {
    db.flows()
        .detach_instance_child("info", id)
        .await
        .map_err(WireError::from_error)?;
    db.infos()
        .delete(InfoId(id))
        .await
        .map_err(WireError::from_error)
}
