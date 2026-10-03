//! The ancestry chain's pure half: the links a climb reads, how a chain ended, and the searches
//! every ancestry question is answered by ([`AncestryChain::nearest_scoped`] and its siblings).
//!
//! The climb that reads the chain from the database lives in [`crate::tasks::ancestry`], which
//! re-exports these names (ADR 0010).

use std::collections::{HashMap, HashSet};

use crate::flows::model::ChildAttachment;
use crate::tasks::error::TaskError;
use crate::tasks::model::{Commitment, DurationSpec, Goal, OnScopeExit, Task, TimeScope};

/// Which of the three scoped tables a chain link came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(in crate::tasks) enum NodeKind {
    /// A row in `tasks`.
    Task,
    /// A row in `goals`.
    Goal,
    /// A row in `commitments`.
    Commitment,
}

/// A polymorphic node reference, as the `parent_type`/`parent_id` column pair stores it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::tasks) struct NodeRef {
    /// `"task"`, `"goal"`, `"project"`, `"domain"`, …
    pub(in crate::tasks) node_type: String,
    /// The referenced row's id.
    pub(in crate::tasks) node_id: i64,
}

/// One node on the chain, carrying only the six fields any ancestry question asks about.
///
/// Deliberately not a [`Task`](super::model::Task) or a [`Goal`](super::model::Goal): the climb
/// reads a handful of columns per step and no tags at all, where the full row types cost a
/// second query each.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::tasks) struct AncestryLink {
    /// Which table this link came from.
    pub(in crate::tasks) kind: NodeKind,
    /// The link's own id.
    pub(in crate::tasks) id: i64,
    /// Where the climb went next.
    pub(in crate::tasks) parent: NodeRef,
    /// The link's explicit Time Scope, if it has one.
    pub(in crate::tasks) time_scope: Option<TimeScope>,
    /// The link's Plan, if it has one. Always `None` for a goal: goals have no Plan column.
    pub(in crate::tasks) plan: Option<TimeScope>,
    /// The link's on-exit behaviour. Present iff `time_scope` is — except on a Commitment,
    /// which has no such column and always reads as [`OnScopeExit::Keep`]: it stays until its
    /// Verdict Window ends it, and nothing else archives it on the way out.
    pub(in crate::tasks) on_scope_exit: Option<OnScopeExit>,
    /// The link's **Verdict Window**, if it is a Commitment that sets one. Always `None` for a
    /// task or a goal: neither has the column, and neither is ever asked for one — the search
    /// stops at the first Commitment either way.
    pub(in crate::tasks) verdict_window: Option<DurationSpec>,
}

