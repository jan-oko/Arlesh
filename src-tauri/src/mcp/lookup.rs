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
    ids::{parent_spelling, IdRefusal, Named, NodeNames},
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
        let domains = load.domains.clone();
        access::restrict_snapshot(&mut load, &map);
        let names = NodeNames::of(&load).with_subtypes(&domains);
        Ok(Self { map, load, names })
    }

    /// `parent_type` as a Task stores it. A domain-table parent may be asked for by any of the
    /// four subtype names or `domain` — they name the same table, so all are accepted — and is
    /// written as the board spells it ([`parent_spelling`]); any other kind as given.
    pub fn stored_parent_type(&self, parent_type: &str, parent: &NodeId) -> String {
        match (NodeTable::from_reference(parent_type), parent) {
            (Some(NodeTable::Domain), NodeId::Stored(row)) => match self.names.subtype(*row) {
                Some(subtype) => parent_spelling(subtype).to_string(),
                None => parent_type.to_string(),
            },
            _ => parent_type.to_string(),
        }
    }

    /// The visible node `id` names, which must be of the kind `node_type` spells — matched as a
    /// row id and as a full-id prefix at once (see [`NodeNames::resolve_as`]).
    pub fn resolve(&self, id: &NodeIdParam, node_type: &str) -> Result<NodeId, Answer> {
        named(&self.names, &id.text(), Some(node_type)).map(|node| node.node_id.clone())
    }

    /// The visible node `id` names among the kinds `node_types` spell, for a parameter that takes
    /// several — matched as [`Board::resolve`] matches, a row id counting only rows of those kinds,
    /// and refused unless it is exactly one. The caller reads the kind off the answer.
    pub fn resolve_among(&self, id: &NodeIdParam, node_types: &[&str]) -> Result<&Named, Answer> {
        let text = id.text();
        let mut found: Vec<&Named> = Vec::new();
        for node_type in node_types {
            match self
                .names
                .resolve_as(&text, NodeTable::from_reference(node_type))
            {
                Ok(node) => found.push(node),
                Err(IdRefusal::Ambiguous(candidates)) => {
                    return Err(result::ambiguous(&text, &candidates))
                }
                Err(IdRefusal::Unknown | IdRefusal::WrongKind(_)) => {}
            }
        }
        match found.as_slice() {
            [one] => Ok(*one),
            [] => {
                // Nothing of those kinds: say what it does name, if anything the MCP can see.
                let other = named(&self.names, &text, None)?;
                Err(result::refused(format!(
                    "{text} is a {} ({}), not a {}",
                    other.kind,
                    other.title,
                    node_types.join(" or ")
                )))
            }
            several => {
                let candidates: Vec<Named> = several.iter().copied().cloned().collect();
                Err(result::ambiguous(&text, &candidates))
            }
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

/// The row id `id` names, for an entity that is not a node and has no full id — a Person: the
/// id's text in decimal, and `None` for anything else.
pub(super) fn plain_row(id: &NodeIdParam) -> Option<i64> {
    let text = id.text();
    let text = text.trim();
    if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

/// The visible node of kind `node_type` (any kind, when `None`) that `text` names, refused unless
/// it is exactly one.
fn named<'names>(
    names: &'names NodeNames,
    text: &str,
    node_type: Option<&str>,
) -> Result<&'names Named, Answer> {
    match names.resolve_as(text, node_type.and_then(NodeTable::from_reference)) {
        Ok(node) => Ok(node),
        Err(IdRefusal::Unknown) => Err(result::not_permitted(format!(
            "no node inside the MCP roots has the id {text}"
        ))),
        Err(IdRefusal::Ambiguous(candidates)) => Err(result::ambiguous(text, &candidates)),
        Err(IdRefusal::WrongKind(node)) => Err(result::refused(format!(
            "{text} is a {} ({}), not a {}",
            node.kind,
            node.title,
            node_type.unwrap_or("node")
        ))),
    }
}

/// The stored row `id` names — for the tools that act on stored rows only. The id is resolved
/// against the board like any other; a Habit occurrence is refused, having no row.
pub(super) async fn stored_row(
    db: &mut Db<Transactional>,
    id: &NodeIdParam,
    node_type: &str,
    now: NaiveDateTime,
) -> Result<i64, Answer> {
    let text = id.text();
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
