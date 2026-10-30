//! [`SqliteBackend`]'s `knowledge_base` operations: the in-process core over the local file.

use crate::{
    error::WireError,
    knowledge_base::model::{
        CreateEventRequest, CreatePersonRequest, CreateThreadRequest, Event, Person, PersonId,
        Thread, UpdatePersonRequest,
    },
};

use super::SqliteBackend;
use crate::backend::knowledge_base::KnowledgeBasePort;

#[async_trait::async_trait]
impl KnowledgeBasePort for SqliteBackend {
    async fn create_person(&self, request: CreatePersonRequest) -> Result<Person, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.people()
            .create(request)
            .await
            .map_err(WireError::from_error)
    }

    async fn get_person(&self, id: i64) -> Result<Person, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.people()
            .get(PersonId(id))
            .await
            .map_err(WireError::from_error)
    }

    async fn list_people(&self) -> Result<Vec<Person>, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.people().list().await.map_err(WireError::from_error)
    }

    async fn update_person(
        &self,
        id: i64,
        request: UpdatePersonRequest,
    ) -> Result<Person, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.people()
            .update(PersonId(id), request)
            .await
            .map_err(WireError::from_error)
    }

    async fn delete_person(&self, id: i64) -> Result<(), WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.people()
            .delete(PersonId(id))
            .await
            .map_err(WireError::from_error)
    }

    async fn create_event(&self, request: CreateEventRequest) -> Result<Event, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.events()
            .create(request)
            .await
            .map_err(WireError::from_error)
    }

    async fn list_events(&self) -> Result<Vec<Event>, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.events().list().await.map_err(WireError::from_error)
    }

    async fn create_thread(&self, request: CreateThreadRequest) -> Result<Thread, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.threads()
            .create(request)
            .await
            .map_err(WireError::from_error)
    }

    async fn list_threads(&self) -> Result<Vec<Thread>, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.threads().list().await.map_err(WireError::from_error)
    }
}
