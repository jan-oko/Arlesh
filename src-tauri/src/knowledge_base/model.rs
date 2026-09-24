//! Knowledge-base entity models: People, Events, Threads.

use serde::{Deserialize, Serialize};

use crate::scopes::key::ScopeKey;

/// Identifies a person row by its primary key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PersonId(pub i64);

impl From<i64> for PersonId {
    fn from(value: i64) -> Self {
        Self(value)
    }
}
impl From<PersonId> for i64 {
    fn from(id: PersonId) -> Self {
        id.0
    }
}

/// A person row as returned from the database.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Person {
    /// Primary key.
    pub id: i64,
    /// Display name (equals note title).
    pub name: String,
    /// JSON array of alias strings.
    pub aliases: String,
    /// Path to the linked Obsidian note (if any).
    pub linked_note: Option<String>,
}

/// Request body for creating a person.
#[derive(Debug, Deserialize)]
pub struct CreatePersonRequest {
    /// Display name.
    pub name: String,
    /// Aliases (serialized as JSON array).
    pub aliases: Option<Vec<String>>,
    /// Path to the linked Obsidian note.
    pub linked_note: Option<String>,
}

/// Request body for updating a person.
#[derive(Debug, Deserialize)]
pub struct UpdatePersonRequest {
    /// New name (if provided).
    pub name: Option<String>,
    /// New aliases (if provided).
    pub aliases: Option<Vec<String>>,
    /// New linked note path (if provided).
    pub linked_note: Option<String>,
}

/// An event row as returned from the database.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Event {
    /// Primary key.
    pub id: i64,
    /// Display title.
    pub title: String,
    /// Scope the event falls within (if any).
    pub scope_id: Option<ScopeKey>,
    /// ISO 8601 datetime of the event (if any).
    pub event_time: Option<String>,
    /// Path to the linked Obsidian note (if any).
    pub linked_note: Option<String>,
}

/// Request body for creating an event.
#[derive(Debug, Deserialize)]
pub struct CreateEventRequest {
    /// Display title.
    pub title: String,
    /// Scope id (if any).
    pub scope_id: Option<ScopeKey>,
    /// ISO 8601 datetime (if any).
    pub event_time: Option<String>,
    /// Linked note path (if any).
    pub linked_note: Option<String>,
}

/// A thread row as returned from the database.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Thread {
    /// Primary key.
    pub id: i64,
    /// Display title.
    pub title: String,
    /// Path to the linked Obsidian note (if any).
    pub linked_note: Option<String>,
}

/// Request body for creating a thread.
#[derive(Debug, Deserialize)]
pub struct CreateThreadRequest {
    /// Display title.
    pub title: String,
    /// Linked note path (if any).
    pub linked_note: Option<String>,
}
