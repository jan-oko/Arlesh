//! The `knowledge_base` part of the [`Backend`](super::Backend) port: what the commands in
//! [`crate::commands::knowledge_base`] ask of whichever backend the app runs on.

use crate::{
    error::WireError,
    knowledge_base::model::{
        CreateEventRequest, CreatePersonRequest, CreateThreadRequest, Event, Person, Thread,
        UpdatePersonRequest,
    },
};

/// The `knowledge_base` operations a backend serves.
#[async_trait::async_trait]
pub trait KnowledgeBasePort: Send + Sync {
    /// Creates a new person.
    async fn create_person(&self, request: CreatePersonRequest) -> Result<Person, WireError>;

    /// Fetches a person by id.
    async fn get_person(&self, id: i64) -> Result<Person, WireError>;

    /// Lists all people.
    async fn list_people(&self) -> Result<Vec<Person>, WireError>;

    /// Updates a person.
    async fn update_person(
        &self,
        id: i64,
        request: UpdatePersonRequest,
    ) -> Result<Person, WireError>;

    /// Deletes a person by id.
    async fn delete_person(&self, id: i64) -> Result<(), WireError>;

    /// Creates a new event.
    async fn create_event(&self, request: CreateEventRequest) -> Result<Event, WireError>;

    /// Lists all events.
    async fn list_events(&self) -> Result<Vec<Event>, WireError>;

    /// Creates a new thread.
    async fn create_thread(&self, request: CreateThreadRequest) -> Result<Thread, WireError>;

    /// Lists all threads.
    async fn list_threads(&self) -> Result<Vec<Thread>, WireError>;
}
