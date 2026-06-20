//! Tauri commands for knowledge-base entity operations.

use tauri::State;

use crate::{
    db::DbPool,
    kb::{
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
    pool: State<'_, DbPool>,
    req: CreatePersonRequest,
) -> Result<Person, String> {
    PersonRepository::new(&pool)
        .create(req)
        .await
        .map_err(|e| e.to_string())
}

/// Fetches a person by id.
#[tauri::command]
pub async fn get_person(pool: State<'_, DbPool>, id: i64) -> Result<Person, String> {
    PersonRepository::new(&pool)
        .get(PersonId(id))
        .await
        .map_err(|e| e.to_string())
}

/// Lists all people.
#[tauri::command]
pub async fn list_people(pool: State<'_, DbPool>) -> Result<Vec<Person>, String> {
    PersonRepository::new(&pool)
        .list()
        .await
        .map_err(|e| e.to_string())
}

/// Updates a person.
#[tauri::command]
pub async fn update_person(
    pool: State<'_, DbPool>,
    id: i64,
    req: UpdatePersonRequest,
) -> Result<Person, String> {
    PersonRepository::new(&pool)
        .update(PersonId(id), req)
        .await
        .map_err(|e| e.to_string())
}

/// Deletes a person by id.
#[tauri::command]
pub async fn delete_person(pool: State<'_, DbPool>, id: i64) -> Result<(), String> {
    PersonRepository::new(&pool)
        .delete(PersonId(id))
        .await
        .map_err(|e| e.to_string())
}

/// Creates a new event.
#[tauri::command]
pub async fn create_event(
    pool: State<'_, DbPool>,
    req: CreateEventRequest,
) -> Result<Event, String> {
    EventRepository::new(&pool)
        .create(req)
        .await
        .map_err(|e| e.to_string())
}

/// Lists all events.
#[tauri::command]
pub async fn list_events(pool: State<'_, DbPool>) -> Result<Vec<Event>, String> {
    EventRepository::new(&pool)
        .list()
        .await
        .map_err(|e| e.to_string())
}

/// Creates a new thread.
#[tauri::command]
pub async fn create_thread(
    pool: State<'_, DbPool>,
    req: CreateThreadRequest,
) -> Result<Thread, String> {
    ThreadRepository::new(&pool)
        .create(req)
        .await
        .map_err(|e| e.to_string())
}

/// Lists all threads.
#[tauri::command]
pub async fn list_threads(pool: State<'_, DbPool>) -> Result<Vec<Thread>, String> {
    ThreadRepository::new(&pool)
        .list()
        .await
        .map_err(|e| e.to_string())
}
