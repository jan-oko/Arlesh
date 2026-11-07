//! **Compound**: a Task that *consists of its sub-items*, its status derived from its subtree.
//!
//! A compound Task's status is never set by hand. It is read off everything beneath it — Tasks
//! (Habit occurrences and a wait's check tasks included), Goals, waits and Commitments — by the
//! [`progress`] rule, on **every board load**. It is never stored: a descendant changing, a Habit
//! deriving a new occurrence or a window passing all change it without a write, and a stored copy
//! would go stale on exactly those. So the derivation lives here, on the backend, where the board
//! load runs it before anything reads the board: the frontend, the filters, the MCP snapshot and
//! lookups all see the derived status as the Task's `status`, and none of them knows the
//! difference (see `docs/spec/resources.md`, "Compound").
//!
//! # What counts
//!
//! The whole subtree, except what is **effectively Archived** (with everything beneath it) and
//! Infos, which are not work. Backlogged and delegated items still count. An item archived *by
//! finishing* — a Done Task whose window has passed, which Resolution archives — still reads as
//! Done and still counts: left out, a compound Task whose steps were all done inside its window
//! would fall back to To Do the moment the window closed, and then lapse unfinished. How each
//! kind reads:
//!
//! - a Task: its status — for a compound Task inside, its **derived** status;
//! - a Goal: Achieved reads as Done, anything else as To Do;
//! - a wait: Pending reads as Started, Released as Done;
//! - a Commitment: Unresolved reads as Started, a verdict (Kept or Broken) as Done.
//!
//! One exception, forced rather than chosen: the waits a compound Task **itself** draws — its
//! delegation wait, which exists exactly while it is not done — are consequences of its status,
//! not constituents of it, so the Task does not count them (an ancestor still does). Counting them
//! would leave a delegated compound Task unable ever to be Done. (A compound Task spawns no
//! Asynchronous wait at all: see [`crate::nodes::waits::derive_waits`].)
//!
//! # Order
//!
//! A compound Task's own lifecycle depends on its derived status — Done resolves its window, and
//! a Done Task whose window has passed is Archived — and an Archived item drops out of every
//! ancestor's count. So a compound Task is resolved before any compound ancestor reads it
//! ([`derive`] resolves on demand, innermost first), and its lifecycle is re-derived as it is.
//!
//! A **compound Habit occurrence** is derived by this same rule, but by its Habit rather than by
//! the board: whether its iteration has resolved depends on its status, so the Habit pass works it
//! out first (`flows::compound_readings`), over its subtree as it stands before the iteration is
//! classified, by calling [`settle`](crate::tasks::compound::settle) itself. The board then serves that status as it is
//! ([`Rows::settled`]) rather than deriving it a second time.
//!
//! A delegated compound Task's delegation wait is drawn from its status, so the waits are drawn
//! again whenever a derived status changes which of those exist ([`settle`](crate::tasks::compound::settle)). Each round settles
//! at least one more level of nesting, so it ends.

use std::collections::{HashMap, HashSet};

use chrono::NaiveDateTime;

use crate::{
    error::AppError,
    nodes::{
        id::NodeId,
        origin::Origin,
        rules::waits::{derive_waits_in, WaitBoardSources},
        waits::WaitRows,
    },
    scopes::resolve::Bounds,
};

use crate::tasks::{
    expectations::EXPECTATION,
    lifecycle::{derive_item_state, effective_due, Archival, DerivedState, ItemLifecycle},
    model::{
        Commitment, Expectation, ExpectationArchival, ExpectationStatus, Goal, GoalStatus,
        OnScopeExit, Status, Task, TaskArchival, TaskStatus, TimeScope, Verdict,
    },
    rules::{
        ancestry::{climb_in, AncestryIndex},
        scope::{governance, OccurrenceExit},
    },
};

pub mod blocked;

/// The most rounds [`settle`] takes. Each round settles at least one more level of compound
/// Tasks nested inside each other, so only a board nested deeper than this could reach it.
const MAX_ROUNDS: usize = 16;

