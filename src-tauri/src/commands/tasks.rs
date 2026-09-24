//! Tauri commands for task and goal operations.

use tauri::State;

use crate::{
    database::session::SessionFactory,
    duplicate::{duplicate_subtree, DuplicableKind},
    error::WireError,
    nodes::{id::NodeId, write},
    tasks::{
        lifecycle::ItemLifecycle,
        model::{
            CreateGoalRequest, CreateTaskRequest, Dependency, Goal, GoalId, GoalStatus, Task,
            TaskDependencyEdge, TaskId, TaskStatus, TaskWithBlockers, TimeScope, UpdateGoalRequest,
            UpdateTaskRequest,
        },
        ReparentConflicts, ViolatingDescendant,
    },
};

/// Creates a new task.
#[tauri::command]
pub async fn create_task(
    factory: State<'_, SessionFactory>,
    request: CreateTaskRequest,
) -> Result<Task, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let task = write::create_task(&mut db, request, chrono::Local::now().naive_local())
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(task)
}

/// Fetches a task by id with computed blockers.
#[tauri::command]
pub async fn get_task(
    factory: State<'_, SessionFactory>,
    id: i64,
) -> Result<TaskWithBlockers, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    crate::tasks::get_task_with_blockers(&mut db, TaskId(id))
        .await
        .map_err(WireError::from_error)
}

/// Lists every task — the Task virtual table: stored rows and every Habit occurrence.
#[tauri::command]
pub async fn list_tasks(
    factory: State<'_, SessionFactory>,
    now: chrono::NaiveDateTime,
) -> Result<Vec<Task>, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let load = crate::mindmap::load(&mut db, now)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(load.tasks)
}

/// Updates a task, stored or derived: a Habit occurrence's update lands in its overlay.
///
/// Marking a Habit occurrence **done** while it still holds unfinished added children is refused
/// with [`NeedsConfirmation`](crate::error::WireErrorKind::NeedsConfirmation) until `confirmed`
/// says the caller has seen them; the refusal names every one. Confirming completes it and leaves
/// the children exactly as they are, to archive with it when its window passes.
#[tauri::command]
pub async fn update_task(
    factory: State<'_, SessionFactory>,
    id: NodeId,
    request: UpdateTaskRequest,
    confirmed: Option<bool>,
) -> Result<Task, WireError> {
    let now = chrono::Local::now().naive_local();
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    if matches!(request.status, Some(TaskStatus::Done)) && confirmed != Some(true) {
        let open = write::unfinished_children(&mut db, &id, now)
            .await
            .map_err(WireError::from_error)?;
        if !open.is_empty() {
            return Err(crate::commands::flows::unfinished_refusal(&open));
        }
    }
    let task = write::update_task(&mut db, &id, request, now)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(task)
}

/// Returns the task/goal descendants of a node that a candidate Time Scope would orphan, for the
/// frontend's clamp-or-cancel prompt before narrowing a scope or reparenting.
#[tauri::command]
pub async fn scope_containment_conflicts(
    factory: State<'_, SessionFactory>,
    node_type: String,
    node_id: i64,
    time_scope: TimeScope,
) -> Result<Vec<ViolatingDescendant>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    crate::tasks::conflicts_for_new_time_scope(&mut db, &node_type, node_id, &time_scope)
        .await
        .map_err(WireError::from_error)
}

/// Returns the items a reparent of `node` under `new_parent` would orphan, plus the ancestor Time
/// Scope to clamp them to — for a clamp-or-cancel prompt before the move.
#[tauri::command]
pub async fn reparent_scope_conflicts(
    factory: State<'_, SessionFactory>,
    node_type: String,
    node_id: i64,
    new_parent_type: String,
    new_parent_id: i64,
) -> Result<ReparentConflicts, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    crate::tasks::reparent_conflicts(
        &mut db,
        &node_type,
        node_id,
        &new_parent_type,
        new_parent_id,
    )
    .await
    .map_err(WireError::from_error)
}

