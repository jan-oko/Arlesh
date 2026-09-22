//! Tauri commands for flow operations.
//!
//! Read-only work and single writes open a pooled session with `factory.connect()`. Everything
//! that writes more than once, or writes something it read first, opens `factory.begin()` and
//! commits — and each of those has a command-level test in `tests/flows_commands.rs`, because a
//! deleted `commit()` still compiles and rolls back silently. See ADR-0004.

use tauri::State;

use crate::{
    database::session::SessionFactory,
    error::WireError,
    flows::{
        self,
        model::{
            CreateFlowItemRequest, CreateFlowRequest, Flow, FlowCycleInput, FlowDependency,
            FlowGoal, FlowId, FlowItemCycle, FlowItemType, FlowOrigin, FlowRecurrence, FlowTask,
            HabitInstanceChild, HabitInstanceRef, HabitItemStatus, HabitIteration,
            MaterializedFlow, SetRecurrenceRequest, StartFlowRequest, TargetRef, UnfinishedChild,
            UpdateFlowItemRequest, UpdateFlowRequest,
        },
    },
};

/// Creates a new flow.
#[tauri::command]
pub async fn create_flow(
    factory: State<'_, SessionFactory>,
    request: CreateFlowRequest,
) -> Result<Flow, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.flows()
        .create(request)
        .await
        .map_err(WireError::from_error)
}

/// Fetches a flow by id.
#[tauri::command]
pub async fn get_flow(factory: State<'_, SessionFactory>, id: i64) -> Result<Flow, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.flows()
        .get(FlowId(id))
        .await
        .map_err(WireError::from_error)
}

/// Lists all flows.
#[tauri::command]
pub async fn list_flows(factory: State<'_, SessionFactory>) -> Result<Vec<Flow>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.flows().list().await.map_err(WireError::from_error)
}

/// Updates a flow.
#[tauri::command]
pub async fn update_flow(
    factory: State<'_, SessionFactory>,
    id: i64,
    request: UpdateFlowRequest,
) -> Result<Flow, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let flow = flows::update_flow(&mut db, FlowId(id), request)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(flow)
}

/// Deletes a flow (and its items).
#[tauri::command]
pub async fn delete_flow(factory: State<'_, SessionFactory>, id: i64) -> Result<(), WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    flows::delete_flow(&mut db, FlowId(id))
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)
}

/// Creates a flow-goal item.
#[tauri::command]
pub async fn create_flow_goal(
    factory: State<'_, SessionFactory>,
    request: CreateFlowItemRequest,
) -> Result<FlowGoal, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.flows()
        .create_goal(request)
        .await
        .map_err(WireError::from_error)
}

/// Creates a flow-task item.
#[tauri::command]
pub async fn create_flow_task(
    factory: State<'_, SessionFactory>,
    request: CreateFlowItemRequest,
) -> Result<FlowTask, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.flows()
        .create_task(request)
        .await
        .map_err(WireError::from_error)
}

/// Lists a flow's goal items.
#[tauri::command]
pub async fn list_flow_goals(
    factory: State<'_, SessionFactory>,
    flow_id: i64,
) -> Result<Vec<FlowGoal>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.flows()
        .list_goals(FlowId(flow_id))
        .await
        .map_err(WireError::from_error)
}

/// Lists a flow's task items.
#[tauri::command]
pub async fn list_flow_tasks(
    factory: State<'_, SessionFactory>,
    flow_id: i64,
) -> Result<Vec<FlowTask>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.flows()
        .list_tasks(FlowId(flow_id))
        .await
        .map_err(WireError::from_error)
}

/// Lists every flow's goal items.
#[tauri::command]
pub async fn list_all_flow_goals(
    factory: State<'_, SessionFactory>,
) -> Result<Vec<FlowGoal>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.flows()
        .list_all_goals()
        .await
        .map_err(WireError::from_error)
}

/// Lists every flow's task items.
#[tauri::command]
pub async fn list_all_flow_tasks(
    factory: State<'_, SessionFactory>,
) -> Result<Vec<FlowTask>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.flows()
        .list_all_tasks()
        .await
        .map_err(WireError::from_error)
}

/// Updates a flow-goal item.
#[tauri::command]
pub async fn update_flow_goal(
    factory: State<'_, SessionFactory>,
    id: i64,
    request: UpdateFlowItemRequest,
) -> Result<FlowGoal, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let goal = flows::update_flow_goal(&mut db, id, request)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(goal)
}

/// Updates a flow-task item.
#[tauri::command]
pub async fn update_flow_task(
    factory: State<'_, SessionFactory>,
    id: i64,
    request: UpdateFlowItemRequest,
) -> Result<FlowTask, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let task = flows::update_flow_task(&mut db, id, request)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(task)
}