/// Draws the board's waits and derives every compound Task's status, until the two agree — what
/// [`settle`](crate::tasks::compound::settle) reads the sources for.
///
/// A board with no compound Task draws its waits once and derives nothing more.
pub fn settle_in(
    waits_sources: &WaitBoardSources<'_>,
    ancestry: &AncestryIndex,
    now: NaiveDateTime,
    board: Board<'_>,
) -> Result<Settled, AppError> {
    let Board {
        tasks,
        goals,
        commitments,
        expectations,
        lifecycles,
        settled,
        instants,
        exit,
    } = board;
    let mut waits = derive_waits_in(waits_sources, now, &*tasks, expectations)?;
    if !tasks.iter().any(|task| task.compound) {
        return Ok(Settled {
            waits,
            outcomes: Vec::new(),
        });
    }
    let governance = governance_of(ancestry, &*tasks, exit);
    let mut drawn_for = delegated_done(&*tasks);
    let mut outcomes = Vec::new();
    for _ in 0..MAX_ROUNDS {
        outcomes = derive(
            &Rows {
                tasks: &*tasks,
                checks: &waits.tasks,
                goals,
                commitments,
                expectations,
                waits: &waits.expectations,
                lifecycles: &*lifecycles,
                wait_lifecycles: &waits.lifecycles,
                settled,
                instants,
            },
            &governance,
            now,
        );
        apply(&outcomes, &mut *tasks, &mut *lifecycles);
        let delegated = delegated_done(&*tasks);
        if delegated == drawn_for {
            return Ok(Settled { waits, outcomes });
        }
        drawn_for = delegated;
        waits = derive_waits_in(waits_sources, now, &*tasks, expectations)?;
    }
    tracing::warn!(
        rounds = MAX_ROUNDS,
        "compound tasks did not settle; serving the last round"
    );
    Ok(Settled { waits, outcomes })
}

/// Each compound stored Task's [`Governance`].
fn governance_of(
    ancestry: &AncestryIndex,
    tasks: &[Task],
    exit: OccurrenceExit,
) -> HashMap<NodeId, Governance> {
    let mut out = HashMap::new();
    for task in tasks.iter().filter(|task| task.compound) {
        let Some(row) = task.id.stored() else {
            continue;
        };
        let governed = governance(&climb_in(ancestry, "task", row), exit);
        let (window, on_exit) = governed.unzip();
        let due = effective_due(
            task.due_scope.as_ref().map(TimeScope::window),
            governed,
            task.archival == TaskArchival::Backlog,
        );
        out.insert(
            task.id.clone(),
            Governance {
                window,
                on_exit,
                due,
                stored: Archival::from(task.archival),
            },
        );
    }
    out
}

#[cfg(test)]
mod tests;

/// The **progress rule**: what a compound Task reads as, given what each counted item reads as.
///
/// Done when every item is Done. Otherwise In Progress if any item is In Progress. Otherwise
/// Started if any item is Started or Done. Otherwise To Do — and To Do when nothing is counted.
pub fn progress(states: impl IntoIterator<Item = TaskStatus>) -> TaskStatus {
    let mut tally = Tally::default();
    for state in states {
        tally.count(state);
    }
    tally.status()
}

/// A running [`progress`] count.
#[derive(Debug, Clone, Copy)]
struct Tally {
    counted: bool,
    all_done: bool,
    in_progress: bool,
    begun: bool,
    /// The latest finish among the Done items counted, where known.
    latest: Option<NaiveDateTime>,
}

impl Default for Tally {
    fn default() -> Self {
        Self {
            counted: false,
            all_done: true,
            in_progress: false,
            begun: false,
            latest: None,
        }
    }
}

impl Tally {
    fn count(&mut self, state: TaskStatus) {
        self.counted = true;
        self.all_done &= state == TaskStatus::Done;
        self.in_progress |= state == TaskStatus::InProgress;
        self.begun |= matches!(state, TaskStatus::Started | TaskStatus::Done);
    }

