//! Writes to a Habit occurrence: an ordinary update request, routed into the overlay.
//!
//! The editor sends a derived Task, Goal or Commitment the same request it sends a stored one
//! (ADR 0008, decision 6). Here that request becomes an overlay write for **this occurrence
//! only** — to change every occurrence, the template is edited instead — under one rule: a field
//! set to its template's value *clears* its override rather than pinning a copy, so the
//! occurrence goes back to following the template.
//!
//! What an occurrence cannot do is refused out loud (decision 7): it cannot leave its iteration
//! (its window and its parent are its iteration's), and it is never deleted — [`archive`] is what
//! Delete does to one. A request that merely repeats the occurrence's current window or parent,
//! as a full editor save does, is not a move and is let through.

use chrono::{NaiveDate, NaiveDateTime};

use super::{
    error::FlowError,
    model::{Flow, FlowId},
    occurrence_window,
    occurrences::{derive_habit, Horizon},
    resolve_cycle, resolve_root_plan,
    template::TemplateFields,
};
use crate::{
    database::session::{Db, SessionMode, Transactional},
    nodes::{
        id::NodeId,
        key::{OccurrenceKey, TemplateKind},
        origin::Origin,
        overlay::TaskOverlay,
    },
    scopes::resolve::interval_contains,
    tasks::model::{
        Commitment, CommitmentArchival, Delegate, Expectation, ExpectationArchival,
        ExpectationStatus, Goal, Status, Task, TaskArchival, TimeScope, UpdateCommitmentRequest,
        UpdateExpectationRequest, UpdateGoalRequest, UpdateTaskRequest,
    },
};

/// What an occurrence reads when nothing overrides it: its template's values.
struct TemplateValues {
    title: String,
    is_private: bool,
    position: i64,
    plan: Option<TimeScope>,
    fields: TemplateFields,
}

/// The template row an occurrence is drawn from, and its Cycle Plan resolved in the occurrence's
/// own iteration.
async fn template_values(
    db: &mut Db<Transactional>,
    flow: &Flow,
    key: &OccurrenceKey,
    position_of_root: i64,
) -> Result<TemplateValues, FlowError> {
    match key.item.item_type {
        TemplateKind::FlowRoot => {
            let window_start = window_start_of(flow, key)?;
            Ok(TemplateValues {
                title: flow.title.clone(),
                is_private: flow.is_private,
                position: position_of_root,
                plan: resolve_root_plan(flow, window_start)?,
                fields: flow.template.clone(),
            })
        }
        TemplateKind::FlowGoal => {
            let goal = db
                .flows()
                .list_goals(FlowId(flow.id))
                .await?
                .into_iter()
                .find(|goal| goal.id == key.item.item_id)
                .ok_or_else(|| FlowError::NodeNotFound(key.node_key()))?;
            Ok(TemplateValues {
                title: goal.title,
                is_private: goal.is_private,
                position: goal.position,
                plan: None,
                fields: goal.template,
            })
        }
        TemplateKind::FlowTask => {
            let task = db
                .flows()
                .list_tasks(FlowId(flow.id))
                .await?
                .into_iter()
                .find(|task| task.id == key.item.item_id)
                .ok_or_else(|| FlowError::NodeNotFound(key.node_key()))?;
            let pair = db.flows().cycle(key.cycle).await?;
            let window_start = window_start_of(flow, key)?;
            let plan = match resolve_cycle(pair.as_ref(), window_start)? {
                Some(resolved) => resolved.plan,
                None => super::whole_scope_plan(pair.as_ref(), window_start)?,
            };
            Ok(TemplateValues {
                title: task.title,
                is_private: task.is_private,
                position: task.position,
                plan,
                fields: task.template,
            })
        }
        TemplateKind::FlowCommitment => {
            let item = db.flows().commitment_item(key.item.item_id).await?;
            Ok(TemplateValues {
                title: item.title,
                is_private: item.is_private,
                position: item.position,
                plan: None,
                fields: item.template,
            })
        }
        TemplateKind::FlowExpectation => {
            let item = db.flows().expectation_item(key.item.item_id).await?;
            Ok(TemplateValues {
                title: item.title,
                is_private: item.is_private,
                position: item.position,
                plan: None,
                fields: item.template,
            })
        }
    }
}