/// Starts a flow, materialising it into a real subtree under the target.
#[tauri::command]
pub async fn start_flow(
    factory: State<'_, SessionFactory>,
    flow_id: i64,
    request: StartFlowRequest,
) -> Result<MaterializedFlow, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let materialized = flows::start(&mut db, FlowId(flow_id), request)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(materialized)
}

/// Returns the subset of `candidates` a flow of the given duration may validly target. With a
/// concrete `anchor_date`, containment is exact; without one it is the coarse template-time check.
/// A `null` duration (Unscoped flow) accepts every candidate.
#[tauri::command]
pub async fn scope_valid_flow_targets(
    factory: State<'_, SessionFactory>,
    duration_n: Option<i64>,
    duration_kind: Option<String>,
    anchor_date: Option<chrono::NaiveDate>,
    candidates: Vec<TargetRef>,
) -> Result<Vec<TargetRef>, WireError> {
    let duration = match (duration_n, duration_kind) {
        (Some(n), Some(kind)) => Some((n, kind)),
        _ => None,
    };
    // Transactional despite reading like a query: resolving a concrete window creates the
    // canonical scopes it names.
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let valid = flows::valid_targets(&mut db, duration, anchor_date, candidates)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(valid)
}

/// Sets (creates or replaces) a flow's Recurrence, making it a Habit.
#[tauri::command]
pub async fn set_flow_recurrence(
    factory: State<'_, SessionFactory>,
    flow_id: i64,
    request: SetRecurrenceRequest,
) -> Result<FlowRecurrence, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let recurrence = flows::set_flow_recurrence(&mut db, FlowId(flow_id), request)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(recurrence)
}

/// Fetches a flow's Recurrence, or `null` if it is a plain (non-habit) flow.
#[tauri::command]
pub async fn get_flow_recurrence(
    factory: State<'_, SessionFactory>,
    flow_id: i64,
) -> Result<Option<FlowRecurrence>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.flows()
        .get_recurrence(FlowId(flow_id))
        .await
        .map_err(WireError::from_error)
}

/// Deletes a flow's Recurrence, demoting the Habit back to a plain flow.
#[tauri::command]
pub async fn delete_flow_recurrence(
    factory: State<'_, SessionFactory>,
    flow_id: i64,
) -> Result<(), WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.flows()
        .delete_recurrence(FlowId(flow_id))
        .await
        .map_err(WireError::from_error)
}

/// Derives a Habit's iterations on `today`, each classified per its Consumption behavior.
#[tauri::command]
pub async fn generate_habit_iterations(
    factory: State<'_, SessionFactory>,
    flow_id: i64,
    now: chrono::NaiveDateTime,
) -> Result<Vec<HabitIteration>, WireError> {
    // Transactional despite reading like a query: materialising each iteration window creates the
    // scopes it lands on.
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let iterations = flows::generate_habit_iterations(&mut db, FlowId(flow_id), now)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(iterations)
}

/// For each of `nodes` that was materialised from a flow, returns its originating flow title.
#[tauri::command]
pub async fn flow_origins(
    factory: State<'_, SessionFactory>,
    nodes: Vec<TargetRef>,
) -> Result<Vec<FlowOrigin>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.flows()
        .origins(nodes)
        .await
        .map_err(WireError::from_error)
}

/// Every real node materialised by a started flow, for the mindmap's flow-instance badge.
#[tauri::command]
pub async fn list_flow_instance_nodes(
    factory: State<'_, SessionFactory>,
) -> Result<Vec<TargetRef>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.flows()
        .list_instance_node_refs()
        .await
        .map_err(WireError::from_error)
}

/// Converts a flow item to the other kind (goal↔task), preserving its cycles and dependencies.
#[tauri::command]
pub async fn convert_flow_item(
    factory: State<'_, SessionFactory>,
    from_type: FlowItemType,
    id: i64,
    to_type: FlowItemType,
) -> Result<i64, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let new_id = flows::convert_flow_item(&mut db, from_type, id, to_type)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(new_id)
}

/// Deletes a flow item (goal or task) and its cycles and dependency links.
#[tauri::command]
pub async fn delete_flow_item(
    factory: State<'_, SessionFactory>,
    item_type: FlowItemType,
    id: i64,
) -> Result<(), WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    db.flows()
        .delete_item(item_type, id)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)
}

/// Replaces a flow item's (Cycle Scope, Cycle Plan) pairs.
#[tauri::command]
pub async fn set_flow_item_cycles(
    factory: State<'_, SessionFactory>,
    flow_id: i64,
    item_type: FlowItemType,
    item_id: i64,
    cycles: Vec<FlowCycleInput>,
) -> Result<(), WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    db.flows()
        .set_cycles(flow_id, item_type, item_id, &cycles)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)
}

