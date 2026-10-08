//! What a Task write changes beside the Task's own row: its prerequisites, its tags and its explicit
//! block reasons.
//!
//! The app writes each through a command of its own — `add_task_dependency`,
//! `remove_task_dependency`, `add_tag_to_task`, `remove_tag_from_task`, `set_block_reasons` — and
//! every one of those delegates to [`crate::nodes::write`], stored Tasks and Habit occurrences
//! alike. So do these, with the same validation: a dependency that would close a cycle is refused
//! exactly as the app refuses it.
//!
//! Every id is read before anything is written, against the board the MCP can see: a prerequisite
//! or a Tag need only be **visible**, and one that is not is refused as `not_permitted`, as any
//! node outside the roots is. The writes then run inside the tool's one transaction, after the
//! row's.

use chrono::NaiveDateTime;

use super::{
    lookup::{Answer, Board},
    params::NodeIdParam,
    result,
};
use crate::{
    database::session::{Db, Transactional},
    error::AppError,
    nodes::{id::NodeId, write},
    tasks::model::Dependency,
};

/// The relation changes an agent asked for, with its ids as it gave them.
#[derive(Default)]
pub(super) struct Asked {
    /// Prerequisites to add.
    pub add_dependencies: Vec<NodeIdParam>,
    /// Prerequisites to remove.
    pub remove_dependencies: Vec<NodeIdParam>,
    /// Tags to put on.
    pub add_tags: Vec<NodeIdParam>,
    /// Tags to take off.
    pub remove_tags: Vec<NodeIdParam>,
    /// The block-reason list to replace the Task's with, when it changes.
    pub block_reasons: Option<Vec<String>>,
}

/// The relation changes of one write, every id read and permitted.
#[derive(Default)]
pub(super) struct Relations {
    add_dependencies: Vec<Dependency>,
    remove_dependencies: Vec<Dependency>,
    add_tags: Vec<i64>,
    remove_tags: Vec<i64>,
    block_reasons: Option<Vec<String>>,
}

impl Relations {
    /// Reads every id in `asked` against `board`, refusing the first that names nothing the MCP
    /// can see or names the wrong kind of node.
    pub fn read(board: &Board, asked: Asked) -> Result<Self, Answer> {
        Ok(Self {
            add_dependencies: each(&asked.add_dependencies, |id| prerequisite(board, id))?,
            remove_dependencies: each(&asked.remove_dependencies, |id| prerequisite(board, id))?,
            add_tags: each(&asked.add_tags, |id| tag(board, id))?,
            remove_tags: each(&asked.remove_tags, |id| tag(board, id))?,
            block_reasons: asked.block_reasons,
        })
    }

    /// Whether there is nothing to write.
    pub fn is_empty(&self) -> bool {
        self.add_dependencies.is_empty()
            && self.remove_dependencies.is_empty()
            && self.add_tags.is_empty()
            && self.remove_tags.is_empty()
            && self.block_reasons.is_none()
    }

    /// Writes the changes onto the Task `task`, as the app's commands write them. Removals go
    /// first, so one write can swap a prerequisite or a tag for another.
    pub async fn write(
        self,
        db: &mut Db<Transactional>,
        task: &NodeId,
        now: NaiveDateTime,
    ) -> Result<(), AppError> {
        for tag in self.remove_tags {
            write::set_tag(db, "task", task, tag, false, now).await?;
        }
        for tag in self.add_tags {
            write::set_tag(db, "task", task, tag, true, now).await?;
        }
        if let Some(reasons) = self.block_reasons {
            write::set_block_reasons(db, "task", task, &reasons, now).await?;
        }
        for dependency in self.remove_dependencies {
            write::remove_dependency(db, task, dependency, now).await?;
        }
        for dependency in self.add_dependencies {
            write::add_dependency(db, task, dependency, now).await?;
        }
        Ok(())
    }
}

/// `read` over every id, stopping at the first refusal.
fn each<T>(
    ids: &[NodeIdParam],
    read: impl Fn(&NodeIdParam) -> Result<T, Answer>,
) -> Result<Vec<T>, Answer> {
    ids.iter().map(read).collect()
}

/// The prerequisite `id` names: a visible Task, Goal or stored wait.
fn prerequisite(board: &Board, id: &NodeIdParam) -> Result<Dependency, Answer> {
    let node = board.resolve_among(id, &["task", "goal", "expectation"])?;
    match (node.kind.as_str(), &node.node_id) {
        ("task", id) => Ok(Dependency::Task { id: id.clone() }),
        ("goal", id) => Ok(Dependency::Goal { id: id.clone() }),
        ("expectation", NodeId::Stored(row)) => Ok(Dependency::Expectation { id: *row }),
        (kind, _) => Err(result::refused(format!(
            "{} is a derived {kind} ({}); a Task can depend on a wait only when it is stored",
            id.text(),
            node.title
        ))),
    }
}

/// The row of the visible Tag `id` names.
fn tag(board: &Board, id: &NodeIdParam) -> Result<i64, Answer> {
    let node = board.resolve_among(id, &["tag"])?;
    match (node.kind.as_str(), &node.node_id) {
        ("tag", NodeId::Stored(row)) => Ok(*row),
        (kind, _) => Err(result::refused(format!(
            "{} is a {kind} ({}), not a tag",
            id.text(),
            node.title
        ))),
    }
}