/// Deletes a task — or archives a Habit occurrence, which is never deleted.
#[tauri::command]
pub async fn delete_task(factory: State<'_, SessionFactory>, id: NodeId) -> Result<(), WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    write::delete(&mut db, "task", &id, chrono::Local::now().naive_local())
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)
}

/// Deep-clones a task and its whole subtree under `(target_type, target_id)`, putting the new
/// root at `position`. Backs the Mindmap's Copy+Paste.
///
/// Transactional: the subtree lands whole or not at all.
#[tauri::command]
pub async fn duplicate_task(
    factory: State<'_, SessionFactory>,
    id: i64,
    target_type: String,
    target_id: i64,
    position: i64,
) -> Result<Task, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let new_id = duplicate_subtree(
        &mut db,
        DuplicableKind::Task,
        id,
        &target_type,
        target_id,
        position,
    )
    .await
    .map_err(WireError::from_error)?;
    let task = db
        .tasks()
        .get(TaskId(new_id))
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(task)
}

/// Adds a dependency to a task.
///
/// Transactional despite writing only once: the cycle check in front of the `INSERT` is a read the
/// write depends on, and without a transaction two concurrent calls can each see no cycle and
/// jointly create one. The transaction closes that window — SQLite refuses the second writer
/// rather than letting both land.
#[tauri::command]
pub async fn add_task_dependency(
    factory: State<'_, SessionFactory>,
    task_id: NodeId,
    dependency: Dependency,
) -> Result<(), WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    write::add_dependency(
        &mut db,
        &task_id,
        dependency,
        chrono::Local::now().naive_local(),
    )
    .await
    .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)
}

/// Removes a dependency from a task.
#[tauri::command]
pub async fn remove_task_dependency(
    factory: State<'_, SessionFactory>,
    task_id: NodeId,
    dependency: Dependency,
) -> Result<(), WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    write::remove_dependency(
        &mut db,
        &task_id,
        dependency,
        chrono::Local::now().naive_local(),
    )
    .await
    .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)
}

/// Lists what one task depends on — a stored one, or a Habit occurrence, whose edges are its
/// template's with its own differences applied.
#[tauri::command]
pub async fn list_task_dependencies(
    factory: State<'_, SessionFactory>,
    task_id: NodeId,
) -> Result<Vec<Dependency>, WireError> {
    // A transaction only because the derivation reads through one; it writes nothing.
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let dependencies =
        write::dependencies_of(&mut db, &task_id, chrono::Local::now().naive_local())
            .await
            .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(dependencies)
}

/// Lists every task-dependency edge on the board, stored and derived.
#[tauri::command]
pub async fn list_all_task_dependencies(
    factory: State<'_, SessionFactory>,
) -> Result<Vec<TaskDependencyEdge>, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let edges = write::all_dependencies(&mut db, chrono::Local::now().naive_local())
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(edges)
}

/// Creates a new goal.
#[tauri::command]
pub async fn create_goal(
    factory: State<'_, SessionFactory>,
    request: CreateGoalRequest,
) -> Result<Goal, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let goal = write::create_goal(&mut db, request, chrono::Local::now().naive_local())
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(goal)
}

/// Fetches a goal by id.
#[tauri::command]
pub async fn get_goal(factory: State<'_, SessionFactory>, id: i64) -> Result<Goal, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.goals()
        .get(GoalId(id))
        .await
        .map_err(WireError::from_error)
}

/// Lists every goal — the Goal virtual table: stored rows and every Habit occurrence.
#[tauri::command]
pub async fn list_goals(
    factory: State<'_, SessionFactory>,
    now: chrono::NaiveDateTime,
) -> Result<Vec<Goal>, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let load = crate::mindmap::load(&mut db, now)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(load.goals)
}

