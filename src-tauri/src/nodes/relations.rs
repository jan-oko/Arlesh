//! A derived node's relations: differences against its template (migration 0060).
//!
//! A stored node keeps today's relation tables. A derived node inherits its template's tags,
//! block reasons and dependencies, and what one occurrence changes is stored as a difference keyed
//! by its canonical node key: a tag added or taken off, a block-reason list of its own, a
//! dependency added or one of the template's removed. The effective relation is always the
//! template's with the difference applied, so a template edit still reaches every occurrence that
//! has not said otherwise.

use std::collections::{HashMap, HashSet};

use sqlx::SqliteConnection;

use super::id::NodeId;

/// Tag differences, by node key: `(tag, added)` pairs.
pub type TagDifferences = HashMap<String, Vec<(i64, bool)>>;

/// One `derived_dependencies` row: an edge with at least one derived end.
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct DerivedEdge {
    /// A stored dependent, when the dependent is stored.
    pub dependent_id: Option<i64>,
    /// A derived dependent's node key, when the dependent is derived.
    pub dependent_key: Option<String>,
    /// What is depended on: `task`, `goal` or `expectation`.
    pub target_type: String,
    /// A stored target, when the target is stored.
    pub target_id: Option<i64>,
    /// A derived target's node key, when the target is derived.
    pub target_key: Option<String>,
    /// Whether the edge is added, or one of the template's own removed.
    pub added: bool,
}

impl DerivedEdge {
    /// The dependent end as a row id.
    pub fn dependent(&self) -> Option<NodeId> {
        endpoint(self.dependent_id, self.dependent_key.as_deref())
    }

    /// The target end as a row id.
    pub fn target(&self) -> Option<NodeId> {
        endpoint(self.target_id, self.target_key.as_deref())
    }
}

/// One end of an edge as the row id it names.
fn endpoint(id: Option<i64>, key: Option<&str>) -> Option<NodeId> {
    match (id, key) {
        (Some(id), _) => Some(NodeId::Stored(id)),
        (None, Some(key)) => Some(NodeId::Derived(super::id::DerivedId::of_key(key))),
        (None, None) => None,
    }
}

/// One end of an edge being written: a stored row, or a derived node's key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Endpoint {
    /// A stored row.
    Stored(i64),
    /// A derived node, by canonical key.
    Derived(String),
}

impl Endpoint {
    fn columns(&self) -> (Option<i64>, Option<&str>) {
        match self {
            Self::Stored(id) => (Some(*id), None),
            Self::Derived(key) => (None, Some(key.as_str())),
        }
    }
}

/// Reads and writes derived relations on one connection. Opens no transaction of its own.
pub struct RelationOperator<'session> {
    connection: &'session mut SqliteConnection,
}

impl<'session> RelationOperator<'session> {
    /// Wraps a connection.
    pub(crate) fn new(connection: &'session mut SqliteConnection) -> Self {
        Self { connection }
    }

    /// Every tag difference one Habit's occurrences carry.
    pub async fn tags_for_habit(&mut self, flow_id: i64) -> Result<TagDifferences, sqlx::Error> {
        let rows: Vec<(String, i64, bool)> = sqlx::query_as(
            "SELECT node_key, tag_id, added FROM derived_tags WHERE flow_id = ? ORDER BY tag_id",
        )
        .bind(flow_id)
        .fetch_all(&mut *self.connection)
        .await?;
        let mut differences: TagDifferences = HashMap::new();
        for (key, tag, added) in rows {
            differences.entry(key).or_default().push((tag, added));
        }
        Ok(differences)
    }

    /// Every tag difference a derived node that belongs to no Habit carries — a wait's check task.
    pub async fn tags_without_habit(&mut self) -> Result<TagDifferences, sqlx::Error> {
        let rows: Vec<(String, i64, bool)> = sqlx::query_as(
            "SELECT node_key, tag_id, added FROM derived_tags WHERE flow_id IS NULL ORDER BY tag_id",
        )
        .fetch_all(&mut *self.connection)
        .await?;
        let mut differences: TagDifferences = HashMap::new();
        for (key, tag, added) in rows {
            differences.entry(key).or_default().push((tag, added));
        }
        Ok(differences)
    }

    /// Every tag difference a derived wait carries — a spawned or delegation wait, whoever its Task.
    pub async fn expectation_tags(&mut self) -> Result<TagDifferences, sqlx::Error> {
        let rows: Vec<(String, i64, bool)> = sqlx::query_as(
            "SELECT node_key, tag_id, added FROM derived_tags WHERE node_kind = 'expectation'
             ORDER BY tag_id",
        )
        .fetch_all(&mut *self.connection)
        .await?;
        let mut differences: TagDifferences = HashMap::new();
        for (key, tag, added) in rows {
            differences.entry(key).or_default().push((tag, added));
        }
        Ok(differences)
    }

