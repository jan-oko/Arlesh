//! Knowledge-base entities: People, Events, Threads.

pub mod error;
pub mod model;

use error::KnowledgeBaseError;
use model::{
    CreateEventRequest, CreatePersonRequest, CreateThreadRequest, Event, Person, PersonId, Thread,
    UpdatePersonRequest,
};

/// Reads and writes knowledge-base people on a session's connection.
///
/// Obtained as `db.people()` and used inline; see [`Db`](crate::database::session::Db) for
/// the borrow rules and for where an operation belongs.
pub struct PersonOperator<'session> {
    /// The session's connection, borrowed for the duration of this operator's life.
    connection: &'session mut sqlx::SqliteConnection,
}

impl<'session> PersonOperator<'session> {
    /// Wraps the connection a session is lending.
    pub(crate) fn new(connection: &'session mut sqlx::SqliteConnection) -> Self {
        Self { connection }
    }

    /// Creates a new person.
    ///
    /// A single `INSERT` (followed by a read of the created row), so it is atomic on its own —
    /// SQLite gives statement-level atomicity to a single write.
    pub async fn create(&mut self, request: CreatePersonRequest) -> Result<Person, KnowledgeBaseError> {
        let aliases = serde_json::to_string(&request.aliases.unwrap_or_default())
            .unwrap_or_else(|_| "[]".into());
        let id = sqlx::query(
            "INSERT INTO people (name, aliases, linked_note) VALUES (?, ?, ?)",
        )
        .bind(&request.name)
        .bind(&aliases)
        .bind(&request.linked_note)
        .execute(&mut *self.connection)
        .await?
        .last_insert_rowid();
        self.get(PersonId(id)).await
    }

    /// Fetches a person by id.
    pub async fn get(&mut self, id: PersonId) -> Result<Person, KnowledgeBaseError> {
        sqlx::query_as::<_, Person>("SELECT * FROM people WHERE id = ?")
            .bind(id.0)
            .fetch_optional(&mut *self.connection)
            .await?
            .ok_or(KnowledgeBaseError::PersonNotFound(id.0))
    }

    /// Lists all people.
    pub async fn list(&mut self) -> Result<Vec<Person>, KnowledgeBaseError> {
        sqlx::query_as::<_, Person>("SELECT * FROM people ORDER BY name")
            .fetch_all(&mut *self.connection)
            .await
            .map_err(Into::into)
    }

    /// Updates a person.
    ///
    /// A single `UPDATE` (preceded and followed by reads), so it is atomic on its own.
    pub async fn update(
        &mut self,
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
            .execute(&mut *self.connection)
            .await?;
        self.get(id).await
    }

    /// Deletes a person by id.
    ///
    /// A single `DELETE` (preceded by a read), so it is atomic on its own.
    pub async fn delete(&mut self, id: PersonId) -> Result<(), KnowledgeBaseError> {
        self.get(id).await?;
        sqlx::query("DELETE FROM people WHERE id = ?")
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }
}

/// Reads and writes knowledge-base events on a session's connection.
///
/// Obtained as `db.events()` and used inline; see [`Db`](crate::database::session::Db) for
/// the borrow rules and for where an operation belongs.
pub struct EventOperator<'session> {
    /// The session's connection, borrowed for the duration of this operator's life.
    connection: &'session mut sqlx::SqliteConnection,
}

impl<'session> EventOperator<'session> {
    /// Wraps the connection a session is lending.
    pub(crate) fn new(connection: &'session mut sqlx::SqliteConnection) -> Self {
        Self { connection }
    }

    /// Creates a new event.
    ///
    /// A single `INSERT` (followed by a read of the created row), so it is atomic on its own.
    pub async fn create(&mut self, request: CreateEventRequest) -> Result<Event, KnowledgeBaseError> {
        let id = sqlx::query(
            "INSERT INTO events (title, scope_id, event_time, linked_note) VALUES (?, ?, ?, ?)",
        )
        .bind(&request.title)
        .bind(request.scope_id)
        .bind(&request.event_time)
        .bind(&request.linked_note)
        .execute(&mut *self.connection)
        .await?
        .last_insert_rowid();
        sqlx::query_as::<_, Event>("SELECT * FROM events WHERE id = ?")
            .bind(id)
            .fetch_one(&mut *self.connection)
            .await
            .map_err(Into::into)
    }

    /// Lists all events.
    pub async fn list(&mut self) -> Result<Vec<Event>, KnowledgeBaseError> {
        sqlx::query_as::<_, Event>("SELECT * FROM events ORDER BY id")
            .fetch_all(&mut *self.connection)
            .await
            .map_err(Into::into)
    }

    /// Deletes an event by id.
    ///
    /// A single `DELETE`, so it is atomic on its own.
    pub async fn delete(&mut self, id: i64) -> Result<(), KnowledgeBaseError> {
        let rows = sqlx::query("DELETE FROM events WHERE id = ?")
            .bind(id)
            .execute(&mut *self.connection)
            .await?
            .rows_affected();
        if rows == 0 {
            return Err(KnowledgeBaseError::EventNotFound(id));
        }
        Ok(())
    }
}

/// Reads and writes knowledge-base threads on a session's connection.
///
/// Obtained as `db.threads()` and used inline; see [`Db`](crate::database::session::Db) for
/// the borrow rules and for where an operation belongs.
pub struct ThreadOperator<'session> {
    /// The session's connection, borrowed for the duration of this operator's life.
    connection: &'session mut sqlx::SqliteConnection,
}

impl<'session> ThreadOperator<'session> {
    /// Wraps the connection a session is lending.
    pub(crate) fn new(connection: &'session mut sqlx::SqliteConnection) -> Self {
        Self { connection }
    }

    /// Creates a new thread.
    ///
    /// A single `INSERT` (followed by a read of the created row), so it is atomic on its own.
    pub async fn create(&mut self, request: CreateThreadRequest) -> Result<Thread, KnowledgeBaseError> {
        let id = sqlx::query("INSERT INTO threads (title, linked_note) VALUES (?, ?)")
            .bind(&request.title)
            .bind(&request.linked_note)
            .execute(&mut *self.connection)
            .await?
            .last_insert_rowid();
        sqlx::query_as::<_, Thread>("SELECT * FROM threads WHERE id = ?")
            .bind(id)
            .fetch_one(&mut *self.connection)
            .await
            .map_err(Into::into)
    }

    /// Lists all threads.
    pub async fn list(&mut self) -> Result<Vec<Thread>, KnowledgeBaseError> {
        sqlx::query_as::<_, Thread>("SELECT * FROM threads ORDER BY title")
            .fetch_all(&mut *self.connection)
            .await
            .map_err(Into::into)
    }

    /// Deletes a thread by id.
    ///
    /// A single `DELETE`, so it is atomic on its own.
    pub async fn delete(&mut self, id: i64) -> Result<(), KnowledgeBaseError> {
        let rows = sqlx::query("DELETE FROM threads WHERE id = ?")
            .bind(id)
            .execute(&mut *self.connection)
            .await?
            .rows_affected();
        if rows == 0 {
            return Err(KnowledgeBaseError::ThreadNotFound(id));
        }
        Ok(())
    }
}