/// The first day of the window an occurrence's iteration runs over, or `None` for an Unscoped
/// Interval Habit's, which has none.
fn window_start_of(flow: &Flow, key: &OccurrenceKey) -> Result<Option<NaiveDate>, FlowError> {
    Ok(super::iteration_window(flow, key.iteration)?.map(|(_, start)| start))
}

/// The ordinal of the iteration an occurrence is in — an iteration root's default position.
fn iteration_index(origin: &Origin) -> i64 {
    origin
        .habit()
        .map_or(0, |habit| habit.iteration_scope.index)
}

/// What the template an occurrence is drawn from says beyond its title and place.
pub async fn template_fields<M: SessionMode>(
    db: &mut Db<M>,
    key: &OccurrenceKey,
) -> Result<TemplateFields, FlowError> {
    let flow_id = db.flows().occurrence_flow_id(key).await?;
    Ok(match key.item.item_type {
        TemplateKind::FlowRoot => db.flows().get(flow_id).await?.template,
        TemplateKind::FlowGoal => db
            .flows()
            .list_goals(flow_id)
            .await?
            .into_iter()
            .find(|goal| goal.id == key.item.item_id)
            .map(|goal| goal.template)
            .unwrap_or_default(),
        TemplateKind::FlowTask => db
            .flows()
            .list_tasks(flow_id)
            .await?
            .into_iter()
            .find(|task| task.id == key.item.item_id)
            .map(|task| task.template)
            .unwrap_or_default(),
        TemplateKind::FlowCommitment => {
            db.flows().commitment_item(key.item.item_id).await?.template
        }
        TemplateKind::FlowExpectation => {
            db.flows()
                .expectation_item(key.item.item_id)
                .await?
                .template
        }
    })
}

/// The occurrence as the virtual table serves it now, by kind. A Task carries whether it is
/// flagged Overdue now, which lifts the bound its window puts on its Plan.
enum Current {
    Task(Box<Task>, bool),
    Goal(Box<Goal>),
    Commitment(Box<Commitment>),
    Expectation(Box<Expectation>),
}

/// Derives the one occurrence `key` names, as its row.
async fn current(
    db: &mut Db<Transactional>,
    flow: &Flow,
    key: &OccurrenceKey,
    now: NaiveDateTime,
) -> Result<Current, FlowError> {
    let rows = derive_habit(
        db,
        flow,
        now,
        Horizon {
            through: Some(key.iteration.start_date()),
        },
    )
    .await?;
    let id = NodeId::Derived(key.id());
    if let Some(task) = rows.tasks.into_iter().find(|task| task.id == id) {
        let overdue = rows
            .lifecycles
            .iter()
            .any(|lifecycle| lifecycle.node_id == id && lifecycle.overdue);
        return Ok(Current::Task(Box::new(task), overdue));
    }
    if let Some(goal) = rows.goals.into_iter().find(|goal| goal.id == id) {
        return Ok(Current::Goal(Box::new(goal)));
    }
    if let Some(wait) = rows.expectations.into_iter().find(|wait| wait.id == id) {
        return Ok(Current::Expectation(Box::new(wait)));
    }
    rows.commitments
        .into_iter()
        .find(|commitment| commitment.id == id)
        .map(|commitment| Current::Commitment(Box::new(commitment)))
        .ok_or_else(|| FlowError::NodeNotFound(key.node_key()))
}

/// Derives the one occurrence `key` names, as the Task, Goal or Commitment it is.
pub async fn occurrence_row(
    db: &mut Db<Transactional>,
    key: &OccurrenceKey,
    now: NaiveDateTime,
) -> Result<(Option<Task>, Option<Goal>, Option<Commitment>), FlowError> {
    let flow_id = db.flows().occurrence_flow_id(key).await?;
    let flow = db.flows().get(flow_id).await?;
    Ok(match current(db, &flow, key, now).await? {
        Current::Task(task, _) => (Some(*task), None, None),
        Current::Goal(goal) => (None, Some(*goal), None),
        Current::Commitment(commitment) => (None, None, Some(*commitment)),
        Current::Expectation(_) => (None, None, None),
    })
}