    fn status(self) -> TaskStatus {
        if !self.counted {
            return TaskStatus::Todo;
        }
        if self.all_done {
            return TaskStatus::Done;
        }
        if self.in_progress {
            return TaskStatus::InProgress;
        }
        if self.begun {
            return TaskStatus::Started;
        }
        TaskStatus::Todo
    }
}

/// How a Task counts: its status, read in the ordinary model's terms whichever model it holds —
/// an Agentic Doing counts as In Progress, On Agent and Review as Started (see
/// [`Status::reading`]).
pub fn task_reading(status: Status) -> TaskStatus {
    status.reading()
}

/// How a Goal counts: Achieved is Done, anything else To Do.
pub fn goal_reading(status: &str) -> TaskStatus {
    match GoalStatus::from_db(status) {
        Some(GoalStatus::Achieved) => TaskStatus::Done,
        _ => TaskStatus::Todo,
    }
}

/// How a wait counts: Pending is Started — something is under way, somewhere else — and
/// Released is Done.
pub fn expectation_reading(status: ExpectationStatus) -> TaskStatus {
    match status {
        ExpectationStatus::Pending => TaskStatus::Started,
        ExpectationStatus::Released => TaskStatus::Done,
    }
}

/// How a Commitment counts: Unresolved is Started — it is being held — and a verdict, Kept or
/// Broken, is Done.
pub fn commitment_reading(verdict: Verdict) -> TaskStatus {
    match verdict {
        Verdict::Unresolved => TaskStatus::Started,
        Verdict::Kept | Verdict::Broken => TaskStatus::Done,
    }
}

/// What a compound Task's own lifecycle is re-derived from, besides its derived status: its
/// effective window and on-exit behaviour, and its own stored Archival (its Backlog).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Governance {
    /// Its effective window, or `None` when nothing above it is scoped.
    pub window: Option<Bounds>,
    /// Its effective on-exit behaviour, present with the window.
    pub on_exit: Option<OnScopeExit>,
    /// Its effective due — see [`effective_due`] — which decides whether it is Overdue.
    pub due: Option<Bounds>,
    /// Its own stored Archival.
    pub stored: Archival,
}

/// The rows a derivation reads — each kind's virtual table, split where the load holds it in two.
pub struct Rows<'rows> {
    /// Tasks: stored rows and Habit occurrences.
    pub tasks: &'rows [Task],
    /// A wait's check tasks.
    pub checks: &'rows [Task],
    /// Goals, stored and derived.
    pub goals: &'rows [Goal],
    /// Commitments, stored and derived.
    pub commitments: &'rows [Commitment],
    /// Stored Expectations.
    pub expectations: &'rows [Expectation],
    /// Derived waits: spawned and delegation waits.
    pub waits: &'rows [Expectation],
    /// Every lifecycle the load derived, wait lifecycles included.
    pub lifecycles: &'rows [ItemLifecycle],
    /// The waits' own lifecycles, when the load holds them apart.
    pub wait_lifecycles: &'rows [ItemLifecycle],
    /// Compound Tasks whose status is already derived — a Habit's compound occurrences, which
    /// their Habit derives — read as they are served rather than derived again.
    pub settled: &'rows HashSet<NodeId>,
    /// When each finished item was finished, where that is known: what a compound Task's own
    /// done time is the latest of.
    pub instants: &'rows HashMap<NodeId, NaiveDateTime>,
}

/// One compound Task's derived status, and its lifecycle re-derived from it.
#[derive(Debug, Clone, PartialEq)]
pub struct Outcome {
    /// The Task.
    pub id: NodeId,
    /// Its derived status.
    pub status: TaskStatus,
    /// Its lifecycle as that status leaves it — `None` when no [`Governance`] was given for it,
    /// in which case its lifecycle is left as the load derived it.
    pub state: Option<DerivedState>,
    /// When it became Done — the latest finish among what it counts that has one — while it reads
    /// as Done. `None` while it does not, or when nothing it counts has a known finish.
    pub done_at: Option<NaiveDateTime>,
}

