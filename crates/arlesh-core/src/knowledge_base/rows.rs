//! The knowledge-base tables' rows: what a query decodes, before it becomes a domain value
//! (ADR 0010, decision 8).

use crate::scopes::db::DbScopeKey;

use super::model::{Event, Person, Thread};

/// A [`Person`] as its table holds it.
#[derive(sqlx::FromRow)]
pub(crate) struct PersonRow {
    id: i64,
    name: String,
    aliases: String,
    linked_note: Option<String>,
}

impl From<PersonRow> for Person {
    fn from(row: PersonRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            aliases: row.aliases,
            linked_note: row.linked_note,
        }
    }
}

/// A [`Event`] as its table holds it.
#[derive(sqlx::FromRow)]
pub(crate) struct EventRow {
    id: i64,
    title: String,
    scope_id: Option<DbScopeKey>,
    event_time: Option<String>,
    linked_note: Option<String>,
}

impl From<EventRow> for Event {
    fn from(row: EventRow) -> Self {
        Self {
            id: row.id,
            title: row.title,
            scope_id: row.scope_id.map(|key| key.0),
            event_time: row.event_time,
            linked_note: row.linked_note,
        }
    }
}

/// A [`Thread`] as its table holds it.
#[derive(sqlx::FromRow)]
pub(crate) struct ThreadRow {
    id: i64,
    title: String,
    linked_note: Option<String>,
}

impl From<ThreadRow> for Thread {
    fn from(row: ThreadRow) -> Self {
        Self {
            id: row.id,
            title: row.title,
            linked_note: row.linked_note,
        }
    }
}