/// Why a climb stopped short of the root.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::tasks) enum BreakCause {
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
pub(in crate::tasks) enum ChainEnd {
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
pub(in crate::tasks) struct AncestryChain {
    /// The links, nearest first.
    pub(in crate::tasks) links: Vec<AncestryLink>,
    /// How the climb ended.
    pub(in crate::tasks) end: ChainEnd,
}

/// What a search over a chain concluded.
///
/// The three-way answer is the point of the type. A search that could only say "found" or "not
/// found" would fold *nothing above this carries it* together with *the chain broke and I cannot
/// tell*, and the two want opposite treatment: see [`Self::or_unconstrained`] and
/// [`Self::or_reject`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::tasks) enum Search<T> {
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
pub(in crate::tasks) fn occurrence_link(attachment: ChildAttachment) -> AncestryLink {
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

impl NodeKind {
    /// Parses a stored `parent_type`, or `None` for anything that is not a scoped node — a
    /// project, a domain, an aspect. Those end the chain rather than breaking it.
    pub(in crate::tasks) fn from_db(value: &str) -> Option<Self> {
        match value {
            "task" => Some(Self::Task),
            "goal" => Some(Self::Goal),
            "commitment" => Some(Self::Commitment),
            _ => None,
        }
    }

    /// How the kind spells itself in a `parent_type` column.
    pub(in crate::tasks) fn as_db(self) -> &'static str {
        match self {
            Self::Task => "task",
            Self::Goal => "goal",
            Self::Commitment => "commitment",
        }
    }
}

impl NodeRef {
    /// A reference to `node_id` in the table `node_type` names.
    pub(in crate::tasks) fn new(node_type: impl Into<String>, node_id: i64) -> Self {
        Self {
            node_type: node_type.into(),
            node_id,
        }
    }
}

impl<T> Search<T> {
    /// The **read** path's policy: an unanswerable question is treated as unconstrained.
    ///
    /// One corrupt row must not blank the whole mindmap, so the renderer keeps going. The
    /// corruption is logged rather than silently swallowed, which is the half the old walks
    /// left out.
    pub(in crate::tasks) fn or_unconstrained(self) -> Option<T> {
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
    pub(in crate::tasks) fn or_reject(self) -> Result<Option<T>, TaskError> {
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
    pub(in crate::tasks) fn exhausted<T>(&self) -> Search<T> {
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
    pub(in crate::tasks) fn nearest_scoped(&self) -> Search<(&TimeScope, OnScopeExit)> {
        for link in &self.links {
            if let Some(time_scope) = &link.time_scope {
                let on_exit = link.on_scope_exit.unwrap_or(OnScopeExit::Keep);
                return Search::Found((time_scope, on_exit));
            }
        }
        self.exhausted()
    }

    /// Whether the nearest link carrying an explicit Time Scope is a **Habit occurrence** an added
    /// child climbed into ([`occurrence_link`]) — whose window it then takes, and archives with.
    ///
    /// Pure. No database, no `async`.
    pub(in crate::tasks) fn nearest_scoped_is_occurrence(&self) -> bool {
        self.links
            .iter()
            .find(|link| link.time_scope.is_some())
            .is_some_and(|link| link.parent.node_type == "flow")
    }

    /// The nearest link carrying an explicit **Verdict Window**.
    ///
    /// **Traverses commitments only: anything else ends the search**, and ends it definitively.
    /// Only a Commitment has the column, and a Commitment's parent chain leaves the kind as soon
    /// as it reaches a task, a goal or a container — so a broken reference above that point is
    /// never consulted, exactly as [`Self::nearest_planned`] ignores one above a goal.
    ///
    /// Pure. No database, no `async`.
    pub(in crate::tasks) fn nearest_verdict_window(&self) -> Search<&DurationSpec> {
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
    pub(in crate::tasks) fn nearest_planned(&self) -> Search<&TimeScope> {
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

/// One climb up the chain, as the sequence of reads it needs.
///
/// The walk's rules live here once — where the chain ends, that a repeat is a cycle, that a
/// missing row breaks it, that an added child of a Habit occurrence climbs into the occurrence —
/// and the two ways of reading a link drive it: [`crate::tasks::ancestry::climb`] reads each link
/// from the database, and [`climb_in`] from an [`AncestryIndex`] of rows already loaded.
pub(in crate::tasks) struct Climb {
    links: Vec<AncestryLink>,
    visited: HashSet<(NodeKind, i64)>,
    next: NodeRef,
}

/// What a climb needs next.
pub(in crate::tasks) enum ClimbStep {
    /// The link of this node, and the occurrence it hangs on, if any.
    Read(NodeKind, i64),
    /// The climb is over.
    Done(AncestryChain),
}

/// What reading one link found.
pub(in crate::tasks) enum LinkRead {
    /// The row, and the occurrence it hangs on when it is an added child of one.
    Found {
        /// The row's link.
        link: AncestryLink,
        /// The occurrence it hangs on.
        occurrence: Option<AncestryLink>,
    },
    /// The referenced row does not exist.
    Missing,
}

impl Climb {
    /// A climb starting at `(start_type, start_id)`, which is itself the first link.
    pub(in crate::tasks) fn new(start_type: &str, start_id: i64) -> Self {
        Self {
            links: Vec::new(),
            visited: HashSet::new(),
            next: NodeRef::new(start_type, start_id),
        }
    }

    /// The next read, or the chain when the climb is over: it ran off the scoped chain, or it came
    /// back to a node it has already read.
    pub(in crate::tasks) fn step(&mut self) -> ClimbStep {
        let Some(kind) = NodeKind::from_db(&self.next.node_type) else {
            return ClimbStep::Done(self.finish(ChainEnd::Root));
        };
        if !self.visited.insert((kind, self.next.node_id)) {
            let end = ChainEnd::Broken {
                kind,
                id: self.next.node_id,
                cause: BreakCause::Cycle,
            };
            return ClimbStep::Done(self.finish(end));
        }
        ClimbStep::Read(kind, self.next.node_id)
    }

    /// Takes in what reading `(kind, id)` — the node [`Self::step`] asked for — found, and returns
    /// the chain when that ends the climb.
    ///
    /// An added child of a Habit occurrence climbs into that occurrence, not into the row its
    /// parent columns name. Those columns hold the occurrence's host — the node the occurrence
    /// itself renders under — because a virtual instance has no id for them to point at, and
    /// following them would check the child against the wrong window and archive it on the wrong
    /// day. Asked per link rather than once at the start, because a child of an added child
    /// reaches the occurrence two steps up.
    pub(in crate::tasks) fn read(
        &mut self,
        kind: NodeKind,
        id: i64,
        read: LinkRead,
    ) -> Option<AncestryChain> {
        match read {
            LinkRead::Missing => Some(self.finish(ChainEnd::Broken {
                kind,
                id,
                cause: BreakCause::Missing,
            })),
            LinkRead::Found {
                link,
                occurrence: Some(occurrence),
            } => {
                self.links.push(link);
                self.links.push(occurrence);
                Some(self.finish(ChainEnd::Root))
            }
            LinkRead::Found {
                link,
                occurrence: None,
            } => {
                self.next = link.parent.clone();
                self.links.push(link);
                None
            }
        }
    }

    fn finish(&mut self, end: ChainEnd) -> AncestryChain {
        AncestryChain {
            links: std::mem::take(&mut self.links),
            end,
        }
    }
}

/// Every scoped row's link, and every added child's occurrence, read once for a whole board, so
/// that each node's chain is climbed in memory rather than by a query per step.
#[derive(Debug, Clone, Default)]
pub(in crate::tasks) struct AncestryIndex {
    links: HashMap<(NodeKind, i64), AncestryLink>,
    occurrences: HashMap<(NodeKind, i64), AncestryLink>,
}

impl AncestryIndex {
    /// Adds a row's link.
    pub(in crate::tasks) fn insert(&mut self, link: AncestryLink) {
        self.links.insert((link.kind, link.id), link);
    }

    /// Records that `(kind, id)` is an added child of the occurrence `attachment` names.
    pub(in crate::tasks) fn attach(
        &mut self,
        kind: NodeKind,
        id: i64,
        attachment: ChildAttachment,
    ) {
        self.occurrences
            .insert((kind, id), occurrence_link(attachment));
    }
}

/// The chain of `(start_type, start_id)`, climbed over `index` — the same climb as
/// [`crate::tasks::ancestry::climb`], reading each link from rows already loaded.
pub(in crate::tasks) fn climb_in(
    index: &AncestryIndex,
    start_type: &str,
    start_id: i64,
) -> AncestryChain {
    let mut climb = Climb::new(start_type, start_id);
    loop {
        let (kind, id) = match climb.step() {
            ClimbStep::Done(chain) => return chain,
            ClimbStep::Read(kind, id) => (kind, id),
        };
        let read = match index.links.get(&(kind, id)) {
            Some(link) => LinkRead::Found {
                link: link.clone(),
                occurrence: index.occurrences.get(&(kind, id)).cloned(),
            },
            None => LinkRead::Missing,
        };
        if let Some(chain) = climb.read(kind, id, read) {
            return chain;
        }
    }
}

impl AncestryIndex {
    /// The index of a board's stored scoped rows — every Task, Goal and Commitment, with the
    /// occurrence each added child hangs on (`attachments`, as `(child_type, child_id,
    /// attachment)`).
    ///
    /// Each link carries exactly what one step of the database climb reads off its row, so a
    /// chain climbed over the index is the chain the database would have given.
    pub(in crate::tasks) fn of(
        tasks: &[Task],
        goals: &[Goal],
        commitments: &[Commitment],
        attachments: Vec<(String, i64, ChildAttachment)>,
    ) -> Self {
        let mut index = Self::default();
        for task in tasks {
            let (Some(id), Some(parent_id)) = (task.id.stored(), task.parent_id.stored()) else {
                continue;
            };
            index.insert(AncestryLink {
                kind: NodeKind::Task,
                id,
                parent: NodeRef::new(task.parent_type.clone(), parent_id),
                time_scope: task.time_scope.clone(),
                plan: task.plan.clone(),
                on_scope_exit: task.on_scope_exit,
                verdict_window: None,
            });
        }
        for goal in goals {
            let (Some(id), Some(parent_id)) = (goal.id.stored(), goal.parent_id.stored()) else {
                continue;
            };
            index.insert(AncestryLink {
                kind: NodeKind::Goal,
                id,
                parent: NodeRef::new(goal.parent_type.clone(), parent_id),
                time_scope: goal.time_scope.clone(),
                plan: None,
                on_scope_exit: goal.on_scope_exit,
                verdict_window: None,
            });
        }
        for commitment in commitments {
            let (Some(id), Some(parent_id)) =
                (commitment.id.stored(), commitment.parent_id.stored())
            else {
                continue;
            };
            index.insert(AncestryLink {
                kind: NodeKind::Commitment,
                id,
                parent: NodeRef::new(commitment.parent_type.clone(), parent_id),
                time_scope: commitment.time_scope.clone(),
                // A Commitment is never scheduled: the window *is* the commitment.
                plan: None,
                // A Commitment has no on-exit column and never Archives on the way out, so a
                // scoped one reads as Keep — what its descendants inherit with its window.
                on_scope_exit: commitment.time_scope.as_ref().map(|_| OnScopeExit::Keep),
                verdict_window: commitment.verdict_window.clone(),
            });
        }
        for (child_type, child_id, attachment) in attachments {
            if let Some(kind) = NodeKind::from_db(&child_type) {
                index.attach(kind, child_id, attachment);
            }
        }
        index
    }
}
