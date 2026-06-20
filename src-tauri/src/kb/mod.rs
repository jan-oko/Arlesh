//! Knowledge-base entities: People, Events, Threads.

pub mod error;
pub mod model;

use crate::db::DbPool;
use error::KbError;
use model::{
    CreateEventRequest, CreatePersonRequest, CreateThreadRequest, Event, Person, PersonId, Thread,
    UpdatePersonRequest,
};

/// Repository for Person CRUD operations.
pub struct PersonRepository<'a> {
    pool: &'a DbPool,
}

impl<'a> PersonRepository<'a> {
    /// Creates a new repository backed by `pool`.
    pub fn new(pool: &'a DbPool) -> Self {
        Self { pool }
    }

    /// Creates a new person.
    pub async fn create(&self, req: CreatePersonRequest) -> Result<Person, KbError> {
        let aliases = serde_json::to_string(&req.aliases.unwrap_or_default()).unwrap_or_else(|_| "[]".into());
        let id = sqlx::query(
            "INSERT INTO people (name, aliases, linked_note) VALUES (?, ?, ?)",
        )
        .bind(&req.name)
        .bind(&aliases)
        .bind(&req.linked_note)
        .execute(self.pool)
        .await?
        .last_insert_rowid();
        self.get(PersonId(id)).await
    }

    /// Fetches a person by id.
    pub async fn get(&self, id: PersonId) -> Result<Person, KbError> {
        sqlx::query_as::<_, Person>("SELECT * FROM people WHERE id = ?")
            .bind(id.0)
            .fetch_optional(self.pool)
            .await?
            .ok_or(KbError::PersonNotFound(id.0))
    }

    /// Lists all people.
    pub async fn list(&self) -> Result<Vec<Person>, KbError> {
        sqlx::query_as::<_, Person>("SELECT * FROM people ORDER BY name")
            .fetch_all(self.pool)
            .await
            .map_err(Into::into)
    }

    /// Updates a person.
    pub async fn update(&self, id: PersonId, req: UpdatePersonRequest) -> Result<Person, KbError> {
        let person = self.get(id).await?;
        let name = req.name.unwrap_or(person.name);
        let aliases = req
            .aliases
            .map(|a| serde_json::to_string(&a).unwrap_or_else(|_| "[]".into()))
            .unwrap_or(person.aliases);
        let linked_note = req.linked_note.or(person.linked_note);

        sqlx::query("UPDATE people SET name=?, aliases=?, linked_note=? WHERE id=?")
            .bind(&name)
            .bind(&aliases)
            .bind(&linked_note)
            .bind(id.0)
            .execute(self.pool)
            .await?;
        self.get(id).await
    }

    /// Deletes a person by id.
    pub async fn delete(&self, id: PersonId) -> Result<(), KbError> {
        self.get(id).await?;
        sqlx::query("DELETE FROM people WHERE id = ?")
            .bind(id.0)
            .execute(self.pool)
            .await?;
        Ok(())
    }
}

/// Repository for Event CRUD operations.
pub struct EventRepository<'a> {
    pool: &'a DbPool,
}

impl<'a> EventRepository<'a> {
    /// Creates a new repository backed by `pool`.
    pub fn new(pool: &'a DbPool) -> Self {
        Self { pool }
    }

    /// Creates a new event.
    pub async fn create(&self, req: CreateEventRequest) -> Result<Event, KbError> {
        let id = sqlx::query(
            "INSERT INTO events (title, scope_id, event_time, linked_note) VALUES (?, ?, ?, ?)",
        )
        .bind(&req.title)
        .bind(req.scope_id)
        .bind(&req.event_time)
        .bind(&req.linked_note)
        .execute(self.pool)
        .await?
        .last_insert_rowid();
        sqlx::query_as::<_, Event>("SELECT * FROM events WHERE id = ?")
            .bind(id)
            .fetch_one(self.pool)
            .await
            .map_err(Into::into)
    }

    /// Lists all events.
    pub async fn list(&self) -> Result<Vec<Event>, KbError> {
        sqlx::query_as::<_, Event>("SELECT * FROM events ORDER BY id")
            .fetch_all(self.pool)
            .await
            .map_err(Into::into)
    }

    /// Deletes an event by id.
    pub async fn delete(&self, id: i64) -> Result<(), KbError> {
        let rows = sqlx::query("DELETE FROM events WHERE id = ?")
            .bind(id)
            .execute(self.pool)
            .await?
            .rows_affected();
        if rows == 0 {
            return Err(KbError::EventNotFound(id));
        }
        Ok(())
    }
}

/// Repository for Thread CRUD operations.
pub struct ThreadRepository<'a> {
    pool: &'a DbPool,
}

impl<'a> ThreadRepository<'a> {
    /// Creates a new repository backed by `pool`.
    pub fn new(pool: &'a DbPool) -> Self {
        Self { pool }
    }

    /// Creates a new thread.
    pub async fn create(&self, req: CreateThreadRequest) -> Result<Thread, KbError> {
        let id = sqlx::query(
            "INSERT INTO threads (title, linked_note) VALUES (?, ?)",
        )
        .bind(&req.title)
        .bind(&req.linked_note)
        .execute(self.pool)
        .await?
        .last_insert_rowid();
        sqlx::query_as::<_, Thread>("SELECT * FROM threads WHERE id = ?")
            .bind(id)
            .fetch_one(self.pool)
            .await
            .map_err(Into::into)
    }

    /// Lists all threads.
    pub async fn list(&self) -> Result<Vec<Thread>, KbError> {
        sqlx::query_as::<_, Thread>("SELECT * FROM threads ORDER BY title")
            .fetch_all(self.pool)
            .await
            .map_err(Into::into)
    }

    /// Deletes a thread by id.
    pub async fn delete(&self, id: i64) -> Result<(), KbError> {
        let rows = sqlx::query("DELETE FROM threads WHERE id = ?")
            .bind(id)
            .execute(self.pool)
            .await?
            .rows_affected();
        if rows == 0 {
            return Err(KbError::ThreadNotFound(id));
        }
        Ok(())
    }
}