/// Derives the one wait item occurrence `key` names, as the Expectation it is.
pub async fn wait_occurrence_row(
    db: &mut Db<Transactional>,
    key: &OccurrenceKey,
    now: NaiveDateTime,
) -> Result<Expectation, FlowError> {
    let flow_id = db.flows().occurrence_flow_id(key).await?;
    let flow = db.flows().get(flow_id).await?;
    match current(db, &flow, key, now).await? {
        Current::Expectation(wait) => Ok(*wait),
        _ => Err(FlowError::Refused(
            "this occurrence is not a wait".to_string(),
        )),
    }
}

/// A wait item occurrence as its item draws it, before anything written to it: what a write
/// compares against, so a field set back to it clears the override.
fn drawn_wait(
    item: &super::model::FlowExpectation,
    current: &Expectation,
) -> Result<Expectation, FlowError> {
    let opens = current
        .time_scope
        .as_ref()
        .map(|scope| scope.window().0)
        .or(current.check_starting);
    let check_starting = match (&item.check_every, opens) {
        (Some(_), Some(opens)) => Some(super::rules::items::first_check_at(
            opens,
            item.first_check.as_ref(),
        )?),
        _ => None,
    };
    Ok(Expectation {
        title: item.title.clone(),
        is_private: item.is_private,
        check_every: item.check_every.clone(),
        check_starting,
        archival: ExpectationArchival::Live,
        status: ExpectationStatus::Pending,
        agentic: false,
        agentic_note: None,
        question: false,
        answer: None,
        ..current.clone()
    })
}

/// Applies an ordinary Expectation update to one wait item occurrence: its title, Check every,
/// Starting and privacy into its overlay as overrides of what its item draws, and its status — it
/// is released on its own — and archive as its own. It cannot leave its iteration or change its
/// window, and it is not an agent's wait.
#[tracing::instrument(skip(db, request))]
pub async fn update_wait(
    db: &mut Db<Transactional>,
    key: &OccurrenceKey,
    request: UpdateExpectationRequest,
    now: NaiveDateTime,
) -> Result<(), FlowError> {
    let flow_id = db.flows().occurrence_flow_id(key).await?;
    let current = wait_occurrence_row(db, key, now).await?;
    refuse_moves(
        (request.parent_type.as_ref(), request.parent_id.as_ref()),
        (&current.parent_type, &current.parent_id),
        request.time_scope.as_ref(),
        &current.time_scope,
    )?;
    if request.agentic == Some(true) {
        return Err(FlowError::Refused(
            "a habit's wait is not one an agent raised".to_string(),
        ));
    }
    let item = db.flows().expectation_item(key.item.item_id).await?;
    let drawn = drawn_wait(&item, &current)?;
    let node_key = key.node_key();
    let mut overlay = db.overlays().expectation(&node_key).await?;
    if let Some(title) = request.title {
        overlay.set_title(title, &drawn);
    }
    if let Some(every) = request.check_every {
        overlay.set_check_every(every, &drawn);
    }
    if let Some(starting) = request.check_starting {
        let shown = current
            .check_starting
            .is_some_and(|shown| shown.date() == starting.date());
        if !shown {
            overlay.set_check_starting(starting, &drawn);
        }
    }
    if let Some(is_private) = request.is_private {
        overlay.set_is_private(is_private, &drawn);
    }
    if let Some(status) = request.status {
        let released = status == ExpectationStatus::Released;
        let was = overlay.status.as_deref() == Some("released");
        overlay.status = released.then(|| status.as_str().to_string());
        overlay.released_at = match (released, was) {
            (true, true) => overlay
                .released_at
                .take()
                .or_else(|| Some(crate::tasks::waits::instant_column(now))),
            (true, false) => Some(crate::tasks::waits::instant_column(now)),
            (false, _) => None,
        };
    }
    if let Some(archival) = request.archival {
        overlay.set_archival(archival, &drawn);
    }
    let home = crate::nodes::wait_overlay::WaitHome {
        flow_id: Some(flow_id.0),
        occurrence_key: Some(node_key.clone()),
    };
    db.overlays()
        .put_expectation(&node_key, &home, &overlay)
        .await?;
    Ok(())
}

