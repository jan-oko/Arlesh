//! Tauri commands for knowledge-base entity operations.

use tauri::State;

use crate::{
    database::session::SessionFactory,
    error::WireError,
    knowledge_base::model::{
        CreateEventRequest, CreatePersonRequest, CreateThreadRequest, Event, Person, PersonId,
        Thread, UpdatePersonRequest,
    },
};

/// Creates a new person.
///
/// A single `INSERT`, so it runs on a pooled session — SQLite gives the one write
/// statement-level atomicity on its own.
#[tauri::command]
pub async fn create_person(
    factory: State<'_, SessionFactory>,
    request: CreatePersonRequest,
) -> Result<Person, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.people()
        .create(request)
        .await
        .map_err(WireError::from_error)
}

/// Fetches a person by id.
#[tauri::command]
pub async fn get_person(factory: State<'_, SessionFactory>, id: i64) -> Result<Person, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.people()
        .get(PersonId(id))
        .await
        .map_err(WireError::from_error)
}

/// Lists all people.
#[tauri::command]
pub async fn list_people(factory: State<'_, SessionFactory>) -> Result<Vec<Person>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.people().list().await.map_err(WireError::from_error)
}

/// Updates a person.
///
/// A single `UPDATE` (once the read work is done), so it runs on a pooled session.
#[tauri::command]
pub async fn update_person(
    factory: State<'_, SessionFactory>,
    id: i64,
    request: UpdatePersonRequest,
) -> Result<Person, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.people()
        .update(PersonId(id), request)
        .await
        .map_err(WireError::from_error)
}

/// Deletes a person by id.
///
/// A single `DELETE` (once the read work is done), so it runs on a pooled session.
#[tauri::command]
pub async fn delete_person(factory: State<'_, SessionFactory>, id: i64) -> Result<(), WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.people()
        .delete(PersonId(id))
        .await
        .map_err(WireError::from_error)
}

/// Creates a new event.
///
/// An Exact scope is registered first, then the event written, in one transaction.
#[tauri::command]
pub async fn create_event(
    factory: State<'_, SessionFactory>,
    request: CreateEventRequest,
) -> Result<Event, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    db.scopes()
        .register_all(request.scope_id)
        .await
        .map_err(WireError::from_error)?;
    let event = db
        .events()
        .create(request)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(event)
}

/// Lists all events.
#[tauri::command]
pub async fn list_events(factory: State<'_, SessionFactory>) -> Result<Vec<Event>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.events().list().await.map_err(WireError::from_error)
}

/// Creates a new thread.
///
/// A single `INSERT`, so it runs on a pooled session.
#[tauri::command]
pub async fn create_thread(
    factory: State<'_, SessionFactory>,
    request: CreateThreadRequest,
) -> Result<Thread, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.threads()
        .create(request)
        .await
        .map_err(WireError::from_error)
}

/// Lists all threads.
#[tauri::command]
pub async fn list_threads(factory: State<'_, SessionFactory>) -> Result<Vec<Thread>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.threads().list().await.map_err(WireError::from_error)
}