/// Derives every compound Task's status in `rows` at `now`.
pub fn derive(
    rows: &Rows<'_>,
    governance: &HashMap<NodeId, Governance>,
    now: NaiveDateTime,
) -> Vec<Outcome> {
    let tree = Tree::of(rows);
    let mut evaluation = Evaluation {
        tree: &tree,
        governance,
        now,
        resolved: HashMap::new(),
        visiting: HashSet::new(),
    };
    rows.tasks
        .iter()
        .filter(|task| task.compound && !rows.settled.contains(&task.id))
        .map(|task| {
            let resolved = evaluation.resolve(&task.id);
            Outcome {
                id: task.id.clone(),
                status: resolved.status,
                state: resolved.state,
                done_at: resolved.done_at,
            }
        })
        .collect()
}

/// Writes `outcomes` onto the board: each compound Task's `status`, and its lifecycle.
pub fn apply(outcomes: &[Outcome], tasks: &mut [Task], lifecycles: &mut [ItemLifecycle]) {
    let by_id: HashMap<&NodeId, &Outcome> = outcomes.iter().map(|out| (&out.id, out)).collect();
    for task in tasks.iter_mut().filter(|task| task.compound) {
        if let Some(outcome) = by_id.get(&task.id) {
            // Put back into the model the compound Task itself holds.
            task.status = Status::from_reading(outcome.status, task.status.is_agentic());
        }
    }
    for entry in lifecycles
        .iter_mut()
        .filter(|entry| entry.node_type == "task")
    {
        let Some(state) = by_id.get(&entry.node_id).and_then(|outcome| outcome.state) else {
            continue;
        };
        entry.timing = state.timing;
        entry.resolution = state.resolution;
        entry.overdue = state.overdue;
        entry.archival = state.archival;
        entry.archival_conflict = state.archival_conflict;
    }
}

/// The board a load has read so far, which [`settle`](crate::tasks::compound::settle) completes with its waits.
pub struct Board<'rows> {
    /// Tasks: stored rows and Habit occurrences. Compound ones leave with their derived status.
    pub tasks: &'rows mut [Task],
    /// Goals, stored and derived.
    pub goals: &'rows [Goal],
    /// Commitments, stored and derived.
    pub commitments: &'rows [Commitment],
    /// Stored Expectations.
    pub expectations: &'rows [Expectation],
    /// Every lifecycle derived so far. Compound Tasks' leave re-derived.
    pub lifecycles: &'rows mut [ItemLifecycle],
    /// Compound Tasks whose status is already derived — see [`Rows::settled`].
    pub settled: &'rows HashSet<NodeId>,
    /// When each finished item was finished — see [`Rows::instants`].
    pub instants: &'rows HashMap<NodeId, NaiveDateTime>,
    /// Whether a Habit occurrence's window governs a compound Task hung on it — see
    /// [`OccurrenceExit`].
    pub exit: OccurrenceExit,
}

/// What [`settle`](crate::tasks::compound::settle) leaves: the board's waits, and every compound Task it derived.
pub struct Settled {
    /// The waits' rows.
    pub waits: WaitRows,
    /// Each compound Task's outcome, in the last round.
    pub outcomes: Vec<Outcome>,
}

/// Whether each delegated compound Task reads as done — what decides whether its delegation
/// wait is drawn.
fn delegated_done(tasks: &[Task]) -> HashMap<NodeId, bool> {
    tasks
        .iter()
        .filter(|task| task.compound && task.delegate_to.is_some())
        .map(|task| (task.id.clone(), task.status.is_done()))
        .collect()
}

/// The content kinds a subtree is made of.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Kind {
    Task,
    Goal,
    Commitment,
    Expectation,
}

impl Kind {
    /// The kind a row's `parent_type` names, when it is one a counted item can hang under.
    fn of_parent(parent_type: &str) -> Option<Self> {
        match parent_type {
            "task" => Some(Self::Task),
            "goal" => Some(Self::Goal),
            "commitment" => Some(Self::Commitment),
            EXPECTATION => Some(Self::Expectation),
            _ => None,
        }
    }