/// Lists every flow's cycle pairs.
#[tauri::command]
pub async fn list_all_flow_cycles(
    factory: State<'_, SessionFactory>,
) -> Result<Vec<FlowItemCycle>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.flows()
        .list_all_cycles()
        .await
        .map_err(WireError::from_error)
}

/// Adds an intra-flow dependency (`dependent` waits on `depends_on`).
#[tauri::command]
pub async fn add_flow_dependency(
    factory: State<'_, SessionFactory>,
    flow_id: i64,
    dependent_type: FlowItemType,
    dependent_id: i64,
    depends_on_type: FlowItemType,
    depends_on_id: i64,
) -> Result<(), WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.flows()
        .add_dependency(
            flow_id,
            dependent_type,
            dependent_id,
            depends_on_type,
            depends_on_id,
        )
        .await
        .map_err(WireError::from_error)
}

/// Removes an intra-flow dependency.
#[tauri::command]
pub async fn remove_flow_dependency(
    factory: State<'_, SessionFactory>,
    dependent_type: FlowItemType,
    dependent_id: i64,
    depends_on_type: FlowItemType,
    depends_on_id: i64,
) -> Result<(), WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.flows()
        .remove_dependency(dependent_type, dependent_id, depends_on_type, depends_on_id)
        .await
        .map_err(WireError::from_error)
}

/// Lists every flow's dependencies.
#[tauri::command]
pub async fn list_all_flow_dependencies(
    factory: State<'_, SessionFactory>,
) -> Result<Vec<FlowDependency>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.flows()
        .list_all_dependencies()
        .await
        .map_err(WireError::from_error)
}

/// Lists every instance's divergent status for this flow, with the iteration scope it applies to.
#[tauri::command]
pub async fn list_habit_item_statuses(
    factory: State<'_, SessionFactory>,
    flow_id: i64,
) -> Result<Vec<HabitItemStatus>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.flows()
        .list_item_statuses(FlowId(flow_id))
        .await
        .map_err(WireError::from_error)
}

/// Sets a single instance's status (`null` clears it), recording `resolved_at_ms`. `instance`
/// names it down to its cycle pair — an item with several pairs draws one node per pair in the
/// same iteration — with `cycle_id` `0` for an item that declares none, and for the flow root.
///
/// Marking an occurrence **done** while it still holds unfinished added children is refused with
/// [`NeedsConfirmation`](crate::error::WireErrorKind::NeedsConfirmation) until `confirmed` says
/// the caller has seen them; the refusal names every one. Confirming marks the occurrence done and
/// leaves the children exactly as they are, to archive with it when its window passes. Nothing is
/// stored either way — the guard exists at the moment of completion and nowhere else, because a
/// per-child setting would put a permanent knob on every note to express something that matters
/// once. Added children never gate the **iteration's** resolution: they are not instances, so no
/// future occurrence of the Habit is ever withheld by one.
#[tauri::command]
pub async fn set_habit_item_status(
    factory: State<'_, SessionFactory>,
    flow_id: i64,
    instance: HabitInstanceRef,
    status: Option<String>,
    resolved_at_ms: i64,
    confirmed: Option<bool>,
) -> Result<(), WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    if completing(status.as_deref()) && confirmed != Some(true) {
        let open = flows::unfinished_instance_children(&mut db, FlowId(flow_id), &instance)
            .await
            .map_err(WireError::from_error)?;
        if !open.is_empty() {
            return Err(unfinished_refusal(&open));
        }
    }
    db.flows()
        .set_item_status(
            FlowId(flow_id),
            &instance,
            status.as_deref(),
            resolved_at_ms,
        )
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)
}

/// Whether a status write is the one the completion guard watches for.
///
/// `done` and nothing else. A Commitment Habit's iteration is **kept** or **broken** rather than
/// done, and neither is a completion: a verdict says whether a rule was held to, which is not a
/// claim that the work written under it was finished.
fn completing(status: Option<&str>) -> bool {
    status == Some("done")
}

/// The refusal a completion with unfinished children comes back as.
///
/// The children are named, not counted. A prompt the user can only accept blind is not consent,
/// and the whole point of the guard is being able to see what is about to be closed over.
fn unfinished_refusal(open: &[UnfinishedChild]) -> WireError {
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

/// Creates one node and attaches it to a single virtual Habit occurrence, atomically.
///
/// `child_type` is `task`, `goal`, `commitment` or `info` — anything a Task can parent. The node
/// is real and fully editable, and it belongs to that one occurrence: next week's does not carry
/// it. It may hold children of its own in the ordinary way; only the first level is attached.
#[tauri::command]
pub async fn create_habit_instance_child(
    factory: State<'_, SessionFactory>,
    flow_id: i64,
    instance: HabitInstanceRef,
    child_type: String,
    title: String,
) -> Result<TargetRef, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let child =
        flows::create_instance_child(&mut db, FlowId(flow_id), &instance, &child_type, title)
            .await
            .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(child)
}

