//! Knowledge-base entity models: People, Events, Threads.

use crate::nodes::id::RowId;
use serde::{Deserialize, Serialize};

use crate::scopes::key::ScopeKey;

/// Identifies a person row by its primary key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct PersonId(#[schemars(with = "String")] pub RowId);

impl From<RowId> for PersonId {
    fn from(value: RowId) -> Self {
        Self(value)
    }
}
impl From<PersonId> for RowId {
    fn from(id: PersonId) -> Self {
        id.0
    }
}

/// A person row as returned from the database.
#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Person {
    /// Primary key.
    #[schemars(with = "String")]
    pub id: RowId,
    /// Display name (equals note title).
    pub name: String,
    /// JSON array of alias strings.
    pub aliases: String,
    /// Path to the linked Obsidian note (if any).
    pub linked_note: Option<String>,
}

/// Request body for creating a person.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CreatePersonRequest {
    /// Display name.
    pub name: String,
    /// Aliases (serialized as JSON array).
    pub aliases: Option<Vec<String>>,
    /// Path to the linked Obsidian note.
    pub linked_note: Option<String>,
}

/// Request body for updating a person.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct UpdatePersonRequest {
    /// New name (if provided).
    pub name: Option<String>,
    /// New aliases (if provided).
    pub aliases: Option<Vec<String>>,
    /// New linked note path (if provided).
    pub linked_note: Option<String>,
}

/// An event row as returned from the database.
#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Event {
    /// Primary key.
    #[schemars(with = "String")]
    pub id: RowId,
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
#[derive(Debug, Deserialize, schemars::JsonSchema)]
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
#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Thread {
    /// Primary key.
    #[schemars(with = "String")]
    pub id: RowId,
    /// Display title.
    pub title: String,
    /// Path to the linked Obsidian note (if any).
    pub linked_note: Option<String>,
}

/// Request body for creating a thread.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CreateThreadRequest {
    /// Display title.
    pub title: String,
    /// Linked note path (if any).
    pub linked_note: Option<String>,
}