    /// The `node_type` its lifecycle is keyed under.
    fn lifecycle_type(self) -> &'static str {
        match self {
            Self::Task => "task",
            Self::Goal => "goal",
            Self::Commitment => "commitment",
            Self::Expectation => EXPECTATION,
        }
    }
}

/// A node of the tree: its kind and id.
type Key = (Kind, NodeId);

/// One counted item, as it reads before any compound is derived.
#[derive(Debug, Clone)]
struct Item {
    reading: TaskStatus,
    archived: bool,
    compound: bool,
    /// The Task whose own status draws this wait, for a spawned or delegation wait.
    drawn_by: Option<NodeId>,
    /// A compound Task whose status is already derived ([`Rows::settled`]), read as served.
    settled: bool,
    /// When it was finished, where that is known.
    done_at: Option<NaiveDateTime>,
}

/// The board's content nodes, linked parent to children.
struct Tree {
    items: HashMap<Key, Item>,
    children: HashMap<Key, Vec<Key>>,
}

impl Tree {
    fn of(rows: &Rows<'_>) -> Self {
        let archived: HashSet<(&str, &NodeId)> = rows
            .lifecycles
            .iter()
            .chain(rows.wait_lifecycles)
            .filter(|entry| entry.archival == Archival::Archived)
            .map(|entry| (entry.node_type.as_str(), &entry.node_id))
            .collect();
        let is_archived = |kind: Kind, id: &NodeId| archived.contains(&(kind.lifecycle_type(), id));
        let done_at = |id: &NodeId| rows.instants.get(id).copied();
        let mut tree = Self {
            items: HashMap::new(),
            children: HashMap::new(),
        };
        for task in rows.tasks.iter().chain(rows.checks) {
            tree.insert(
                (Kind::Task, task.id.clone()),
                (task.parent_type.as_str(), &task.parent_id),
                Item {
                    reading: task_reading(task.status),
                    archived: is_archived(Kind::Task, &task.id),
                    compound: task.compound,
                    drawn_by: None,
                    settled: rows.settled.contains(&task.id),
                    done_at: done_at(&task.id),
                },
            );
        }
        for goal in rows.goals {
            tree.insert(
                (Kind::Goal, goal.id.clone()),
                (goal.parent_type.as_str(), &goal.parent_id),
                Item {
                    reading: goal_reading(&goal.status),
                    archived: is_archived(Kind::Goal, &goal.id),
                    compound: false,
                    drawn_by: None,
                    settled: false,
                    done_at: done_at(&goal.id),
                },
            );
        }
        for commitment in rows.commitments {
            tree.insert(
                (Kind::Commitment, commitment.id.clone()),
                (commitment.parent_type.as_str(), &commitment.parent_id),
                Item {
                    reading: commitment_reading(commitment.verdict),
                    archived: is_archived(Kind::Commitment, &commitment.id),
                    compound: false,
                    drawn_by: None,
                    settled: false,
                    done_at: done_at(&commitment.id),
                },
            );
        }
        for wait in rows.expectations.iter().chain(rows.waits) {
            let drawn_by = match &wait.origin {
                Origin::SpawnedWait(origin) | Origin::DelegationWait(origin) => {
                    Some(origin.task_id.clone())
                }
                _ => None,
            };
            tree.insert(
                (Kind::Expectation, wait.id.clone()),
                (wait.parent_type.as_str(), &wait.parent_id),
                Item {
                    reading: expectation_reading(wait.status),
                    archived: wait.archival == ExpectationArchival::Archived
                        || is_archived(Kind::Expectation, &wait.id),
                    compound: false,
                    drawn_by,
                    settled: false,
                    done_at: done_at(&wait.id),
                },
            );
        }
        tree
    }

    fn insert(&mut self, key: Key, (parent_type, parent_id): (&str, &NodeId), item: Item) {
        if let Some(kind) = Kind::of_parent(parent_type) {
            self.children
                .entry((kind, parent_id.clone()))
                .or_default()
                .push(key.clone());
        }
        self.items.insert(key, item);
    }
}

