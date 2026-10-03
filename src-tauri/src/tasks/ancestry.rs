//! The ancestry chain: one impure climb, and pure searches over what it returns.
//!
//! Tasks and Goals form a contiguous chain of polymorphic parent links that ends when it reaches
//! something that carries no scope — a project, a domain, an aspect. Four separate questions used
//! to be asked by four separate walks up that chain. There is one walk now: [`climb`] reads the
//! chain into memory once, and every question is a pure search over the value it returns.
//!
//! The split matters because the two halves have different hazards. The climb touches the
//! database, so it can fail, and on a corrupt tree it can fail in two ways — a parent reference
//! pointing at a row that is gone, or a parent chain that loops back on itself. A search cannot
//! fail at all; it is a scan over a `Vec`, and its tests need no fixtures.
//!
//! It also lets the chain say *how* it ended, which the old walks could not. A walk that returned
//! "nothing found" conflated *nothing above this is scoped* with *the chain broke and I cannot
//! tell*, and that conflation is what let the write path skip validation on a corrupt tree. Here
//! the two are [`Search::Unconstrained`] and [`Search::Undetermined`], and each caller applies
//! its own policy to the second — see [`Search::or_unconstrained`] and [`Search::or_reject`].

use std::collections::HashSet;

use crate::database::session::{Db, SessionMode};

use super::error::TaskError;
use super::model::{CommitmentId, GoalId, TaskId};

pub(super) use super::rules::ancestry::*;

/// The occurrence a node hangs on, as a chain link, when the node is an added child of one.
///
/// Read through the flow operator rather than by a query written here, so the attachment's shape
/// stays in the module that owns the table.
pub(super) async fn occurrence_of<M: SessionMode>(
    db: &mut Db<M>,
    kind: NodeKind,
    id: i64,
) -> Result<Option<AncestryLink>, TaskError> {
    let attachment = db.flows().child_attachment(kind.as_db(), id).await?;
    Ok(attachment.map(occurrence_link))
}

/// Reads the ancestry of `(start_type, start_id)` into memory, nearest link first.
///
/// Reaches two resources, so it is a free function over the session rather than a method on
/// either operator — see [`Db`]'s `# Where an operation lives`. Read-only, so it is generic over
/// the session mode and serves a pooled read command and a transactional writer alike.
///
/// A start that is not a scoped node — `("project", 7)` — yields an empty chain that reached the
/// root, which is the correct answer to every question: nothing above it is scoped.
///
/// Never loops. A corrupt tree whose parent links cycle is reachable today (nothing on the write
/// side forbids reparenting a node under its own descendant), so the climb remembers what it has
/// seen and reports a repeat as a broken chain rather than spinning.
#[tracing::instrument(skip(db))]
pub(super) async fn climb<M: SessionMode>(
    db: &mut Db<M>,
    start_type: &str,
    start_id: i64,
) -> Result<AncestryChain, TaskError> {
    let mut links = Vec::new();
    let mut visited: HashSet<(NodeKind, i64)> = HashSet::new();
    let mut next = NodeRef::new(start_type, start_id);
    loop {
        let Some(kind) = NodeKind::from_db(&next.node_type) else {
            return Ok(AncestryChain {
                links,
                end: ChainEnd::Root,
            });
        };
        if !visited.insert((kind, next.node_id)) {
            let end = ChainEnd::Broken {
                kind,
                id: next.node_id,
                cause: BreakCause::Cycle,
            };
            return Ok(AncestryChain { links, end });
        }
        let read = match kind {
            NodeKind::Task => db.tasks().ancestry_link(TaskId(next.node_id)).await,
            NodeKind::Goal => db.goals().ancestry_link(GoalId(next.node_id)).await,
            NodeKind::Commitment => {
                db.commitments()
                    .ancestry_link(CommitmentId(next.node_id))
                    .await
            }
        };
        let link = match read {
            Ok(link) => link,
            // A dangling reference — the referenced row was deleted — breaks the chain. Every
            // other database failure is a real failure and propagates.
            Err(
                TaskError::TaskNotFound(_)
                | TaskError::GoalNotFound(_)
                | TaskError::CommitmentNotFound(_),
            ) => {
                let end = ChainEnd::Broken {
                    kind,
                    id: next.node_id,
                    cause: BreakCause::Missing,
                };
                return Ok(AncestryChain { links, end });
            }
            Err(error) => return Err(error),
        };
        // An added child of a Habit occurrence climbs into that occurrence, not into the row its
        // parent columns name. Those columns hold the occurrence's host — the node the occurrence
        // itself renders under — because a virtual instance has no id for them to point at, and
        // following them would check the child against the wrong window and archive it on the
        // wrong day. Asked per link rather than once at the start, because a child of an added
        // child reaches the occurrence two steps up.
        if let Some(occurrence) = occurrence_of(db, kind, next.node_id).await? {
            links.push(link);
            links.push(occurrence);
            return Ok(AncestryChain {
                links,
                end: ChainEnd::Root,
            });
        }
        next = link.parent.clone();
        links.push(link);
    }
}

#[cfg(test)]
mod tests;
