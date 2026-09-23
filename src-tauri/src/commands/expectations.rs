//! Tauri commands for expectation operations.
//!
//! Thin, like every other command module: open a session, delegate, commit. Releasing and taking
//! a release back are ordinary [`update_expectation`] writes of the status; the one write with a
//! command of its own is completing the virtual check task, which records the check and refuses
//! when there is none due.

use tauri::State;

use crate::{
    database::session::SessionFactory,
    error::WireError,
    tasks::model::{
        CreateExpectationRequest, Expectation, ExpectationId, SpawnedWait, TaskId,
        UpdateExpectationRequest, UpdateSpawnedWaitRequest,
    },
};

/// Creates a new expectation: pending, live, with the Check every the request names, if any.
#[tauri::command]
pub async fn create_expectation(
    factory: State<'_, SessionFactory>,
    request: CreateExpectationRequest,
) -> Result<Expectation, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let expectation = crate::nodes::write::create_expectation(
        &mut db,
        request,
        chrono::Local::now().naive_local(),
    )
    .await
    .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(expectation)
}

/// Lists all expectations.
#[tauri::command]
pub async fn list_expectations(
    factory: State<'_, SessionFactory>,
) -> Result<Vec<Expectation>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.expectations()
        .list()
        .await
        .map_err(WireError::from_error)
}

/// Updates an expectation — including releasing it, or taking a release back.
#[tauri::command]
pub async fn update_expectation(
    factory: State<'_, SessionFactory>,
    id: i64,
    request: UpdateExpectationRequest,
) -> Result<Expectation, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let expectation = crate::nodes::write::update_expectation(
        &mut db,
        id,
        request,
        chrono::Local::now().naive_local(),
    )
    .await
    .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(expectation)
}

/// Completes the current check on a stored expectation: records now as its last check, so the
/// next falls due one interval later. The wait stays pending.
#[tauri::command]
pub async fn complete_expectation_check(
    factory: State<'_, SessionFactory>,
    id: i64,
) -> Result<Expectation, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let expectation = crate::tasks::complete_expectation_check(
        &mut db,
        ExpectationId(id),
        crate::tasks::expectations::now(),
    )
    .await
    .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(expectation)
}

/// Releases, un-releases or archives the wait a task's completion spawned.
#[tauri::command]
pub async fn update_spawned_wait(
    factory: State<'_, SessionFactory>,
    task_id: i64,
    request: UpdateSpawnedWaitRequest,
) -> Result<SpawnedWait, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let wait = crate::tasks::waits::update_spawned_wait(&mut db, TaskId(task_id), request)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(wait)
}

/// Completes the current check on a task's spawned wait.
#[tauri::command]
pub async fn complete_spawned_wait_check(
    factory: State<'_, SessionFactory>,
    task_id: i64,
) -> Result<(), WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    crate::tasks::waits::complete_spawned_check(
        &mut db,
        TaskId(task_id),
        crate::tasks::expectations::now(),
    )
    .await
    .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)
}

/// Adds a tag to an expectation.
#[tauri::command]
pub async fn add_tag_to_expectation(
    factory: State<'_, SessionFactory>,
    expectation_id: crate::nodes::id::NodeId,
    tag_id: i64,
) -> Result<(), WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    crate::nodes::write::set_tag(
        &mut db,
        "expectation",
        &expectation_id,
        tag_id,
        true,
        chrono::Local::now().naive_local(),
    )
    .await
    .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)
}

/// Removes a tag from an expectation.
#[tauri::command]
pub async fn remove_tag_from_expectation(
    factory: State<'_, SessionFactory>,
    expectation_id: crate::nodes::id::NodeId,
    tag_id: i64,
) -> Result<(), WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    crate::nodes::write::set_tag(
        &mut db,
        "expectation",
        &expectation_id,
        tag_id,
        false,
        chrono::Local::now().naive_local(),
    )
    .await
    .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)
}

/// Deletes an expectation, its notes, and every dependency edge aimed at it.
#[tauri::command]
pub async fn delete_expectation(
    factory: State<'_, SessionFactory>,
    id: i64,
) -> Result<(), WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    crate::tasks::delete_expectation(&mut db, ExpectationId(id))
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)
}

/// Takes the latest completed check on a stored wait back. `due_at` names the check, as the
/// frontend drew it (`YYYY-MM-DDTHH:MM:SS`).
#[tauri::command]
pub async fn reopen_expectation_check(
    factory: State<'_, SessionFactory>,
    id: i64,
    due_at: chrono::NaiveDateTime,
) -> Result<Expectation, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let expectation = crate::tasks::reopen_expectation_check(&mut db, ExpectationId(id), due_at)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(expectation)
}

/// Takes the latest completed check on a task's spawned wait back.
#[tauri::command]
pub async fn reopen_spawned_wait_check(
    factory: State<'_, SessionFactory>,
    task_id: i64,
    due_at: chrono::NaiveDateTime,
) -> Result<(), WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    crate::tasks::waits::reopen_spawned_check(&mut db, TaskId(task_id), due_at)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)
}
