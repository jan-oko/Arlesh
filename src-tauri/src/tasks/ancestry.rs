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
use crate::flows::model::ChildAttachment;

use super::error::TaskError;
use super::model::{CommitmentId, DurationSpec, GoalId, OnScopeExit, TaskId, TimeScope};

/// Which of the three scoped tables a chain link came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(super) enum NodeKind {
    /// A row in `tasks`.
    Task,
    /// A row in `goals`.
    Goal,
    /// A row in `commitments`.
    Commitment,
}

impl NodeKind {
    /// Parses a stored `parent_type`, or `None` for anything that is not a scoped node — a
    /// project, a domain, an aspect. Those end the chain rather than breaking it.
    pub(super) fn from_db(value: &str) -> Option<Self> {
        match value {
            "task" => Some(Self::Task),
            "goal" => Some(Self::Goal),
            "commitment" => Some(Self::Commitment),
            _ => None,
        }
    }

    /// How the kind spells itself in a `parent_type` column.
    pub(super) fn as_db(self) -> &'static str {
        match self {
            Self::Task => "task",
            Self::Goal => "goal",
            Self::Commitment => "commitment",
        }
    }
}

/// A polymorphic node reference, as the `parent_type`/`parent_id` column pair stores it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct NodeRef {
    /// `"task"`, `"goal"`, `"project"`, `"domain"`, …
    pub(super) node_type: String,
    /// The referenced row's id.
    pub(super) node_id: i64,
}

impl NodeRef {
    /// A reference to `node_id` in the table `node_type` names.
    pub(super) fn new(node_type: impl Into<String>, node_id: i64) -> Self {
        Self {
            node_type: node_type.into(),
            node_id,
        }
    }
}

/// One node on the chain, carrying only the six fields any ancestry question asks about.
///
/// Deliberately not a [`Task`](super::model::Task) or a [`Goal`](super::model::Goal): the climb
/// reads a handful of columns per step and no tags at all, where the full row types cost a
/// second query each.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct AncestryLink {
    /// Which table this link came from.
    pub(super) kind: NodeKind,
    /// The link's own id.
    pub(super) id: i64,
    /// Where the climb went next.
    pub(super) parent: NodeRef,
    /// The link's explicit Time Scope, if it has one.
    pub(super) time_scope: Option<TimeScope>,
    /// The link's Plan, if it has one. Always `None` for a goal: goals have no Plan column.
    pub(super) plan: Option<TimeScope>,
    /// The link's on-exit behaviour. Present iff `time_scope` is — except on a Commitment,
    /// which has no such column and always reads as [`OnScopeExit::Keep`]: it stays until its
    /// Verdict Window ends it, and nothing else archives it on the way out.
    pub(super) on_scope_exit: Option<OnScopeExit>,
    /// The link's **Verdict Window**, if it is a Commitment that sets one. Always `None` for a
    /// task or a goal: neither has the column, and neither is ever asked for one — the search
    /// stops at the first Commitment either way.
    pub(super) verdict_window: Option<DurationSpec>,
}

/// Why a climb stopped short of the root.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum BreakCause {
    /// The parent reference pointed at a row that does not exist.
    Missing,
    /// Following the parent links returned to a node already on the chain.
    Cycle,
}

/// Where a climb stopped, and why.
///
/// A break is always on a **scoped** reference: anything else — a project, a domain, an aspect —
/// ends the chain at the root instead. So the broken reference is a [`NodeKind`] and an id rather
/// than a free-form [`NodeRef`], which is what makes the write path's error mapping total.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ChainEnd {
    /// The climb ran off the top of the scoped chain into something that carries no scope — a
    /// project, a domain, an aspect. Every link above the start was read.
    Root,
    /// The climb could not continue.
    Broken {
        /// Which table the reference it stopped on pointed into.
        kind: NodeKind,
        /// The id it pointed at.
        id: i64,
        /// What was wrong with it.
        cause: BreakCause,
    },
}

