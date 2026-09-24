//! MCP access: the MCP roots, and what they let the MCP see and do.
//!
//! The MCP endpoint sees nothing by default. The user opens parts of the board to it by naming
//! stored nodes as **MCP roots**: everything inside a root is readable, an Agentic Task inside one
//! is writable too, and private nodes stay hidden throughout. The roots are rows of `mcp_roots`,
//! journaled like every board table, so adding or removing one is an ordinary undoable Gesture.
//!
//! This module owns the table ([`AccessOperator`]) and the resolution ([`resolve::AccessMap`]).
//! What the MCP tools do with the answer — omit, refuse — lives in `crate::mcp::access`.
//!
//! See `docs/spec/mcp-server.md`, "Access".

pub mod error;
pub mod model;
pub mod resolve;

use error::AccessError;
use model::{CatalogueNode, KnowledgeBaseReference, NodeKey, NodeTable};
use resolve::AccessMap;

use crate::database::session::{Db, SessionMode};

#[derive(sqlx::FromRow)]
struct RootRow {
    node_kind: String,
    node_id: i64,
}

#[derive(sqlx::FromRow)]
struct CatalogueRow {
    node_kind: String,
    node_id: i64,
    subtype: Option<String>,
    title: String,
    parent_type: Option<String>,
    parent_id: Option<i64>,
    is_private: bool,
    agentic: Option<bool>,
}

impl TryFrom<CatalogueRow> for CatalogueNode {
    type Error = AccessError;

    fn try_from(row: CatalogueRow) -> Result<Self, Self::Error> {
        let node_kind = NodeTable::from_reference(&row.node_kind)
            .ok_or_else(|| AccessError::Corrupt(format!("node kind {:?}", row.node_kind)))?;
        // A parent reference the vocabulary does not know is read as no parent: the node then
        // resolves as a root would, which denies rather than widens.
        let parent = row
            .parent_type
            .as_deref()
            .zip(row.parent_id)
            .and_then(|(kind, id)| NodeKey::from_reference(kind, id));
        Ok(Self {
            node_kind,
            node_id: row.node_id,
            subtype: row.subtype,
            title: row.title,
            parent_kind: parent.map(|key| key.node_kind),
            parent_id: parent.map(|key| key.node_id),
            is_private: row.is_private,
            agentic: row.agentic,
        })
    }
}

#[derive(sqlx::FromRow)]
struct ReferenceRow {
    owner_kind: String,
    owner_id: i64,
    entity_type: String,
    entity_id: i64,
}

/// Every stored node with where it hangs, in one pass over the nine node tables.
///
/// A domain-table row's parent is always another domain-table row, so its `parent_type` is
/// written out as `domain`; every other table names its parent's kind itself. Only a Task carries
/// an Agentic flag.
const CATALOGUE: &str = "\
    SELECT 'domain' AS node_kind, id AS node_id, subtype, title, \
           CASE WHEN parent_id IS NULL THEN NULL ELSE 'domain' END AS parent_type, parent_id, \
           is_private, NULL AS agentic FROM domains \
    UNION ALL SELECT 'goal', id, NULL, title, parent_type, parent_id, is_private, NULL FROM goals \
    UNION ALL SELECT 'task', id, NULL, title, parent_type, parent_id, is_private, agentic \
              FROM tasks \
    UNION ALL SELECT 'commitment', id, NULL, title, parent_type, parent_id, is_private, NULL \
              FROM commitments \
    UNION ALL SELECT 'expectation', id, NULL, title, parent_type, parent_id, is_private, NULL \
              FROM expectations \
    UNION ALL SELECT 'info', id, NULL, body, parent_type, parent_id, is_private, NULL FROM infos \
    UNION ALL SELECT 'flow', id, NULL, title, parent_type, parent_id, is_private, NULL FROM flows \
    UNION ALL SELECT 'flow_goal', id, NULL, title, parent_type, parent_id, is_private, NULL \
              FROM flow_goals \
    UNION ALL SELECT 'flow_task', id, NULL, title, parent_type, parent_id, is_private, NULL \
              FROM flow_tasks";

/// Every knowledge-base entity a node points at: a Task's Person delegate, and the People,
/// Events and Threads a Task or Goal links. Scope links are the calendar, not the knowledge
/// base, and are left out.
const KNOWLEDGE_BASE_REFERENCES: &str = "\
    SELECT 'task' AS owner_kind, id AS owner_id, 'person' AS entity_type, delegate_id AS entity_id \
      FROM tasks WHERE delegate_kind = 'person' AND delegate_id IS NOT NULL \
    UNION ALL SELECT 'task', task_id, entity_type, entity_id FROM task_knowledge_base_links \
              WHERE entity_type <> 'scope' \
    UNION ALL SELECT 'goal', goal_id, entity_type, entity_id FROM goal_knowledge_base_links \
              WHERE entity_type <> 'scope'";

/// The table a [`NodeTable`] names, for the existence check. A closed set of literals, so the
/// query built from it can never carry caller text.
fn table_name(kind: NodeTable) -> &'static str {
    match kind {
        NodeTable::Domain => "domains",
        NodeTable::Goal => "goals",
        NodeTable::Task => "tasks",
        NodeTable::Commitment => "commitments",
        NodeTable::Expectation => "expectations",
        NodeTable::Info => "infos",
        NodeTable::Flow => "flows",
        NodeTable::FlowGoal => "flow_goals",
        NodeTable::FlowTask => "flow_tasks",
    }
}