/// Refuses a move out of the occurrence's iteration: a new parent, or a new window. A request
/// repeating the current ones — a full editor save — passes.
fn refuse_moves(
    parent: (Option<&String>, Option<&NodeId>),
    current_parent: (&str, &NodeId),
    time_scope: Option<&Option<TimeScope>>,
    current_scope: &Option<TimeScope>,
) -> Result<(), FlowError> {
    let moves = match parent {
        (None, None) => false,
        (Some(parent_type), Some(parent_id)) => {
            parent_type != current_parent.0 || current_parent.1 != parent_id
        }
        _ => true,
    };
    if moves {
        return Err(FlowError::Refused(
            "a habit occurrence belongs to its iteration and cannot be moved out of it".to_string(),
        ));
    }
    let rescopes = time_scope.is_some_and(|wanted| {
        let ignoring_duration =
            |scope: &Option<TimeScope>| scope.as_ref().map(|scope| (scope.start_id, scope.end_id));
        ignoring_duration(wanted) != ignoring_duration(current_scope)
    });
    if rescopes {
        return Err(FlowError::Refused(
            "a habit occurrence's window is its iteration's, and cannot be changed".to_string(),
        ));
    }
    Ok(())
}

/// The epoch-millisecond instant a completion is recorded at: `now`'s wall-clock reading, the
/// same local-naive clock the iteration windows are laid on.
pub(super) fn resolved_at_ms(now: NaiveDateTime) -> i64 {
    now.and_utc().timestamp_millis()
}

