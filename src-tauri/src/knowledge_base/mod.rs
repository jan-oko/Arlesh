//! Knowledge-base entities: People, Events, Threads.

pub mod error;
pub mod model;

use crate::database::DatabasePool;
use error::KnowledgeBaseError;
use model::{
    CreateEventRequest, CreatePersonRequest, CreateThreadRequest, Event, Person, PersonId, Thread,
    UpdatePersonRequest,
};

/// Reads and writes knowledge-base people on a
/// [`Db`](crate::database::session::Db) session's connection.
///
/// Borrowed from the session for the duration of a single call — `db.people().…` — and never
/// stored: the session lends its one connection to one operator at a time, so binding two
/// operators simultaneously is a borrow-check error.
pub struct PersonOperator<'session> {
    /// The session's connection, borrowed for the duration of this operator's life.
    // Unfulfilled the moment Task 2.2 moves the first query method onto this operator,
    // which is rustc telling that task to delete these two lines.
    #[expect(dead_code, reason = "read by the query methods Task 2.2 brings")]
    connection: &'session mut sqlx::SqliteConnection,
}

impl<'session> PersonOperator<'session> {
    /// Wraps the connection a session is lending.
    pub(crate) fn new(connection: &'session mut sqlx::SqliteConnection) -> Self {
        Self { connection }
    }
}

/// Repository for Person CRUD operations.
pub struct PersonRepository<'a> {
    pool: &'a DatabasePool,
}

impl<'a> PersonRepository<'a> {
    /// Creates a new repository backed by `pool`.
    pub fn new(pool: &'a DatabasePool) -> Self {
        Self { pool }
    }

    /// Creates a new person.
    pub async fn create(&self, request: CreatePersonRequest) -> Result<Person, KnowledgeBaseError> {
        let aliases = serde_json::to_string(&request.aliases.unwrap_or_default())
            .unwrap_or_else(|_| "[]".into());
        let id = sqlx::query(
            "INSERT INTO people (name, aliases, linked_note) VALUES (?, ?, ?)",
        )
        .bind(&request.name)
        .bind(&aliases)
        .bind(&request.linked_note)
        .execute(self.pool)
        .await?
        .last_insert_rowid();
        self.get(PersonId(id)).await
    }

    /// Fetches a person by id.
    pub async fn get(&self, id: PersonId) -> Result<Person, KnowledgeBaseError> {
        sqlx::query_as::<_, Person>("SELECT * FROM people WHERE id = ?")
            .bind(id.0)
            .fetch_optional(self.pool)
            .await?
            .ok_or(KnowledgeBaseError::PersonNotFound(id.0))
    }

    /// Lists all people.
    pub async fn list(&self) -> Result<Vec<Person>, KnowledgeBaseError> {
        sqlx::query_as::<_, Person>("SELECT * FROM people ORDER BY name")
            .fetch_all(self.pool)
            .await
            .map_err(Into::into)
    }

    /// Updates a person.
    pub async fn update(
        &self,
        id: PersonId,
        request: UpdatePersonRequest,
    ) -> Result<Person, KnowledgeBaseError> {
        let person = self.get(id).await?;
        let name = request.name.unwrap_or(person.name);
        let aliases = request
            .aliases
            .map(|aliases| serde_json::to_string(&aliases).unwrap_or_else(|_| "[]".into()))
            .unwrap_or(person.aliases);
        let linked_note = request.linked_note.or(person.linked_note);

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
    pub async fn delete(&self, id: PersonId) -> Result<(), KnowledgeBaseError> {
        self.get(id).await?;
        sqlx::query("DELETE FROM people WHERE id = ?")
            .bind(id.0)
            .execute(self.pool)
            .await?;
        Ok(())
    }
}

/// Reads and writes knowledge-base events on a
/// [`Db`](crate::database::session::Db) session's connection.
///
/// Borrowed from the session for the duration of a single call — `db.events().…` — and never
/// stored: the session lends its one connection to one operator at a time, so binding two
/// operators simultaneously is a borrow-check error.
pub struct EventOperator<'session> {
    /// The session's connection, borrowed for the duration of this operator's life.
    // Unfulfilled the moment Task 2.2 moves the first query method onto this operator,
    // which is rustc telling that task to delete these two lines.
    #[expect(dead_code, reason = "read by the query methods Task 2.2 brings")]
    connection: &'session mut sqlx::SqliteConnection,
}