/// Every added child of every occurrence of one Habit.
#[tauri::command]
pub async fn list_habit_instance_children(
    factory: State<'_, SessionFactory>,
    flow_id: i64,
) -> Result<Vec<HabitInstanceChild>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.flows()
        .list_instance_children(FlowId(flow_id))
        .await
        .map_err(WireError::from_error)
}

/// Resolves (or un-resolves) a whole Habit iteration: writes or clears a `done` Modification for
/// every instance at `iteration_scope_id` — the flow root and each of its items.
///
/// SPEC: "an iteration is *resolved* when every one of its (non-tombstoned) instances is done".
/// [`set_habit_item_status`] moves one instance; this moves the iteration as a unit, which is why
/// it opens a transaction — the instance list is read first and one row is written per instance,
/// so a half-applied run would leave the iteration neither done nor undone.
#[tauri::command]
pub async fn set_habit_iteration_done(
    factory: State<'_, SessionFactory>,
    flow_id: i64,
    iteration_scope_id: i64,
    done: bool,
    resolved_at_ms: i64,
    confirmed: Option<bool>,
) -> Result<(), WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    if done && confirmed != Some(true) {
        // One prompt for the whole iteration, naming every unfinished child on any of its
        // occurrences: closing an iteration in one gesture is one decision, and asking once per
        // occurrence would turn a single click into a queue of modals.
        let open =
            flows::unfinished_iteration_children(&mut db, FlowId(flow_id), iteration_scope_id)
                .await
                .map_err(WireError::from_error)?;
        if !open.is_empty() {
            return Err(unfinished_refusal(&open));
        }
    }
    flows::set_iteration_done(
        &mut db,
        FlowId(flow_id),
        iteration_scope_id,
        done,
        resolved_at_ms,
    )
    .await
    .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)
}

/// Number of distinct completed iterations of a Habit (divergence detection for reconciliation).
#[tauri::command]
pub async fn habit_completion_count(
    factory: State<'_, SessionFactory>,
    flow_id: i64,
) -> Result<i64, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.flows()
        .habit_completion_count(FlowId(flow_id))
        .await
        .map_err(WireError::from_error)
}

/// Clears every Habit Modification for a flow (delete-and-regenerate reconciliation).
#[tauri::command]
pub async fn clear_habit_modifications(
    factory: State<'_, SessionFactory>,
    flow_id: i64,
) -> Result<(), WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.flows()
        .clear_habit_modifications(FlowId(flow_id))
        .await
        .map_err(WireError::from_error)
}

/// Deep-clones a flow's template into a new flow (the archive-and-new reconciliation arm).
#[tauri::command]
pub async fn fork_flow(
    factory: State<'_, SessionFactory>,
    flow_id: i64,
) -> Result<Flow, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let forked = flows::fork_flow(&mut db, FlowId(flow_id))
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(forked)
}

/// Copies a Flow — template, Recurrence and all — under a new parent (the Mindmap's Copy+Paste).
///
/// Transactional and committed here: a copy is dozens of inserts whose parent, cycle and
/// dependency remaps only make sense together.
#[tauri::command]
pub async fn duplicate_flow(
    factory: State<'_, SessionFactory>,
    flow_id: i64,
    parent_type: String,
    parent_id: i64,
    position: i64,
) -> Result<Flow, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let copy = flows::duplicate_flow(&mut db, FlowId(flow_id), &parent_type, parent_id, position)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(copy)
}

/// Copies a flow item (and its nested items) within its own template. Returns the new item's id.
///
/// Transactional and committed here: the copy is one insert per nested item plus its cycle pairs
/// and dependency edges, and the remap names ids written earlier in the same run.
#[tauri::command]
pub async fn duplicate_flow_item(
    factory: State<'_, SessionFactory>,
    item_type: FlowItemType,
    item_id: i64,
    parent_type: String,
    parent_id: i64,
    position: i64,
) -> Result<i64, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let new_id = flows::duplicate_flow_item(
        &mut db,
        item_type,
        item_id,
        &parent_type,
        parent_id,
        position,
    )
    .await
    .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(new_id)
}

/// Converts a real Task/Goal subtree into a Flow template of the same Instance Type.
#[tauri::command]
pub async fn convert_to_flow(
    factory: State<'_, SessionFactory>,
    node_type: String,
    node_id: i64,
    keep_dependencies: bool,
    map_scopes: bool,
) -> Result<Flow, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let flow = flows::convert_to_flow(&mut db, &node_type, node_id, keep_dependencies, map_scopes)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(flow)
}
