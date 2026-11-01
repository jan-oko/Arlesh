//! Tauri commands for knowledge-base entity operations.

use tauri::State;

use crate::backend::AppBackend;
use crate::{
    error::WireError,
    knowledge_base::model::{
        CreateEventRequest, CreatePersonRequest, CreateThreadRequest, Event, Person, Thread,
        UpdatePersonRequest,
    },
};

/// Creates a new person.
///
/// A single `INSERT`, so it runs on a pooled session — SQLite gives the one write
/// statement-level atomicity on its own.
#[tauri::command]
pub async fn create_person(
    backend: State<'_, AppBackend>,
    request: CreatePersonRequest,
) -> Result<Person, WireError> {
    backend.create_person(request).await
}

/// Fetches a person by id.
#[tauri::command]
pub async fn get_person(backend: State<'_, AppBackend>, id: i64) -> Result<Person, WireError> {
    backend.get_person(id).await
}

/// Lists all people.
#[tauri::command]
pub async fn list_people(backend: State<'_, AppBackend>) -> Result<Vec<Person>, WireError> {
    backend.list_people().await
}

/// Updates a person.
///
/// A single `UPDATE` (once the read work is done), so it runs on a pooled session.
#[tauri::command]
pub async fn update_person(
    backend: State<'_, AppBackend>,
    id: i64,
    request: UpdatePersonRequest,
) -> Result<Person, WireError> {
    backend.update_person(id, request).await
}

/// Deletes a person by id.
///
/// A single `DELETE` (once the read work is done), so it runs on a pooled session.
#[tauri::command]
pub async fn delete_person(backend: State<'_, AppBackend>, id: i64) -> Result<(), WireError> {
    backend.delete_person(id).await
}

/// Creates a new event.
///
/// A single `INSERT`, so it runs on a pooled session.
#[tauri::command]
pub async fn create_event(
    backend: State<'_, AppBackend>,
    request: CreateEventRequest,
) -> Result<Event, WireError> {
    backend.create_event(request).await
}

/// Lists all events.
#[tauri::command]
pub async fn list_events(backend: State<'_, AppBackend>) -> Result<Vec<Event>, WireError> {
    backend.list_events().await
}

/// Creates a new thread.
///
/// A single `INSERT`, so it runs on a pooled session.
#[tauri::command]
pub async fn create_thread(
    backend: State<'_, AppBackend>,
    request: CreateThreadRequest,
) -> Result<Thread, WireError> {
    backend.create_thread(request).await
}

/// Lists all threads.
#[tauri::command]
pub async fn list_threads(backend: State<'_, AppBackend>) -> Result<Vec<Thread>, WireError> {
    backend.list_threads().await
}