/// A node's ancestry: the links from the starting node upwards, and how the walk ended.
///
/// **The starting node is the first link.** A caller asking about ancestors only starts the climb
/// at the parent reference rather than skipping a link afterwards, which is what the three
/// ancestor searches in `scope_rules` do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct AncestryChain {
    /// The links, nearest first.
    pub(super) links: Vec<AncestryLink>,
    /// How the climb ended.
    pub(super) end: ChainEnd,
}

/// What a search over a chain concluded.
///
/// The three-way answer is the point of the type. A search that could only say "found" or "not
/// found" would fold *nothing above this carries it* together with *the chain broke and I cannot
/// tell*, and the two want opposite treatment: see [`Self::or_unconstrained`] and
/// [`Self::or_reject`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Search<T> {
    /// A link carries what was asked for.
    Found(T),
    /// Nothing carries it, and the search ended legitimately — the climb reached the root, or
    /// the search's own stop condition fired before any broken reference mattered.
    Unconstrained,
    /// The chain broke before the question could be answered.
    Undetermined {
        /// Which table the reference the climb stopped on pointed into.
        kind: NodeKind,
        /// The id it pointed at.
        id: i64,
        /// What was wrong with it.
        cause: BreakCause,
    },
}

impl<T> Search<T> {
    /// The **read** path's policy: an unanswerable question is treated as unconstrained.
    ///
    /// One corrupt row must not blank the whole mindmap, so the renderer keeps going. The
    /// corruption is logged rather than silently swallowed, which is the half the old walks
    /// left out.
    pub(super) fn or_unconstrained(self) -> Option<T> {
        match self {
            Self::Found(value) => Some(value),
            Self::Unconstrained => None,
            Self::Undetermined { kind, id, cause } => {
                tracing::warn!(
                    node_kind = ?kind,
                    node_id = id,
                    cause = ?cause,
                    "ancestor chain is broken; treating the item as unconstrained"
                );
                None
            }
        }
    }

    /// The **write** path's policy: an unanswerable question rejects the write.
    ///
    /// The invariant the caller wanted checked could not be checked, and writing anyway is what
    /// let corrupt trees grow.
    pub(super) fn or_reject(self) -> Result<Option<T>, TaskError> {
        match self {
            Self::Found(value) => Ok(Some(value)),
            Self::Unconstrained => Ok(None),
            Self::Undetermined { kind, id, cause } => Err(match cause {
                // A dangling reference keeps the not-found error the old walks propagated, so
                // nothing on the wire changes for the case that already happened.
                BreakCause::Missing => match kind {
                    NodeKind::Task => TaskError::TaskNotFound(id),
                    NodeKind::Goal => TaskError::GoalNotFound(id),
                    NodeKind::Commitment => TaskError::CommitmentNotFound(id),
                },
                // A cycle has no precedent: the old walks hung instead of returning.
                BreakCause::Cycle => TaskError::AncestorCycle { node_id: id },
            }),
        }
    }
}

impl AncestryChain {
    /// The answer a search gives when it scanned every link without finding what it wanted.
    fn exhausted<T>(&self) -> Search<T> {
        match self.end {
            ChainEnd::Root => Search::Unconstrained,
            ChainEnd::Broken { kind, id, cause } => Search::Undetermined { kind, id, cause },
        }
    }

    /// The nearest link carrying an explicit Time Scope, with the on-exit behaviour that comes
    /// with it — defaulted to [`OnScopeExit::Keep`], matching the column's write-side default.
    ///
    /// **Climbs through goals:** a goal's Time Scope governs everything beneath it, tasks
    /// included, so a goal on the chain is examined like any other link.
    ///
    /// Pure. No database, no `async`.
    pub(super) fn nearest_scoped(&self) -> Search<(&TimeScope, OnScopeExit)> {
        for link in &self.links {
            if let Some(time_scope) = &link.time_scope {
                let on_exit = link.on_scope_exit.unwrap_or(OnScopeExit::Keep);
                return Search::Found((time_scope, on_exit));
            }
        }
        self.exhausted()
    }