    /// Records a tag put on (`present`) or taken off one derived node, as a difference against
    /// its template's tags: a tag the template already has needs no row to be present, and one it
    /// lacks needs none to be absent. `flow_id` is the Habit the node belongs to, if any.
    pub async fn set_tag(
        &mut self,
        flow_id: Option<i64>,
        node_kind: &str,
        node_key: &str,
        tag_id: i64,
        in_template: bool,
        present: bool,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM derived_tags WHERE node_key = ? AND tag_id = ?")
            .bind(node_key)
            .bind(tag_id)
            .execute(&mut *self.connection)
            .await?;
        if in_template == present {
            return Ok(());
        }
        sqlx::query(
            "INSERT INTO derived_tags (flow_id, node_kind, node_key, tag_id, added)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(flow_id)
        .bind(node_kind)
        .bind(node_key)
        .bind(tag_id)
        .bind(present)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Every derived node's own block-reason list, by node key, in order.
    pub async fn block_reasons_for_habit(
        &mut self,
        flow_id: i64,
    ) -> Result<HashMap<String, Vec<String>>, sqlx::Error> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT node_key, reason FROM derived_block_reasons WHERE flow_id = ?
             ORDER BY node_key, position, id",
        )
        .bind(flow_id)
        .fetch_all(&mut *self.connection)
        .await?;
        let mut lists: HashMap<String, Vec<String>> = HashMap::new();
        for (key, reason) in rows {
            lists.entry(key).or_default().push(reason);
        }
        Ok(lists)
    }

    /// Every own block-reason list of a derived node that belongs to no Habit, by node key.
    pub async fn block_reasons_without_habit(
        &mut self,
    ) -> Result<HashMap<String, Vec<String>>, sqlx::Error> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT node_key, reason FROM derived_block_reasons WHERE flow_id IS NULL
             ORDER BY node_key, position, id",
        )
        .fetch_all(&mut *self.connection)
        .await?;
        let mut lists: HashMap<String, Vec<String>> = HashMap::new();
        for (key, reason) in rows {
            lists.entry(key).or_default().push(reason);
        }
        Ok(lists)
    }

    /// Replaces one derived node's own block-reason list (`None` clears it, so it reads its
    /// template's again). `flow_id` is the Habit the node belongs to, if any.
    pub async fn set_block_reasons(
        &mut self,
        flow_id: Option<i64>,
        node_kind: &str,
        node_key: &str,
        reasons: Option<&[String]>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM derived_block_reasons WHERE node_key = ?")
            .bind(node_key)
            .execute(&mut *self.connection)
            .await?;
        for (position, reason) in reasons.unwrap_or_default().iter().enumerate() {
            sqlx::query(
                "INSERT INTO derived_block_reasons (flow_id, node_kind, node_key, reason, position)
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(flow_id)
            .bind(node_kind)
            .bind(node_key)
            .bind(reason)
            .bind(i64::try_from(position).unwrap_or(i64::MAX))
            .execute(&mut *self.connection)
            .await?;
        }
        Ok(())
    }

    /// Every edge with a derived end.
    pub async fn dependencies(&mut self) -> Result<Vec<DerivedEdge>, sqlx::Error> {
        sqlx::query_as(
            "SELECT dependent_id, dependent_key, target_type, target_id, target_key, added
             FROM derived_dependencies ORDER BY id",
        )
        .fetch_all(&mut *self.connection)
        .await
    }

    /// The template edges removed from derived dependents, as `(dependent key, target key)`.
    pub async fn removed_template_edges(
        &mut self,
    ) -> Result<HashSet<(String, String)>, sqlx::Error> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT dependent_key, target_key FROM derived_dependencies
             WHERE added = 0 AND dependent_key IS NOT NULL AND target_key IS NOT NULL",
        )
        .fetch_all(&mut *self.connection)
        .await?;
        Ok(rows.into_iter().collect())
    }

    /// Writes one edge difference: `added` puts the edge on, `!added` records one of the
    /// template's own edges as removed. Any earlier difference for the same edge is replaced.
    pub async fn put_dependency(
        &mut self,
        flow_id: Option<i64>,
        dependent: &Endpoint,
        target_type: &str,
        target: &Endpoint,
        added: bool,
    ) -> Result<(), sqlx::Error> {
        self.clear_dependency(dependent, target_type, target)
            .await?;
        let (dependent_id, dependent_key) = dependent.columns();
        let (target_id, target_key) = target.columns();
        sqlx::query(
            "INSERT INTO derived_dependencies
                (flow_id, dependent_id, dependent_key, target_type, target_id, target_key, added)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(flow_id)
        .bind(dependent_id)
        .bind(dependent_key)
        .bind(target_type)
        .bind(target_id)
        .bind(target_key)
        .bind(added)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Forgets any difference recorded for one edge, so it reads as its template says.
    pub async fn clear_dependency(
        &mut self,
        dependent: &Endpoint,
        target_type: &str,
        target: &Endpoint,
    ) -> Result<(), sqlx::Error> {
        let (dependent_id, dependent_key) = dependent.columns();
        let (target_id, target_key) = target.columns();
        sqlx::query(
            "DELETE FROM derived_dependencies
             WHERE dependent_id IS ? AND dependent_key IS ? AND target_type = ?
               AND target_id IS ? AND target_key IS ?",
        )
        .bind(dependent_id)
        .bind(dependent_key)
        .bind(target_type)
        .bind(target_id)
        .bind(target_key)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Forgets every edge naming a stored row that is going.
    pub async fn forget_stored(&mut self, node_type: &str, id: i64) -> Result<(), sqlx::Error> {
        sqlx::query(
            "DELETE FROM derived_dependencies
             WHERE (dependent_id = ?1 AND ?2 = 'task') OR (target_type = ?2 AND target_id = ?1)",
        )
        .bind(id)
        .bind(node_type)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
