//! Reading the id an agent gave: a row id as it is, a short id against the board the MCP can see.
//!
//! A short id means nothing without the nodes it has to be told apart from, so resolving one reads
//! the board — the same derive-and-restrict the snapshot does — inside the caller's transaction.
//! A row id needs none of that and is taken at its word; the tool's own access check follows
//! either way.

use chrono::NaiveDateTime;
use rmcp::model::{CallToolResult, ErrorData};

use super::{
    access,
    ids::{IdRefusal, NodeNames},
    params::NodeIdParam,
    result,
};
use crate::{
    access::{
        model::{NodeKey, NodeTable},
        resolve::AccessMap,
    },
    database::session::{Db, Transactional},
    error::AppError,
    mindmap::model::MindmapLoad,
    nodes::id::NodeId,
    tasks::model::Task,
};

/// A tool's answer, ready to return: what a lookup that refuses hands back.
pub(super) type Answer = Result<CallToolResult, ErrorData>;

/// Unwraps a lookup inside a tool, or returns from the tool with the refusal it already built.
macro_rules! found {
    ($lookup:expr) => {
        match $lookup {
            Ok(value) => value,
            Err(answer) => return answer,
        }
    };
}
pub(super) use found;

/// The board as the MCP sees it: the access map, the snapshot cut to the roots, and every visible
/// node's name.
pub(super) struct Board {
    /// Who may read and write what.
    pub map: AccessMap,
    /// The derived board, restricted to what the MCP can see.
    pub load: MindmapLoad,
    /// Every visible node's full and short id.
    pub names: NodeNames,
}

impl Board {
    /// Reads the board at `now`, inside the caller's transaction.
    pub async fn read(db: &mut Db<Transactional>, now: NaiveDateTime) -> Result<Self, AppError> {
        let mut load = crate::mindmap::load(db, now).await?;
        let map = crate::access::access_map(db).await?;
        access::restrict_snapshot(&mut load, &map);
        let names = NodeNames::of(&load);
        Ok(Self { map, load, names })
    }

    /// The node `id` names, which must be of the kind `node_type` spells. A row id is taken as a
    /// stored row, unchecked — the caller's access check decides whether it may be touched.
    pub fn resolve(&self, id: &NodeIdParam, node_type: &str) -> Result<NodeId, Answer> {
        match id {
            NodeIdParam::Row(row) => Ok(NodeId::Stored(*row)),
            NodeIdParam::Short(text) => named(&self.names, text, node_type),
        }
    }

    /// Whether the MCP may write the Task `id`: a stored Task by the access map, a Habit
    /// occurrence when it is visible and reads as Agentic — resolved as the app resolves it.
    pub async fn writes_task(
        &self,
        db: &mut Db<Transactional>,
        id: &NodeId,
        now: NaiveDateTime,
    ) -> Result<bool, AppError> {
        if self.task(id).is_none() {
            return Ok(false);
        }
        super::agentic::reads_agentic(db, &self.map, id, now).await
    }

    /// Whether the MCP may create a Task under the node `parent_type`/`parent` names: anywhere it
    /// can see that holds a Task, except under a Task explicitly Not agentic (see
    /// [`AccessMap::may_create_task_under`]). A Habit occurrence is asked of the board, where it
    /// carries its own flag — its template's, unless it overrides it.
    pub fn may_create_under(&self, parent_type: &str, parent: &NodeId) -> bool {
        match parent {
            NodeId::Stored(row) => NodeKey::from_reference(parent_type, *row)
                .is_some_and(|key| self.map.may_create_task_under(key)),
            NodeId::Derived(_) => {
                let goal = self.load.goals.iter().any(|goal| &goal.id == parent);
                let commitment = self.load.commitments.iter().any(|row| &row.id == parent);
                let task = self
                    .task(parent)
                    .is_some_and(|task| task.agentic != Some(false));
                goal || commitment || task
            }
        }
    }

    /// The Task `id` names, when the MCP can see it.
    pub fn task(&self, id: &NodeId) -> Option<&Task> {
        self.load.tasks.iter().find(|task| &task.id == id)
    }
}

/// The node a short id names among `names`, refused unless it is exactly one of kind `node_type`.
fn named(names: &NodeNames, text: &str, node_type: &str) -> Result<NodeId, Answer> {
    let node = match names.resolve(text) {
        Ok(node) => node,
        Err(IdRefusal::Unknown) => {
            return Err(result::not_permitted(format!(
                "no node inside the MCP roots has the id {text}"
            )))
        }
        Err(IdRefusal::Ambiguous(candidates)) => return Err(result::ambiguous(text, &candidates)),
    };
    if NodeTable::from_reference(node_type) != Some(node.table()) {
        return Err(result::refused(format!(
            "{text} is a {} ({}), not a {node_type}",
            node.kind, node.title
        )));
    }
    Ok(node.node_id.clone())
}

/// The stored row `id` names — for the tools that act on stored rows only. A short id reads the
/// board to resolve; a Habit occurrence is refused, having no row.
pub(super) async fn stored_row(
    db: &mut Db<Transactional>,
    id: &NodeIdParam,
    node_type: &str,
    now: NaiveDateTime,
) -> Result<i64, Answer> {
    let text = match id {
        NodeIdParam::Row(row) => return Ok(*row),
        NodeIdParam::Short(text) => text,
    };
    let board = match Board::read(db, now).await {
        Ok(board) => board,
        Err(error) => return Err(result::failed(error)),
    };
    match board.resolve(id, node_type)? {
        NodeId::Stored(row) => Ok(row),
        NodeId::Derived(_) => Err(result::refused(format!(
            "{text} is a Habit occurrence, which this operation does not take"
        ))),
    }
}