/// A compound Task, resolved.
#[derive(Debug, Clone)]
struct Resolved {
    status: TaskStatus,
    state: Option<DerivedState>,
    archived: bool,
    done_at: Option<NaiveDateTime>,
}

/// One derivation over a [`Tree`], remembering each compound Task once it is resolved.
struct Evaluation<'tree> {
    tree: &'tree Tree,
    governance: &'tree HashMap<NodeId, Governance>,
    now: NaiveDateTime,
    resolved: HashMap<NodeId, Resolved>,
    /// The compound Tasks being resolved right now, so a corrupt parent loop is caught rather
    /// than followed forever.
    visiting: HashSet<NodeId>,
}

impl Evaluation<'_> {
    /// A compound Task's derived status, and the lifecycle it leaves it with.
    fn resolve(&mut self, id: &NodeId) -> Resolved {
        if let Some(resolved) = self.resolved.get(id) {
            return resolved.clone();
        }
        let own_archived = self
            .tree
            .items
            .get(&(Kind::Task, id.clone()))
            .is_some_and(|item| item.archived);
        if !self.visiting.insert(id.clone()) {
            tracing::warn!(task = %id, "a compound task's subtree loops back on itself");
            return Resolved {
                status: TaskStatus::Todo,
                state: None,
                archived: own_archived,
                done_at: None,
            };
        }
        let mut tally = Tally::default();
        let top = (Kind::Task, id.clone());
        let mut walked = HashSet::from([top.clone()]);
        self.count_beneath(&top, id, &mut tally, &mut walked);
        let status = tally.status();
        let done = status == TaskStatus::Done;
        let state = self.governance.get(id).map(|governance| {
            derive_item_state(
                governance.window,
                governance.on_exit,
                governance.due,
                done,
                Some(governance.stored),
                self.now,
            )
        });
        let resolved = Resolved {
            status,
            state,
            archived: state.map_or(own_archived, |state| state.archival == Archival::Archived),
            done_at: tally.latest.filter(|_| done),
        };
        self.visiting.remove(id);
        self.resolved.insert(id.clone(), resolved.clone());
        resolved
    }

    /// Counts everything beneath `parent` into `tally`, for the compound Task `root`.
    /// `walked` is every node this walk has reached, so a corrupt parent loop ends it.
    fn count_beneath(
        &mut self,
        parent: &Key,
        root: &NodeId,
        tally: &mut Tally,
        walked: &mut HashSet<Key>,
    ) {
        let tree = self.tree;
        let Some(children) = tree.children.get(parent) else {
            return;
        };
        for child in children {
            if !walked.insert(child.clone()) {
                continue;
            }
            let Some(item) = tree.items.get(child) else {
                continue;
            };
            // A wait the root itself draws follows from its status; it is not part of it.
            if item.drawn_by.as_ref() == Some(root) {
                continue;
            }
            let (reading, archived) = self.reading(child, item);
            // Archived by finishing — a Done Task whose window passed, an Achieved Goal, a
            // settled Commitment — is still finished, and counts as Done. Anything else archived
            // was put away, and is left out with everything beneath it.
            if archived && reading != TaskStatus::Done {
                continue;
            }
            tally.count(reading);
            if reading == TaskStatus::Done {
                tally.latest = tally.latest.max(self.done_at(child, item));
            }
            self.count_beneath(child, root, tally, walked);
        }
    }

    /// What `item` reads as, and whether it is effectively Archived: a compound Task's derived
    /// status and re-derived lifecycle, anything else as the load served it.
    fn reading(&mut self, key: &Key, item: &Item) -> (TaskStatus, bool) {
        if key.0 == Kind::Task && item.compound && !item.settled {
            let resolved = self.resolve(&key.1);
            return (resolved.status, resolved.archived);
        }
        (item.reading, item.archived)
    }

    /// When `item` was finished: a compound Task's own done time, anything else's as known.
    fn done_at(&mut self, key: &Key, item: &Item) -> Option<NaiveDateTime> {
        if key.0 == Kind::Task && item.compound && !item.settled {
            return self.resolve(&key.1).done_at;
        }
        item.done_at
    }
}