/// Applies an ordinary Task update to one occurrence's overlay.
#[tracing::instrument(skip(db, request))]
pub async fn update_task(
    db: &mut Db<Transactional>,
    key: &OccurrenceKey,
    request: UpdateTaskRequest,
    now: NaiveDateTime,
) -> Result<(), FlowError> {
    let flow_id = db.flows().occurrence_flow_id(key).await?;
    let flow = db.flows().get(flow_id).await?;
    let Current::Task(current, overdue) = current(db, &flow, key, now).await? else {
        return Err(FlowError::Refused(
            "this occurrence is not a task".to_string(),
        ));
    };
    refuse_moves(
        (request.parent_type.as_ref(), request.parent_id.as_ref()),
        (&current.parent_type, &current.parent_id),
        request.time_scope.as_ref(),
        &current.time_scope,
    )?;
    let async_template = request.async_template.clone();
    let template = template_values(db, &flow, key, iteration_index(&current.origin)).await?;
    let mut overlay = db.overlays().task(key).await?;

    // A compound occurrence's status is derived from its sub-items, as a compound Task's is: a
    // status is refused, unless the same request switches compound off, when the status it names
    // (the derived one, which `nodes::write` names when the caller does not) is the one kept.
    let releases = current.compound && request.compound == Some(false);
    if current.compound && !releases && request.status.is_some() {
        return Err(crate::tasks::error::TaskError::CompoundOccurrenceStatus.into());
    }
    if let Some(compound) = request.compound {
        overlay.compound = (compound != template.fields.compound).then_some(compound);
    }

    // What the occurrence reads as after the write — by the one resolver the app's tree agrees
    // with: its own value, its template tree, then the Habit's host — decides its status model,
    // as a stored Task's kind does.
    let agentic = match request.agentic.map(|agentic| agentic.as_column()) {
        Some(Some(flag)) => flag,
        Some(None) => crate::tasks::agentic::occurrence_inherits_agentic(db, key).await?,
        None => crate::tasks::agentic::occurrence_reads_agentic(db, key).await?,
    };
    let before = current.status.stored();
    let status =
        crate::tasks::agentic::settle_status(&current.title, before, request.status, agentic)?;
    // Starting an occurrence that reads as Agentic needs a Spec, exactly as starting a stored Task
    // does. Keeping a compound's derived status is not a start.
    if !releases && request.status.as_ref().is_some_and(Status::is_begun) && !before.is_begun() {
        let brief = match &request.agentic_brief {
            Some(brief) => brief.clone(),
            None => current.agentic_brief.clone(),
        };
        crate::tasks::agentic::require_spec(agentic, &brief)?;
    }
    // Its own brief keeps only what differs from its template's, field by field; clearing it goes
    // back to reading the template's.
    if let Some(brief) = &request.agentic_brief {
        overlay.set_brief(brief.as_ref(), template.fields.agentic_brief.as_ref());
    }

    if let Some(title) = request.title {
        overlay.title = (title != template.title).then_some(title);
    }
    if request.status.is_none() && status != before {
        // A change of kind converts the status it held, and nothing else about it.
        overlay.status = (!status.is_todo())
            .then(|| status.as_db().map(str::to_string))
            .flatten();
    }
    if request.status.is_some() {
        apply_task_status(&mut overlay, &status, now);
        // Begun work is not work set aside — the same rule a stored Task follows. Keeping a
        // compound's derived status begins nothing.
        if status.is_begun() && request.archival.is_none() && !releases {
            overlay.archival = (template.fields.archival != TaskArchival::Live)
                .then(|| TaskArchival::Live.as_str().to_string());
        }
    }
    if let Some(delegate) = request.delegate_to {
        let own = delegate != template.fields.delegate_to;
        let (kind, id) = Delegate::columns(if own { delegate } else { None });
        overlay.delegate_set = own;
        overlay.delegate_kind = kind.map(str::to_string);
        overlay.delegate_id = id;
    }
    if let Some(agentic) = request.agentic {
        let own = agentic.as_column() != template.fields.agentic;
        overlay.agentic = if own { agentic.as_column() } else { None };
        overlay.agentic_set = own;
    }
    if let Some(asynchronous) = request.asynchronous {
        overlay.asynchronous =
            (asynchronous != template.fields.asynchronous).then_some(asynchronous);
    }
    // An explicit due lands in the overlay, where it wins over the one its Habit's clock derives;
    // clearing it goes back to that default. It is held within the occurrence's window, as a
    // stored Task's is within its Time Scope.
    if let Some(due) = request.due_scope {
        if let Some(due) = &due {
            check_due(db, &flow, key, current.time_scope.as_ref(), due).await?;
        }
        overlay.due_scope_start_id = due.as_ref().map(|due| due.start_id);
        overlay.due_scope_end_id = due.as_ref().map(|due| due.end_id);
    }
    if let Some(plan) = request.plan {
        // An Overdue occurrence may be planned past its window, as an Overdue stored Task may:
        // late work has to be rescheduled somewhere, and that is only ever later.
        if let (Some(plan), false) = (&plan, overdue) {
            check_plan(db, &flow, key, plan).await?;
        }
        let same_as_template = plan.as_ref().map(|plan| (plan.start_id, plan.end_id))
            == template
                .plan
                .as_ref()
                .map(|plan| (plan.start_id, plan.end_id));
        overlay.plan_set = !same_as_template;
        let (start, end) = match (&plan, same_as_template) {
            (Some(plan), false) => (Some(plan.start_id), Some(plan.end_id)),
            _ => (None, None),
        };
        overlay.plan_start_id = start;
        overlay.plan_end_id = end;
        // Scheduling a backlogged occurrence takes it out of the backlog, as for a stored Task.
        if plan.is_some() && request.archival.is_none() {
            overlay.archival = (template.fields.archival != TaskArchival::Live)
                .then(|| TaskArchival::Live.as_str().to_string());
        }
    }
    if let Some(archival) = request.archival {
        if archival == TaskArchival::Archived {
            return Err(crate::tasks::error::TaskError::ArchiveOnDerived.into());
        }
        let planned = if overlay.plan_set {
            overlay.plan_start_id.is_some()
        } else {
            template.plan.is_some()
        };
        if archival == TaskArchival::Backlog && planned {
            return Err(crate::tasks::error::TaskError::BacklogWithPlan.into());
        }
        overlay.archival =
            (archival != template.fields.archival).then(|| archival.as_str().to_string());
    }
    if let Some(position) = request.position {
        overlay.position = (position != template.position).then_some(position);
    }
    if let Some(is_private) = request.is_private {
        overlay.is_private = (is_private != template.is_private).then_some(is_private);
    }
    // An occurrence's own Expectation template, kept — as a stored Task's is — only while the
    // occurrence is Asynchronous. One the same as its item's goes back to reading the item's; any
    // other — none included — is its own.
    let asynchronous = overlay.asynchronous.unwrap_or(template.fields.asynchronous);
    let node_key = key.node_key();
    let own_template = match (asynchronous, async_template) {
        (false, _) => {
            overlay.async_template_set = false;
            Some(None)
        }
        (true, Some(wanted)) if wanted == template.fields.async_template => {
            overlay.async_template_set = false;
            Some(None)
        }
        (true, Some(wanted)) => {
            overlay.async_template_set = true;
            Some(wanted)
        }
        (true, None) => None,
    };
    if let Some(own) = own_template {
        db.overlays()
            .put_async_template(flow_id.0, &node_key, own.as_ref())
            .await?;
    }
    db.overlays().put_task(flow_id.0, key, &overlay).await?;
    // The occurrences beneath it in the template tree, and the rows hung on them, may change kind
    // with it.
    if request.agentic.is_some() {
        crate::tasks::agentic::reconcile(db, vec![crate::tasks::agentic::Reach::Habit(flow_id.0)])
            .await?;
    }
    Ok(())
}

