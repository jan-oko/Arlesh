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
use super::model::{GoalId, OnScopeExit, TaskId, TimeScope};

/// Which of the two scoped tables a chain link came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(super) enum NodeKind {
    /// A row in `tasks`.
    Task,
    /// A row in `goals`.
    Goal,
}

impl NodeKind {
    /// Parses a stored `parent_type`, or `None` for anything that is not a scoped node — a
    /// project, a domain, an aspect. Those end the chain rather than breaking it.
    pub(super) fn from_db(value: &str) -> Option<Self> {
        match value {
            "task" => Some(Self::Task),
            "goal" => Some(Self::Goal),
            _ => None,
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
        Self { node_type: node_type.into(), node_id }
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
    /// The link's on-exit behaviour. Present iff `time_scope` is.
    pub(super) on_scope_exit: Option<OnScopeExit>,
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
            ChainEnd::Broken { kind: NodeKind::Task, .. } => self.exhausted(),
            ChainEnd::Broken { .. } | ChainEnd::Root => Search::Unconstrained,
        }
    }
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
            return Ok(AncestryChain { links, end: ChainEnd::Root });
        };
        if !visited.insert((kind, next.node_id)) {
            let end = ChainEnd::Broken { kind, id: next.node_id, cause: BreakCause::Cycle };
            return Ok(AncestryChain { links, end });
        }
        let read = match kind {
            NodeKind::Task => db.tasks().ancestry_link(TaskId(next.node_id)).await,
            NodeKind::Goal => db.goals().ancestry_link(GoalId(next.node_id)).await,
        };
        let link = match read {
            Ok(link) => link,
            // A dangling reference — the referenced row was deleted — breaks the chain. Every
            // other database failure is a real failure and propagates.
            Err(TaskError::TaskNotFound(_) | TaskError::GoalNotFound(_)) => {
                let end = ChainEnd::Broken { kind, id: next.node_id, cause: BreakCause::Missing };
                return Ok(AncestryChain { links, end });
            }
            Err(error) => return Err(error),
        };
        next = link.parent.clone();
        links.push(link);
    }
}

#[cfg(test)]
#[cfg_attr(coverage_nightly, coverage(off))]
mod tests {
    use super::*;
    use crate::database::session::SessionFactory;
    use crate::database::DatabasePool;
    use sqlx::sqlite::SqlitePoolOptions;

