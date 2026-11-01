//! [`HttpBackend`]'s knowledge base: none. People, events and threads are out of Client mode's
//! scope (`docs/spec/client-mode.md`): the server has no routes for them, so every call is refused
//! as not available in Client mode, and the windows hide them.

use crate::{
    error::WireError,
    knowledge_base::model::{
        CreateEventRequest, CreatePersonRequest, CreateThreadRequest, Event, Person, Thread,
        UpdatePersonRequest,
    },
};

use super::{not_in_client_mode, HttpBackend};
use crate::backend::knowledge_base::KnowledgeBasePort;

/// What the refusals name.
const KNOWLEDGE_BASE: &str = "The knowledge base (people, events and threads)";

#[async_trait::async_trait]
impl KnowledgeBasePort for HttpBackend {
    async fn create_person(&self, _request: CreatePersonRequest) -> Result<Person, WireError> {
        Err(not_in_client_mode(KNOWLEDGE_BASE))
    }

    async fn get_person(&self, _id: i64) -> Result<Person, WireError> {
        Err(not_in_client_mode(KNOWLEDGE_BASE))
    }

    async fn list_people(&self) -> Result<Vec<Person>, WireError> {
        Err(not_in_client_mode(KNOWLEDGE_BASE))
    }

    async fn update_person(
        &self,
        _id: i64,
        _request: UpdatePersonRequest,
    ) -> Result<Person, WireError> {
        Err(not_in_client_mode(KNOWLEDGE_BASE))
    }

    async fn delete_person(&self, _id: i64) -> Result<(), WireError> {
        Err(not_in_client_mode(KNOWLEDGE_BASE))
    }

    async fn create_event(&self, _request: CreateEventRequest) -> Result<Event, WireError> {
        Err(not_in_client_mode(KNOWLEDGE_BASE))
    }

    async fn list_events(&self) -> Result<Vec<Event>, WireError> {
        Err(not_in_client_mode(KNOWLEDGE_BASE))
    }

    async fn create_thread(&self, _request: CreateThreadRequest) -> Result<Thread, WireError> {
        Err(not_in_client_mode(KNOWLEDGE_BASE))
    }

    async fn list_threads(&self) -> Result<Vec<Thread>, WireError> {
        Err(not_in_client_mode(KNOWLEDGE_BASE))
    }
}