/// A Task status in the overlay's vocabulary, in either model: To Do is the default and clears
/// it.
///
/// Saving a done occurrence as done again — in either model — keeps the instant it was done, as a
/// stored Task keeps its `done_at`, since that instant is what an Interval's next window and a
/// cooldown count from, and the editor names the status on every save.
fn apply_task_status(overlay: &mut TaskOverlay, status: &Status, now: NaiveDateTime) {
    let was_done = Status::is_done_db(overlay.status.as_deref());
    overlay.status = match status {
        status if status.is_todo() => None,
        other => other.as_db().map(str::to_string),
    };
    overlay.resolved_at = match (status.is_done(), was_done) {
        (true, true) => overlay.resolved_at.or_else(|| Some(resolved_at_ms(now))),
        (true, false) => Some(resolved_at_ms(now)),
        (false, _) => None,
    };
    // A status given to an archived occurrence brings it back into play.
    overlay.tombstone = None;
}

/// Refuses a Plan outside the occurrence's own window.
async fn check_plan(
    db: &mut Db<Transactional>,
    flow: &Flow,
    key: &OccurrenceKey,
    plan: &TimeScope,
) -> Result<(), FlowError> {
    let Some(window) = occurrence_window(db, flow, key).await? else {
        return Ok(());
    };
    if interval_contains(window.window(), plan.window()) {
        return Ok(());
    }
    Err(crate::tasks::error::TaskError::ScopeContainment(
        "a plan must fall within the occurrence's window".to_string(),
    )
    .into())
}

/// Refuses a due outside the occurrence's relevance — its own Time Scope when it carries one
/// (an iteration root's reaches back over the windows it carries), else its window. An
/// occurrence of an Unscoped Interval Habit has neither, and may be given any due.
async fn check_due(
    db: &mut Db<Transactional>,
    flow: &Flow,
    key: &OccurrenceKey,
    time_scope: Option<&TimeScope>,
    due: &TimeScope,
) -> Result<(), FlowError> {
    let window = match time_scope {
        Some(scope) => Some(scope.clone()),
        None => occurrence_window(db, flow, key).await?,
    };
    let Some(window) = window else {
        return Ok(());
    };
    if interval_contains(window.window(), due.window()) {
        return Ok(());
    }
    Err(crate::tasks::error::TaskError::ScopeContainment(
        "due is not within the task's time scope".to_string(),
    )
    .into())
}

/// Applies an ordinary Goal update to one occurrence's overlay.
#[tracing::instrument(skip(db, request))]
pub async fn update_goal(
    db: &mut Db<Transactional>,
    key: &OccurrenceKey,
    request: UpdateGoalRequest,
    now: NaiveDateTime,
) -> Result<(), FlowError> {
    let flow_id = db.flows().occurrence_flow_id(key).await?;
    let flow = db.flows().get(flow_id).await?;
    let Current::Goal(current) = current(db, &flow, key, now).await? else {
        return Err(FlowError::Refused(
            "this occurrence is not a goal".to_string(),
        ));
    };
    refuse_moves(
        (request.parent_type.as_ref(), request.parent_id.as_ref()),
        (&current.parent_type, &current.parent_id),
        request.time_scope.as_ref(),
        &current.time_scope,
    )?;
    let template = template_values(db, &flow, key, iteration_index(&current.origin)).await?;
    let mut overlay = db.overlays().goal(key).await?;
    if let Some(title) = request.title {
        overlay.title = (title != template.title).then_some(title);
    }
    if let Some(status) = request.status {
        let status = status.as_str();
        let was_achieved = overlay.status.as_deref() == Some("achieved");
        overlay.status = (status != "active").then(|| status.to_string());
        // Saving an achieved occurrence again keeps the instant it was achieved: that instant is
        // what an Interval's next window and a cooldown count from.
        overlay.resolved_at = match (status == "achieved", was_achieved) {
            (true, true) => overlay.resolved_at.or_else(|| Some(resolved_at_ms(now))),
            (true, false) => Some(resolved_at_ms(now)),
            (false, _) => None,
        };
        overlay.tombstone = None;
    }
    if let Some(position) = request.position {
        overlay.position = (position != template.position).then_some(position);
    }
    if let Some(is_private) = request.is_private {
        overlay.is_private = (is_private != template.is_private).then_some(is_private);
    }
    db.overlays().put_goal(flow_id.0, key, &overlay).await?;
    Ok(())
}