    /// A migrated in-memory database with a single connection, as the integration tests use.
    async fn scratch_pool() -> DatabasePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("failed to open in-memory SQLite");
        crate::database::run_migrations(&pool)
            .await
            .expect("migrations failed");
        pool
    }

    /// Inserts a task row directly, bypassing every rule, so a test can build a tree the write
    /// path would refuse — which is the point for the broken and cyclic cases.
    async fn insert_task(pool: &DatabasePool, id: i64, parent_type: &str, parent_id: i64) {
        sqlx::query(
            "INSERT INTO tasks (id, title, parent_type, parent_id, status) VALUES (?, ?, ?, ?, 'todo')",
        )
        .bind(id)
        .bind(format!("task {id}"))
        .bind(parent_type)
        .bind(parent_id)
        .execute(pool)
        .await
        .expect("failed to insert task");
    }

    /// Inserts a goal row directly, for the same reason as [`insert_task`].
    async fn insert_goal(pool: &DatabasePool, id: i64, parent_type: &str, parent_id: i64) {
        sqlx::query(
            "INSERT INTO goals (id, title, parent_type, parent_id, status) VALUES (?, ?, ?, ?, 'active')",
        )
        .bind(id)
        .bind(format!("goal {id}"))
        .bind(parent_type)
        .bind(parent_id)
        .execute(pool)
        .await
        .expect("failed to insert goal");
    }

    /// The `(kind, id)` of each link, which is all the shape assertions need.
    fn shape(chain: &AncestryChain) -> Vec<(NodeKind, i64)> {
        chain.links.iter().map(|link| (link.kind, link.id)).collect()
    }

    // --- Pure searches (Task 3.2) ---
    //
    // Every chain below is written by hand. None of these tests opens a database, and that is
    // the whole point of the split: if one of them ever needs a fixture, the impure half has
    // leaked into the pure half.

    /// A Time Scope over one scope id — enough to tell two scopes apart by identity.
    fn scope(id: i64) -> TimeScope {
        TimeScope { start_id: id, end_id: id, duration: None }
    }

    /// An unscoped, unplanned task link parented by the next id up.
    fn task_link(id: i64) -> AncestryLink {
        AncestryLink {
            kind: NodeKind::Task,
            id,
            parent: NodeRef::new("task", id + 1),
            time_scope: None,
            plan: None,
            on_scope_exit: None,
        }
    }

    /// An unscoped goal link parented by the next id up.
    fn goal_link(id: i64) -> AncestryLink {
        AncestryLink {
            kind: NodeKind::Goal,
            id,
            parent: NodeRef::new("goal", id + 1),
            time_scope: None,
            plan: None,
            on_scope_exit: None,
        }
    }

    /// A chain over `links` that reached the root.
    fn rooted(links: Vec<AncestryLink>) -> AncestryChain {
        AncestryChain { links, end: ChainEnd::Root }
    }

    /// A chain over `links` that broke on a missing `kind` reference.
    fn broken_at(links: Vec<AncestryLink>, kind: NodeKind, id: i64) -> AncestryChain {
        AncestryChain { links, end: ChainEnd::Broken { kind, id, cause: BreakCause::Missing } }
    }

    #[test]
    fn nearest_scoped_takes_the_first_scoped_link_climbing_through_goals() {
        let chain = rooted(vec![
            task_link(1),
            AncestryLink { time_scope: Some(scope(70)), ..goal_link(2) },
            AncestryLink { time_scope: Some(scope(80)), ..goal_link(3) },
        ]);

        assert_eq!(
            chain.nearest_scoped(),
            Search::Found((&scope(70), OnScopeExit::Keep)),
            "the nearer goal wins, and a goal is examined like any other link"
        );
    }

    #[test]
    fn nearest_scoped_defaults_a_missing_on_exit_to_keep_and_otherwise_reports_the_stored_one() {
        let defaulted = rooted(vec![AncestryLink { time_scope: Some(scope(70)), ..task_link(1) }]);
        assert_eq!(defaulted.nearest_scoped(), Search::Found((&scope(70), OnScopeExit::Keep)));

        let stored = rooted(vec![AncestryLink {
            time_scope: Some(scope(70)),
            on_scope_exit: Some(OnScopeExit::Archive),
            ..task_link(1)
        }]);
        assert_eq!(stored.nearest_scoped(), Search::Found((&scope(70), OnScopeExit::Archive)));
    }

    #[test]
    fn nearest_scoped_on_a_rooted_chain_with_nothing_scoped_is_unconstrained() {
        let chain = rooted(vec![task_link(1), goal_link(2)]);

        assert_eq!(chain.nearest_scoped(), Search::Unconstrained);
    }

    #[test]
    fn nearest_scoped_prefers_a_scope_found_before_the_chain_broke() {
        let chain = broken_at(
            vec![AncestryLink { time_scope: Some(scope(70)), ..task_link(1) }, task_link(2)],
            NodeKind::Task,
            3,
        );

        assert_eq!(
            chain.nearest_scoped(),
            Search::Found((&scope(70), OnScopeExit::Keep)),
            "a break above the answer cannot unsettle the answer"
        );
    }

    #[test]
    fn nearest_scoped_on_a_broken_chain_with_nothing_scoped_is_undetermined() {
        let chain = broken_at(vec![task_link(1)], NodeKind::Goal, 2);

        assert_eq!(
            chain.nearest_scoped(),
            Search::Undetermined { kind: NodeKind::Goal, id: 2, cause: BreakCause::Missing },
            "the scope walk needed that goal, so the question is unanswered — not answered 'no'"
        );
    }

    #[test]
    fn nearest_planned_takes_the_nearest_task_plan() {
        let chain = rooted(vec![
            task_link(1),
            AncestryLink { plan: Some(scope(90)), ..task_link(2) },
            AncestryLink { plan: Some(scope(91)), ..task_link(3) },
        ]);

        assert_eq!(chain.nearest_planned(), Search::Found(&scope(90)));
    }

    #[test]
    fn nearest_planned_stops_at_a_goal_and_ignores_every_plan_above_it() {
        // The schema cannot currently put a task above a goal (a goal's parent is a project,
        // domain or goal), so this chain is hand-built to pin the *search's* rule rather than
        // the schema's — the rule is what the four old walks disagreed about.
        let chain = rooted(vec![
            task_link(1),
            goal_link(2),
            AncestryLink { plan: Some(scope(90)), ..task_link(3) },
        ]);

        assert_eq!(
            chain.nearest_planned(),
            Search::Unconstrained,
            "the plan chain is tasks-only: a goal ends it"
        );
    }

    #[test]
    fn nearest_planned_ignores_a_break_beyond_the_goal_that_already_stopped_it() {
        let chain = broken_at(vec![task_link(1)], NodeKind::Goal, 2);

        assert_eq!(
            chain.nearest_planned(),
            Search::Unconstrained,
            "the tasks-only walk stops at that goal without reading it, so the break is moot"
        );
        assert_eq!(
            chain.nearest_scoped(),
            Search::Undetermined { kind: NodeKind::Goal, id: 2, cause: BreakCause::Missing },
            "the same chain leaves the scope question unanswered — this pair is the quirk"
        );
    }

    #[test]
    fn nearest_planned_on_a_chain_broken_at_a_task_is_undetermined() {
        let chain = broken_at(vec![task_link(1)], NodeKind::Task, 2);

        assert_eq!(
            chain.nearest_planned(),
            Search::Undetermined { kind: NodeKind::Task, id: 2, cause: BreakCause::Missing },
            "a task the walk would have read is a task it cannot skip"
        );
    }

    #[test]
    fn nearest_planned_on_a_rooted_chain_with_no_plan_is_unconstrained() {
        let chain = rooted(vec![task_link(1), task_link(2)]);

        assert_eq!(chain.nearest_planned(), Search::Unconstrained);
    }

    #[test]
    fn the_read_policy_treats_an_undetermined_search_as_unconstrained() {
        let chain = broken_at(vec![task_link(1)], NodeKind::Goal, 2);

        assert_eq!(chain.nearest_scoped().or_unconstrained(), None);
    }

    #[test]
    fn the_write_policy_rejects_an_undetermined_search_with_the_reference_it_could_not_follow() {
        let missing = broken_at(vec![task_link(1)], NodeKind::Goal, 2);
        assert!(matches!(
            missing.nearest_scoped().or_reject(),
            Err(TaskError::GoalNotFound(2))
        ));

        let cyclic = AncestryChain {
            links: vec![task_link(1)],
            end: ChainEnd::Broken { kind: NodeKind::Task, id: 1, cause: BreakCause::Cycle },
        };
        assert!(matches!(
            cyclic.nearest_scoped().or_reject(),
            Err(TaskError::AncestorCycle { node_id: 1 })
        ));
    }

    #[test]
    fn both_policies_pass_a_found_answer_and_an_unconstrained_one_straight_through() {
        let found = rooted(vec![AncestryLink { time_scope: Some(scope(70)), ..task_link(1) }]);
        assert_eq!(found.nearest_scoped().or_unconstrained(), Some((&scope(70), OnScopeExit::Keep)));
        assert!(matches!(found.nearest_scoped().or_reject(), Ok(Some(_))));

        let empty = rooted(vec![task_link(1)]);
        assert_eq!(empty.nearest_scoped().or_unconstrained(), None);
        assert!(matches!(empty.nearest_scoped().or_reject(), Ok(None)));
    }

    #[tokio::test]
    async fn a_three_deep_chain_climbs_to_the_root() {
        let pool = scratch_pool().await;
        insert_goal(&pool, 1, "project", 99).await;
        insert_task(&pool, 2, "goal", 1).await;
        insert_task(&pool, 3, "task", 2).await;
        let mut db = SessionFactory::new(pool.clone()).connect().await.expect("connect failed");

        let chain = climb(&mut db, "task", 3).await.expect("climb failed");

        assert_eq!(
            shape(&chain),
            vec![(NodeKind::Task, 3), (NodeKind::Task, 2), (NodeKind::Goal, 1)],
            "the chain must include the starting node and climb through the goal"
        );
        assert_eq!(chain.end, ChainEnd::Root);
    }

    #[tokio::test]
    async fn a_chain_whose_middle_parent_is_missing_ends_as_broken() {
        let pool = scratch_pool().await;
        // Task 3's parent, task 2, was never inserted — the chain dangles one step up.
        insert_task(&pool, 3, "task", 2).await;
        let mut db = SessionFactory::new(pool.clone()).connect().await.expect("connect failed");

        let chain = climb(&mut db, "task", 3).await.expect("climb failed");

        assert_eq!(shape(&chain), vec![(NodeKind::Task, 3)]);
        assert_eq!(
            chain.end,
            ChainEnd::Broken { kind: NodeKind::Task, id: 2, cause: BreakCause::Missing },
            "a broken chain must name the reference it could not follow"
        );
    }

    #[tokio::test]
    async fn a_cyclic_parent_chain_terminates_as_broken() {
        let pool = scratch_pool().await;
        // A tree the write path cannot currently prevent: 4 is its own grandparent.
        insert_task(&pool, 4, "task", 5).await;
        insert_task(&pool, 5, "task", 4).await;
        let mut db = SessionFactory::new(pool.clone()).connect().await.expect("connect failed");

        let chain = climb(&mut db, "task", 4).await.expect("climb failed");

        assert_eq!(shape(&chain), vec![(NodeKind::Task, 4), (NodeKind::Task, 5)]);
        assert_eq!(
            chain.end,
            ChainEnd::Broken { kind: NodeKind::Task, id: 4, cause: BreakCause::Cycle },
            "a cycle must terminate the walk and name where it closed"
        );
    }

    #[tokio::test]
    async fn a_start_that_is_not_a_scoped_node_yields_an_empty_rooted_chain() {
        let pool = scratch_pool().await;
        let mut db = SessionFactory::new(pool.clone()).connect().await.expect("connect failed");

        let chain = climb(&mut db, "project", 99).await.expect("climb failed");

        assert!(chain.links.is_empty());
        assert_eq!(chain.end, ChainEnd::Root);
    }
}