    /// The nearest link carrying an explicit **Verdict Window**.
    ///
    /// **Traverses commitments only: anything else ends the search**, and ends it definitively.
    /// Only a Commitment has the column, and a Commitment's parent chain leaves the kind as soon
    /// as it reaches a task, a goal or a container — so a broken reference above that point is
    /// never consulted, exactly as [`Self::nearest_planned`] ignores one above a goal.
    ///
    /// Pure. No database, no `async`.
    pub(super) fn nearest_verdict_window(&self) -> Search<&DurationSpec> {
        for link in &self.links {
            if link.kind != NodeKind::Commitment {
                return Search::Unconstrained;
            }
            if let Some(window) = &link.verdict_window {
                return Search::Found(window);
            }
        }
        match self.end {
            ChainEnd::Broken {
                kind: NodeKind::Commitment,
                ..
            } => self.exhausted(),
            ChainEnd::Broken { .. } | ChainEnd::Root => Search::Unconstrained,
        }
    }

    /// The nearest link carrying a Plan.
    ///
    /// **Traverses tasks only: a goal ends the search**, and ends it *definitively*. Plans nest
    /// within plans, and only tasks have one, so a goal is where the plan chain stops — whatever
    /// lies above it, a broken reference included, is never consulted. That is why a chain that
    /// broke on a **goal** still answers [`Search::Unconstrained`] here while
    /// [`Self::nearest_scoped`] answers [`Search::Undetermined`] for the same chain: the scope
    /// walk needed that goal and the plan walk did not.
    ///
    /// Pure. No database, no `async`.
    pub(super) fn nearest_planned(&self) -> Search<&TimeScope> {
        for link in &self.links {
            if link.kind != NodeKind::Task {
                return Search::Unconstrained;
            }
            if let Some(plan) = &link.plan {
                return Search::Found(plan);
            }
        }
        match self.end {
            ChainEnd::Broken {
                kind: NodeKind::Task,
                ..
            } => self.exhausted(),
            ChainEnd::Broken { .. } | ChainEnd::Root => Search::Unconstrained,
        }
    }
}

/// One virtual Habit occurrence, as the chain link an added child of it climbs into.
///
/// A virtual instance has no row, so it can never *be* read as a link — it is built from the
/// attachment instead. Three fields carry its meaning and the rest are structurally absent:
///
/// - `time_scope` is the occurrence's window, which is what the child's own Time Scope must sit
///   within and what governs the child when it has none of its own;
/// - `on_scope_exit` is [`OnScopeExit::Archive`], which is how an added child archives *with* its
///   occurrence when the window passes, rather than lingering after the thing it was written on;
/// - `plan` is `None`: an occurrence's Cycle Plan is resolved per iteration by the renderer, and a
///   second resolution here could disagree with it. Plan ⊆ own Time Scope ⊆ occurrence window
///   still holds through the other two rules.
///
/// Its `parent` is the flow, which is not a scoped kind, so the chain ends here — an occurrence
/// has nothing above it that a child could inherit.
pub(super) fn occurrence_link(attachment: ChildAttachment) -> AncestryLink {
    let kind = match attachment.instance_type.as_str() {
        "goal" => NodeKind::Goal,
        "commitment" => NodeKind::Commitment,
        // Every other Instance Type materialises as a Task, which is also what an unrecognised
        // one falls back to everywhere else in the renderer.
        _ => NodeKind::Task,
    };
    AncestryLink {
        kind,
        id: attachment.flow_id,
        parent: NodeRef::new("flow", attachment.flow_id),
        time_scope: attachment.window,
        plan: None,
        on_scope_exit: Some(OnScopeExit::Archive),
        verdict_window: None,
    }
}

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