/// Applies an ordinary Commitment update to one occurrence's overlay. Its Verdict Window is the
/// Habit's, set on the flow; naming a different one here is refused.
#[tracing::instrument(skip(db, request))]
pub async fn update_commitment(
    db: &mut Db<Transactional>,
    key: &OccurrenceKey,
    request: UpdateCommitmentRequest,
    now: NaiveDateTime,
) -> Result<(), FlowError> {
    let flow_id = db.flows().occurrence_flow_id(key).await?;
    let flow = db.flows().get(flow_id).await?;
    let Current::Commitment(current) = current(db, &flow, key, now).await? else {
        return Err(FlowError::Refused(
            "this occurrence is not a commitment".to_string(),
        ));
    };
    refuse_moves(
        (request.parent_type.as_ref(), request.parent_id.as_ref()),
        (&current.parent_type, &current.parent_id),
        request.time_scope.as_ref(),
        &current.time_scope,
    )?;
    if request
        .verdict_window
        .as_ref()
        .is_some_and(|wanted| *wanted != current.verdict_window)
    {
        return Err(FlowError::Refused(
            "an occurrence's verdict window is set on its template, for every occurrence"
                .to_string(),
        ));
    }
    // An occurrence has no hand archive: it is archived through its tombstone. Live, which it
    // always is, is no change.
    if request.archival == Some(CommitmentArchival::Archived) {
        return Err(crate::tasks::error::TaskError::ArchiveOnDerived.into());
    }
    let template = template_values(db, &flow, key, iteration_index(&current.origin)).await?;
    let mut overlay = db.overlays().commitment(key).await?;
    if let Some(title) = request.title {
        overlay.title = (title != template.title).then_some(title);
    }
    if let Some(verdict) = request.verdict {
        let unchanged = overlay.verdict.as_deref() == Some(verdict.as_str());
        overlay.verdict = verdict.is_resolved().then(|| verdict.as_str().to_string());
        // The same verdict saved again keeps the instant it was recorded: a cooldown and an
        // Interval's next window count from it.
        overlay.resolved_at = match (verdict.is_resolved(), unchanged) {
            (true, true) => overlay.resolved_at.or_else(|| Some(resolved_at_ms(now))),
            (true, false) => Some(resolved_at_ms(now)),
            (false, _) => None,
        };
        overlay.tombstone = None;
    }
    if let Some(position) = request.position {
        overlay.position = (position != template.position).then_some(position);
    }
    if let Some(is_private) = request.is_private {
        overlay.is_private = (is_private != template.is_private).then_some(is_private);
    }
    db.overlays()
        .put_commitment(flow_id.0, key, &overlay)
        .await?;
    Ok(())
}

