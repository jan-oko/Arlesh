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

use chrono::NaiveDateTime;

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
        Commitment, Delegate, Goal, Task, TaskArchival, TaskStatus, TimeScope,
        UpdateCommitmentRequest, UpdateGoalRequest, UpdateTaskRequest,
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
            let (_, window_start) = super::resolve_flow_window(flow, key.iteration.start_date())?;
            Ok(TemplateValues {
                title: flow.title.clone(),
                is_private: flow.is_private,
                position: position_of_root,
                plan: resolve_root_plan(flow, Some(window_start))?,
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
            let (_, window_start) = super::resolve_flow_window(flow, key.iteration.start_date())?;
            let plan = match resolve_cycle(pair.as_ref(), Some(window_start))? {
                Some(resolved) => resolved.plan,
                None => super::whole_scope_plan(pair.as_ref(), Some(window_start))?,
            };
            Ok(TemplateValues {
                title: task.title,
                is_private: task.is_private,
                position: task.position,
                plan,
                fields: task.template,
            })
        }
    }
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
    })
}

/// The occurrence as the virtual table serves it now, by kind.
enum Current {
    Task(Box<Task>),
    Goal(Box<Goal>),
    Commitment(Box<Commitment>),
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
        return Ok(Current::Task(Box::new(task)));
    }
    if let Some(goal) = rows.goals.into_iter().find(|goal| goal.id == id) {
        return Ok(Current::Goal(Box::new(goal)));
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
        Current::Task(task) => (Some(*task), None, None),
        Current::Goal(goal) => (None, Some(*goal), None),
        Current::Commitment(commitment) => (None, None, Some(*commitment)),
    })
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
fn resolved_at_ms(now: NaiveDateTime) -> i64 {
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
    let Current::Task(current) = current(db, &flow, key, now).await? else {
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

    // Starting an occurrence that reads as Agentic needs a Spec, exactly as starting a stored Task
    // does. It reads Agentic off its own value — its template's unless it overrides it — and
    // otherwise off the Habit's host, the node it hangs under.
    if matches!(request.status, Some(TaskStatus::InProgress))
        && current.status != TaskStatus::InProgress.as_str()
    {
        let own = match request.agentic {
            Some(agentic) => agentic.as_column(),
            None => current.agentic,
        };
        let brief = match &request.agentic_brief {
            Some(brief) => brief.clone(),
            None => current.agentic_brief.clone(),
        };
        let host = host_of(db, key).await?;
        crate::tasks::agentic::require_spec_to_start(
            db,
            own,
            (host.host_type.as_str(), host.host_id),
            &brief,
        )
        .await?;
    }
    // Its own brief keeps only what differs from its template's, field by field; clearing it goes
    // back to reading the template's.
    if let Some(brief) = &request.agentic_brief {
        crate::tasks::agentic::validate_brief(brief)?;
        overlay.set_brief(brief.as_ref(), template.fields.agentic_brief.as_ref());
    }

    if let Some(title) = request.title {
        overlay.title = (title != template.title).then_some(title);
    }
    if let Some(status) = &request.status {
        apply_task_status(&mut overlay, status, now);
        // Work under way is not work set aside — the same rule a stored Task follows.
        if *status == TaskStatus::InProgress && request.archival.is_none() {
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
    if let Some(plan) = request.plan {
        if let Some(plan) = &plan {
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
    // occurrence is Asynchronous.
    let asynchronous = overlay.asynchronous.unwrap_or(template.fields.asynchronous);
    let node_key = key.node_key();
    match (asynchronous, async_template) {
        (false, _) => {
            db.overlays()
                .put_async_template(flow_id.0, &node_key, None)
                .await?
        }
        (true, Some(wanted)) => {
            db.overlays()
                .put_async_template(flow_id.0, &node_key, wanted.as_ref())
                .await?
        }
        (true, None) => {}
    }
    db.overlays().put_task(flow_id.0, key, &overlay).await?;
    Ok(())
}

/// A Task status in the overlay's vocabulary: To Do is the default and clears it.
fn apply_task_status(overlay: &mut TaskOverlay, status: &TaskStatus, now: NaiveDateTime) {
    overlay.status = match status {
        TaskStatus::Todo => None,
        other => Some(other.as_str().to_string()),
    };
    overlay.resolved_at = (*status == TaskStatus::Done).then(|| resolved_at_ms(now));
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
    let window = occurrence_window(db, flow, key).await?;
    if interval_contains(window.window(), plan.window()) {
        return Ok(());
    }
    Err(crate::tasks::error::TaskError::ScopeContainment(
        "a plan must fall within the occurrence's window".to_string(),
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
        overlay.status = (status != "active").then(|| status.to_string());
        overlay.resolved_at = (status == "achieved").then(|| resolved_at_ms(now));
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
            "a habit's verdict window is set on the habit, for every iteration".to_string(),
        ));
    }
    let template = template_values(db, &flow, key, iteration_index(&current.origin)).await?;
    let mut overlay = db.overlays().commitment(key).await?;
    if let Some(title) = request.title {
        overlay.title = (title != template.title).then_some(title);
    }
    if let Some(verdict) = request.verdict {
        overlay.verdict = verdict.is_resolved().then(|| verdict.as_str().to_string());
        overlay.resolved_at = overlay.verdict.as_ref().map(|_| resolved_at_ms(now));
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
    /// The occurrence's window.
    pub window: TimeScope,
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
    let outer = host.window.window();
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
            Some(&host.window),
            child_type,
            child_id,
        )
        .await
}

/// Retyping an occurrence is refused: it is its template's kind in its iteration, and there is no
/// detaching it into a stored row of another kind (ADR 0008, decision 7).
pub fn refuse_retype() -> FlowError {
    FlowError::Refused(
        "a habit occurrence cannot change kind — retype its template item instead".to_string(),
    )
}

#[cfg(test)]
mod tests;
