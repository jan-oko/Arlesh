//! Tauri commands for expectation operations.
//!
//! Thin, like every other command module: open a session, delegate, commit. Releasing and taking
//! a release back are ordinary [`update_expectation`] writes of the status; the one write with a
//! command of its own is completing the virtual check task, which clears the check-by and refuses
//! when there is none.

use tauri::State;

use crate::{
    database::session::SessionFactory,
    error::WireError,
    tasks::model::{
        CreateExpectationRequest, Expectation, ExpectationId, UpdateExpectationRequest,
    },
};

/// Creates a new expectation: pending, live, with the check-by the request names, if any.
#[tauri::command]
pub async fn create_expectation(
    factory: State<'_, SessionFactory>,
    request: CreateExpectationRequest,
) -> Result<Expectation, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let expectation = crate::tasks::create_expectation(&mut db, request)
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
    let expectation = crate::tasks::update_expectation(&mut db, ExpectationId(id), request)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(expectation)
}

/// Completes an expectation's virtual check task: clears its check-by, leaving it pending.
#[tauri::command]
pub async fn clear_expectation_check_by(
    factory: State<'_, SessionFactory>,
    id: i64,
) -> Result<Expectation, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let expectation = crate::tasks::clear_check_by(&mut db, ExpectationId(id))
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(expectation)
}

/// Adds a tag to an expectation.
#[tauri::command]
pub async fn add_tag_to_expectation(
    factory: State<'_, SessionFactory>,
    expectation_id: i64,
    tag_id: i64,
) -> Result<(), WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.expectations()
        .add_tag(ExpectationId(expectation_id), tag_id)
        .await
        .map_err(WireError::from_error)
}

/// Removes a tag from an expectation.
#[tauri::command]
pub async fn remove_tag_from_expectation(
    factory: State<'_, SessionFactory>,
    expectation_id: i64,
    tag_id: i64,
) -> Result<(), WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.expectations()
        .remove_tag(ExpectationId(expectation_id), tag_id)
        .await
        .map_err(WireError::from_error)
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