impl<'session> EventOperator<'session> {
    /// Wraps the connection a session is lending.
    pub(crate) fn new(connection: &'session mut sqlx::SqliteConnection) -> Self {
        Self { connection }
    }
}

/// Repository for Event CRUD operations.
pub struct EventRepository<'a> {
    pool: &'a DatabasePool,
}

impl<'a> EventRepository<'a> {
    /// Creates a new repository backed by `pool`.
    pub fn new(pool: &'a DatabasePool) -> Self {
        Self { pool }
    }

    /// Creates a new event.
    pub async fn create(&self, request: CreateEventRequest) -> Result<Event, KnowledgeBaseError> {
        let id = sqlx::query(
            "INSERT INTO events (title, scope_id, event_time, linked_note) VALUES (?, ?, ?, ?)",
        )
        .bind(&request.title)
        .bind(request.scope_id)
        .bind(&request.event_time)
        .bind(&request.linked_note)
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
    pub async fn list(&self) -> Result<Vec<Event>, KnowledgeBaseError> {
        sqlx::query_as::<_, Event>("SELECT * FROM events ORDER BY id")
            .fetch_all(self.pool)
            .await
            .map_err(Into::into)
    }

    /// Deletes an event by id.
    pub async fn delete(&self, id: i64) -> Result<(), KnowledgeBaseError> {
        let rows = sqlx::query("DELETE FROM events WHERE id = ?")
            .bind(id)
            .execute(self.pool)
            .await?
            .rows_affected();
        if rows == 0 {
            return Err(KnowledgeBaseError::EventNotFound(id));
        }
        Ok(())
    }
}

/// Reads and writes knowledge-base threads on a
/// [`Db`](crate::database::session::Db) session's connection.
///
/// Borrowed from the session for the duration of a single call — `db.threads().…` — and never
/// stored: the session lends its one connection to one operator at a time, so binding two
/// operators simultaneously is a borrow-check error.
pub struct ThreadOperator<'session> {
    /// The session's connection, borrowed for the duration of this operator's life.
    // Unfulfilled the moment Task 2.2 moves the first query method onto this operator,
    // which is rustc telling that task to delete these two lines.
    #[expect(dead_code, reason = "read by the query methods Task 2.2 brings")]
    connection: &'session mut sqlx::SqliteConnection,
}

impl<'session> ThreadOperator<'session> {
    /// Wraps the connection a session is lending.
    pub(crate) fn new(connection: &'session mut sqlx::SqliteConnection) -> Self {
        Self { connection }
    }
}

/// Repository for Thread CRUD operations.
pub struct ThreadRepository<'a> {
    pool: &'a DatabasePool,
}

impl<'a> ThreadRepository<'a> {
    /// Creates a new repository backed by `pool`.
    pub fn new(pool: &'a DatabasePool) -> Self {
        Self { pool }
    }

    /// Creates a new thread.
    pub async fn create(&self, request: CreateThreadRequest) -> Result<Thread, KnowledgeBaseError> {
        let id = sqlx::query("INSERT INTO threads (title, linked_note) VALUES (?, ?)")
            .bind(&request.title)
            .bind(&request.linked_note)
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
    pub async fn list(&self) -> Result<Vec<Thread>, KnowledgeBaseError> {
        sqlx::query_as::<_, Thread>("SELECT * FROM threads ORDER BY title")
            .fetch_all(self.pool)
            .await
            .map_err(Into::into)
    }

    /// Deletes a thread by id.
    pub async fn delete(&self, id: i64) -> Result<(), KnowledgeBaseError> {
        let rows = sqlx::query("DELETE FROM threads WHERE id = ?")
            .bind(id)
            .execute(self.pool)
            .await?
            .rows_affected();
        if rows == 0 {
            return Err(KnowledgeBaseError::ThreadNotFound(id));
        }
        Ok(())
    }
}