/// Updates a goal, stored or derived. Achieving a Habit occurrence that still holds unfinished
/// added children is refused pending confirmation, exactly as completing a Task one is.
#[tauri::command]
pub async fn update_goal(
    factory: State<'_, SessionFactory>,
    id: NodeId,
    request: UpdateGoalRequest,
    confirmed: Option<bool>,
) -> Result<Goal, WireError> {
    let now = chrono::Local::now().naive_local();
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    if matches!(request.status, Some(GoalStatus::Achieved)) && confirmed != Some(true) {
        let open = write::unfinished_children(&mut db, &id, now)
            .await
            .map_err(WireError::from_error)?;
        if !open.is_empty() {
            return Err(crate::commands::flows::unfinished_refusal(&open));
        }
    }
    let goal = write::update_goal(&mut db, &id, request, now)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(goal)
}

/// Deletes a goal — or archives a Habit occurrence, which is never deleted.
#[tauri::command]
pub async fn delete_goal(factory: State<'_, SessionFactory>, id: NodeId) -> Result<(), WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    write::delete(&mut db, "goal", &id, chrono::Local::now().naive_local())
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)
}

/// Deep-clones a goal and its whole subtree under `(target_type, target_id)`, putting the new
/// root at `position`. Backs the Mindmap's Copy+Paste.
///
/// Transactional: the subtree lands whole or not at all.
#[tauri::command]
pub async fn duplicate_goal(
    factory: State<'_, SessionFactory>,
    id: i64,
    target_type: String,
    target_id: i64,
    position: i64,
) -> Result<Goal, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let new_id = duplicate_subtree(
        &mut db,
        DuplicableKind::Goal,
        id,
        &target_type,
        target_id,
        position,
    )
    .await
    .map_err(WireError::from_error)?;
    let goal = db
        .goals()
        .get(GoalId(new_id))
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(goal)
}

/// Adds a tag to a task.
#[tauri::command]
pub async fn add_tag_to_task(
    factory: State<'_, SessionFactory>,
    task_id: NodeId,
    tag_id: i64,
) -> Result<(), WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    write::set_tag(
        &mut db,
        "task",
        &task_id,
        tag_id,
        true,
        chrono::Local::now().naive_local(),
    )
    .await
    .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)
}

/// Removes a tag from a task.
#[tauri::command]
pub async fn remove_tag_from_task(
    factory: State<'_, SessionFactory>,
    task_id: NodeId,
    tag_id: i64,
) -> Result<(), WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    write::set_tag(
        &mut db,
        "task",
        &task_id,
        tag_id,
        false,
        chrono::Local::now().naive_local(),
    )
    .await
    .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)
}

/// Adds a tag to a goal.
#[tauri::command]
pub async fn add_tag_to_goal(
    factory: State<'_, SessionFactory>,
    goal_id: NodeId,
    tag_id: i64,
) -> Result<(), WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    write::set_tag(
        &mut db,
        "goal",
        &goal_id,
        tag_id,
        true,
        chrono::Local::now().naive_local(),
    )
    .await
    .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)
}

/// Removes a tag from a goal.
#[tauri::command]
pub async fn remove_tag_from_goal(
    factory: State<'_, SessionFactory>,
    goal_id: NodeId,
    tag_id: i64,
) -> Result<(), WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    write::set_tag(
        &mut db,
        "goal",
        &goal_id,
        tag_id,
        false,
        chrono::Local::now().naive_local(),
    )
    .await
    .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)
}

/// Derives the scope lifecycle (Active / Overdue / Lapsed) of every Task and Goal at `now`
/// (local wall-clock). Nothing is persisted — the result is a pure function of scope, status,
/// and the reference instant.
#[tauri::command]
pub async fn derive_scope_lifecycles(
    factory: State<'_, SessionFactory>,
    now: chrono::NaiveDateTime,
) -> Result<Vec<ItemLifecycle>, WireError> {
    // Every row of the virtual tables, a Habit's occurrences included. A transaction only because
    // the derivation reads through one; it writes nothing.
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let lifecycles = crate::mindmap::load(&mut db, now)
        .await
        .map_err(WireError::from_error)?
        .lifecycles;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(lifecycles)
}
