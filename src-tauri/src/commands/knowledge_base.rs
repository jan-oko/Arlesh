//! Tauri commands for knowledge-base entity operations.

use tauri::State;

use crate::{
    database::DatabasePool,
    error::WireError,
    knowledge_base::{
        model::{
            CreateEventRequest, CreatePersonRequest, CreateThreadRequest, Event, Person, PersonId,
            Thread, UpdatePersonRequest,
        },
        EventRepository, PersonRepository, ThreadRepository,
    },
};

/// Creates a new person.
#[tauri::command]
pub async fn create_person(
    pool: State<'_, DatabasePool>,
    request: CreatePersonRequest,
) -> Result<Person, WireError> {
    PersonRepository::new(&pool)
        .create(request)
        .await
        .map_err(WireError::from_error)
}

/// Fetches a person by id.
#[tauri::command]
pub async fn get_person(pool: State<'_, DatabasePool>, id: i64) -> Result<Person, WireError> {
    PersonRepository::new(&pool)
        .get(PersonId(id))
        .await
        .map_err(WireError::from_error)
}

/// Lists all people.
#[tauri::command]
pub async fn list_people(pool: State<'_, DatabasePool>) -> Result<Vec<Person>, WireError> {
    PersonRepository::new(&pool)
        .list()
        .await
        .map_err(WireError::from_error)
}

/// Updates a person.
#[tauri::command]
pub async fn update_person(
    pool: State<'_, DatabasePool>,
    id: i64,
    request: UpdatePersonRequest,
) -> Result<Person, WireError> {
    PersonRepository::new(&pool)
        .update(PersonId(id), request)
        .await
        .map_err(WireError::from_error)
}

/// Deletes a person by id.
#[tauri::command]
pub async fn delete_person(pool: State<'_, DatabasePool>, id: i64) -> Result<(), WireError> {
    PersonRepository::new(&pool)
        .delete(PersonId(id))
        .await
        .map_err(WireError::from_error)
}

/// Creates a new event.
#[tauri::command]
pub async fn create_event(
    pool: State<'_, DatabasePool>,
    request: CreateEventRequest,
) -> Result<Event, WireError> {
    EventRepository::new(&pool)
        .create(request)
        .await
        .map_err(WireError::from_error)
}

/// Lists all events.
#[tauri::command]
pub async fn list_events(pool: State<'_, DatabasePool>) -> Result<Vec<Event>, WireError> {
    EventRepository::new(&pool)
        .list()
        .await
        .map_err(WireError::from_error)
}

/// Creates a new thread.
#[tauri::command]
pub async fn create_thread(
    pool: State<'_, DatabasePool>,
    request: CreateThreadRequest,
) -> Result<Thread, WireError> {
    ThreadRepository::new(&pool)
        .create(request)
        .await
        .map_err(WireError::from_error)
}

/// Lists all threads.
#[tauri::command]
pub async fn list_threads(pool: State<'_, DatabasePool>) -> Result<Vec<Thread>, WireError> {
    ThreadRepository::new(&pool)
        .list()
        .await
        .map_err(WireError::from_error)
}