/// Delete, for an occurrence: it is **archived**, as a manually archived node is, never removed —
/// the iteration it belongs to still happened. Its status and edits stay beneath the tombstone,
/// and giving it a status again brings it back.
#[tracing::instrument(skip(db))]
pub async fn archive(db: &mut Db<Transactional>, key: &OccurrenceKey) -> Result<(), FlowError> {
    let flow_id = db.flows().occurrence_flow_id(key).await?;
    let kind = db
        .flows()
        .occurrence_kind(flow_id, key.item.item_type)
        .await?;
    let tombstone = Some("archived".to_string());
    match kind {
        "goal" => {
            let mut overlay = db.overlays().goal(key).await?;
            overlay.tombstone = tombstone;
            db.overlays().put_goal(flow_id.0, key, &overlay).await?;
        }
        "commitment" => {
            let mut overlay = db.overlays().commitment(key).await?;
            overlay.tombstone = tombstone;
            db.overlays()
                .put_commitment(flow_id.0, key, &overlay)
                .await?;
        }
        "expectation" => {
            let node_key = key.node_key();
            let mut overlay = db.overlays().expectation(&node_key).await?;
            overlay.archival = Some(ExpectationArchival::Archived.as_str().to_string());
            let home = crate::nodes::wait_overlay::WaitHome {
                flow_id: Some(flow_id.0),
                occurrence_key: Some(node_key.clone()),
            };
            db.overlays()
                .put_expectation(&node_key, &home, &overlay)
                .await?;
        }
        _ => {
            let mut overlay = db.overlays().task(key).await?;
            overlay.tombstone = tombstone;
            db.overlays().put_task(flow_id.0, key, &overlay).await?;
        }
    }
    Ok(())
}

/// Where a stored node hung on an occurrence is written, and what it hangs on.
///
/// The node's own `parent_type`/`parent_id` name the Habit's **host** — its Target Node — because
/// an occurrence has no integer id for them to hold. The attachment is what makes the occurrence
/// its parent, and the occurrence's window, settled here, is what governs it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OccurrenceHost {
    /// The Habit.
    pub flow_id: FlowId,
    /// What the occurrence is: `task`, `goal` or `commitment`.
    pub parent_kind: &'static str,
    /// The occurrence's window; `None` for an Unscoped Interval Habit's, which has none.
    pub window: Option<TimeScope>,
    /// The host's parent type, as a child row spells it.
    pub host_type: String,
    /// The host's row id.
    pub host_id: i64,
}

/// The host a node hung on the occurrence `key` is written under.
pub async fn host_of<M: SessionMode>(
    db: &mut Db<M>,
    key: &OccurrenceKey,
) -> Result<OccurrenceHost, FlowError> {
    let flow_id = db.flows().occurrence_flow_id(key).await?;
    let flow = db.flows().get(flow_id).await?;
    let window = occurrence_window(db, &flow, key).await?;
    let parent_kind = db
        .flows()
        .occurrence_kind(flow_id, key.item.item_type)
        .await?;
    let (host_type, host_id) = match (&flow.target_type, flow.target_id) {
        (Some(kind), Some(id)) => (super::target_parent_type(kind), id),
        _ => (super::target_parent_type(&flow.parent_type), flow.parent_id),
    };
    Ok(OccurrenceHost {
        flow_id,
        parent_kind,
        window,
        host_type,
        host_id,
    })
}

/// Refuses a child's window or Plan that escapes the occurrence it hangs on. Containment holds
/// here as everywhere: a child cannot outrun its parent.
pub fn check_within(
    host: &OccurrenceHost,
    time_scope: Option<&TimeScope>,
    plan: Option<&TimeScope>,
) -> Result<(), FlowError> {
    let Some(outer) = host.window.as_ref().map(TimeScope::window) else {
        return Ok(());
    };
    let escapes = |inner: &TimeScope| !interval_contains(outer, inner.window());
    if time_scope.is_some_and(escapes) || plan.is_some_and(escapes) {
        return Err(crate::tasks::error::TaskError::ScopeContainment(
            "a node hung on a habit occurrence must fall within the occurrence's window"
                .to_string(),
        )
        .into());
    }
    Ok(())
}

/// Attaches a stored row to an occurrence — or moves its attachment there — as the row's own
/// write's second half.
pub async fn attach(
    db: &mut Db<Transactional>,
    host: &OccurrenceHost,
    key: &OccurrenceKey,
    child_type: &str,
    child_id: i64,
) -> Result<(), FlowError> {
    db.flows()
        .detach_instance_child(child_type, child_id)
        .await?;
    db.flows()
        .attach_instance_child(
            host.flow_id,
            host.parent_kind,
            key,
            host.window.as_ref(),
            child_type,
            child_id,
        )
        .await
}

#[cfg(test)]
mod tests;
