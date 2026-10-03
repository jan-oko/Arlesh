//! The domains table's rows: what a query decodes, before it becomes a domain value (ADR 0010,
//! decision 8).

use super::model::Domain;

/// A [`Domain`] as its table holds it.
#[derive(sqlx::FromRow)]
pub(crate) struct DomainRow {
    id: i64,
    title: String,
    description: Option<String>,
    subtype: String,
    parent_id: Option<i64>,
    color: Option<String>,
    status: Option<String>,
    knowledge_base_directory: Option<String>,
    position: i64,
    is_private: bool,
}

impl From<DomainRow> for Domain {
    fn from(row: DomainRow) -> Self {
        Self {
            id: row.id,
            title: row.title,
            description: row.description,
            subtype: row.subtype,
            parent_id: row.parent_id,
            color: row.color,
            status: row.status,
            knowledge_base_directory: row.knowledge_base_directory,
            position: row.position,
            is_private: row.is_private,
        }
    }
}