/// Reads and writes the MCP roots, and the node facts access is resolved from, on a session's
/// connection.
///
/// Obtained as `db.access()` and used inline; see [`Db`] for the borrow rules and for where an
/// operation belongs.
pub struct AccessOperator<'session> {
    /// The session's connection, borrowed for the duration of this operator's life.
    connection: &'session mut sqlx::SqliteConnection,
}

impl<'session> AccessOperator<'session> {
    /// Wraps the connection a session is lending.
    pub(crate) fn new(connection: &'session mut sqlx::SqliteConnection) -> Self {
        Self { connection }
    }

    /// Every MCP root, in node order.
    #[tracing::instrument(skip(self))]
    pub async fn roots(&mut self) -> Result<Vec<NodeKey>, AccessError> {
        let rows: Vec<RootRow> =
            sqlx::query_as("SELECT node_kind, node_id FROM mcp_roots ORDER BY node_kind, node_id")
                .fetch_all(&mut *self.connection)
                .await?;
        rows.into_iter()
            .map(|row| {
                NodeKey::from_reference(&row.node_kind, row.node_id).ok_or_else(|| {
                    AccessError::Corrupt(format!("MCP root node kind {:?}", row.node_kind))
                })
            })
            .collect()
    }

    /// Makes `node` an MCP root. Adding a node that already is one is not an error.
    ///
    /// A node that is not a row of its table is refused rather than added: a root on nothing
    /// would sit there until SQLite handed the id to an unrelated new row, and open it.
    #[tracing::instrument(skip(self))]
    pub async fn add_root(&mut self, node: NodeKey) -> Result<(), AccessError> {
        if !self.exists(node).await? {
            return Err(AccessError::NodeNotFound(node));
        }
        sqlx::query(
            "INSERT INTO mcp_roots (node_kind, node_id) VALUES (?, ?) \
             ON CONFLICT (node_kind, node_id) DO NOTHING",
        )
        .bind(node.node_kind.as_str())
        .bind(node.node_id)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Stops `node` being an MCP root. Removing a node that is not one is not an error.
    #[tracing::instrument(skip(self))]
    pub async fn remove_root(&mut self, node: NodeKey) -> Result<(), AccessError> {
        sqlx::query("DELETE FROM mcp_roots WHERE node_kind = ? AND node_id = ?")
            .bind(node.node_kind.as_str())
            .bind(node.node_id)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Every stored node, with its title and where it hangs.
    #[tracing::instrument(skip(self))]
    pub async fn catalogue(&mut self) -> Result<Vec<CatalogueNode>, AccessError> {
        let rows: Vec<CatalogueRow> = sqlx::query_as(CATALOGUE)
            .fetch_all(&mut *self.connection)
            .await?;
        rows.into_iter().map(CatalogueNode::try_from).collect()
    }

    /// Every knowledge-base entity a node points at.
    #[tracing::instrument(skip(self))]
    pub async fn knowledge_base_references(
        &mut self,
    ) -> Result<Vec<KnowledgeBaseReference>, AccessError> {
        let rows: Vec<ReferenceRow> = sqlx::query_as(KNOWLEDGE_BASE_REFERENCES)
            .fetch_all(&mut *self.connection)
            .await?;
        rows.into_iter()
            .map(|row| {
                let owner =
                    NodeKey::from_reference(&row.owner_kind, row.owner_id).ok_or_else(|| {
                        AccessError::Corrupt(format!("reference owner {:?}", row.owner_kind))
                    })?;
                Ok(KnowledgeBaseReference {
                    owner,
                    entity_type: row.entity_type,
                    entity_id: row.entity_id,
                })
            })
            .collect()
    }

    /// The Flow a started-flow node was materialised from, if it was.
    #[tracing::instrument(skip(self))]
    pub async fn flow_of_instance_node(
        &mut self,
        node_type: &str,
        node_id: i64,
    ) -> Result<Option<i64>, AccessError> {
        let flow: Option<i64> = sqlx::query_scalar(
            "SELECT i.flow_id FROM flow_instance_nodes n \
             JOIN flow_instances i ON i.id = n.flow_instance_id \
             WHERE n.node_type = ? AND n.node_id = ? LIMIT 1",
        )
        .bind(node_type)
        .bind(node_id)
        .fetch_optional(&mut *self.connection)
        .await?;
        Ok(flow)
    }

    /// Whether `node` is a row of its table.
    async fn exists(&mut self, node: NodeKey) -> Result<bool, AccessError> {
        let found: bool = sqlx::query_scalar(&format!(
            "SELECT EXISTS (SELECT 1 FROM {} WHERE id = ?)",
            table_name(node.node_kind)
        ))
        .bind(node.node_id)
        .fetch_one(&mut *self.connection)
        .await?;
        Ok(found)
    }
}

/// Every stored node's effective MCP access, as the roots stand on `db` now.
///
/// Two reads on one session: a pooled session sees each at its own instant, a transactional one
/// sees both at one. The MCP snapshot resolves inside its own transaction for that reason.
pub async fn access_map<M: SessionMode>(db: &mut Db<M>) -> Result<AccessMap, AccessError> {
    let nodes: Vec<_> = db
        .access()
        .catalogue()
        .await?
        .iter()
        .map(CatalogueNode::stored)
        .collect();
    let roots = db.access().roots().await?;
    Ok(AccessMap::resolve(&nodes, &roots))
}
