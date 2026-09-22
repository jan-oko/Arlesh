//! Tauri commands for task and goal operations.

use tauri::State;

use crate::{
    database::session::SessionFactory,
    duplicate::{duplicate_subtree, DuplicableKind},
    error::WireError,
    tasks::{
        lifecycle::ItemLifecycle,
        model::{
            CreateGoalRequest, CreateTaskRequest, Dependency, Goal, GoalId, Task,
            TaskDependencyEdge, TaskId, TaskWithBlockers, TimeScope, UpdateGoalRequest,
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
    let task = crate::tasks::create_task(&mut db, request)
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

/// Lists all tasks.
#[tauri::command]
pub async fn list_tasks(factory: State<'_, SessionFactory>) -> Result<Vec<Task>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.tasks().list().await.map_err(WireError::from_error)
}

/// Updates a task.
#[tauri::command]
pub async fn update_task(
    factory: State<'_, SessionFactory>,
    id: i64,
    request: UpdateTaskRequest,
) -> Result<Task, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let task = crate::tasks::update_task(&mut db, TaskId(id), request)
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

/// Deletes a task.
#[tauri::command]
pub async fn delete_task(factory: State<'_, SessionFactory>, id: i64) -> Result<(), WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    crate::tasks::delete_task(&mut db, TaskId(id))
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
    task_id: i64,
    dependency: Dependency,
) -> Result<(), WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    crate::tasks::add_task_dependency(&mut db, TaskId(task_id), dependency)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)
}

/// Removes a dependency from a task.
#[tauri::command]
pub async fn remove_task_dependency(
    factory: State<'_, SessionFactory>,
    task_id: i64,
    dependency: Dependency,
) -> Result<(), WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.tasks()
        .remove_dependency(TaskId(task_id), dependency)
        .await
        .map_err(WireError::from_error)
}

/// Lists all dependencies for a task.
#[tauri::command]
pub async fn list_task_dependencies(
    factory: State<'_, SessionFactory>,
    task_id: i64,
) -> Result<Vec<Dependency>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.tasks()
        .list_dependencies(TaskId(task_id))
        .await
        .map_err(WireError::from_error)
}

/// Lists every task-dependency edge (for the mindmap bulk load).
#[tauri::command]
pub async fn list_all_task_dependencies(
    factory: State<'_, SessionFactory>,
) -> Result<Vec<TaskDependencyEdge>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.tasks()
        .list_all_dependencies()
        .await
        .map_err(WireError::from_error)
}

/// Creates a new goal.
#[tauri::command]
pub async fn create_goal(
    factory: State<'_, SessionFactory>,
    request: CreateGoalRequest,
) -> Result<Goal, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let goal = crate::tasks::create_goal(&mut db, request)
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

/// Lists all goals.
#[tauri::command]
pub async fn list_goals(factory: State<'_, SessionFactory>) -> Result<Vec<Goal>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.goals().list().await.map_err(WireError::from_error)
}

/// Updates a goal.
#[tauri::command]
pub async fn update_goal(
    factory: State<'_, SessionFactory>,
    id: i64,
    request: UpdateGoalRequest,
) -> Result<Goal, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let goal = crate::tasks::update_goal(&mut db, GoalId(id), request)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(goal)
}

/// Deletes a goal.
#[tauri::command]
pub async fn delete_goal(factory: State<'_, SessionFactory>, id: i64) -> Result<(), WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    crate::tasks::delete_goal(&mut db, GoalId(id))
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
    task_id: i64,
    tag_id: i64,
) -> Result<(), WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.tasks()
        .add_tag(TaskId(task_id), tag_id)
        .await
        .map_err(WireError::from_error)
}

/// Removes a tag from a task.
#[tauri::command]
pub async fn remove_tag_from_task(
    factory: State<'_, SessionFactory>,
    task_id: i64,
    tag_id: i64,
) -> Result<(), WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.tasks()
        .remove_tag(TaskId(task_id), tag_id)
        .await
        .map_err(WireError::from_error)
}

/// Adds a tag to a goal.
#[tauri::command]
pub async fn add_tag_to_goal(
    factory: State<'_, SessionFactory>,
    goal_id: i64,
    tag_id: i64,
) -> Result<(), WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.goals()
        .add_tag(GoalId(goal_id), tag_id)
        .await
        .map_err(WireError::from_error)
}

/// Removes a tag from a goal.
#[tauri::command]
pub async fn remove_tag_from_goal(
    factory: State<'_, SessionFactory>,
    goal_id: i64,
    tag_id: i64,
) -> Result<(), WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.goals()
        .remove_tag(GoalId(goal_id), tag_id)
        .await
        .map_err(WireError::from_error)
}

/// Derives the scope lifecycle (Active / Overdue / Lapsed) of every Task and Goal at `now`
/// (local wall-clock). Nothing is persisted — the result is a pure function of scope, status,
/// and the reference instant.
#[tauri::command]
pub async fn derive_scope_lifecycles(
    factory: State<'_, SessionFactory>,
    now: chrono::NaiveDateTime,
) -> Result<Vec<ItemLifecycle>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    crate::tasks::derive_all_scope_lifecycles(&mut db, now)
        .await
        .map_err(WireError::from_error)
}
