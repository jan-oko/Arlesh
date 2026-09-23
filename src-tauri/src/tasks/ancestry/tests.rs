use super::*;
use crate::database::session::SessionFactory;
use crate::database::DatabasePool;
use crate::scopes::key::test_key;
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
    chain
        .links
        .iter()
        .map(|link| (link.kind, link.id))
        .collect()
}

// --- Pure searches (Task 3.2) ---
//
// Every chain below is written by hand. None of these tests opens a database, and that is
// the whole point of the split: if one of them ever needs a fixture, the impure half has
// leaked into the pure half.

/// A Time Scope over one scope id — enough to tell two scopes apart by identity.
fn scope(id: i64) -> TimeScope {
    TimeScope {
        start_id: test_key(id),
        end_id: test_key(id),
        duration: None,
    }
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
        verdict_window: None,
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
        verdict_window: None,
    }
}

/// An unscoped commitment link with no Verdict Window, parented by the next id up.
fn commitment_link(id: i64) -> AncestryLink {
    AncestryLink {
        kind: NodeKind::Commitment,
        id,
        parent: NodeRef::new("commitment", id + 1),
        time_scope: None,
        plan: None,
        on_scope_exit: Some(OnScopeExit::Keep),
        verdict_window: None,
    }
}

/// A chain over `links` that reached the root.
fn rooted(links: Vec<AncestryLink>) -> AncestryChain {
    AncestryChain {
        links,
        end: ChainEnd::Root,
    }
}

/// A chain over `links` that broke on a missing `kind` reference.
fn broken_at(links: Vec<AncestryLink>, kind: NodeKind, id: i64) -> AncestryChain {
    AncestryChain {
        links,
        end: ChainEnd::Broken {
            kind,
            id,
            cause: BreakCause::Missing,
        },
    }
}

#[test]
fn nearest_scoped_takes_the_first_scoped_link_climbing_through_goals() {
    let chain = rooted(vec![
        task_link(1),
        AncestryLink {
            time_scope: Some(scope(70)),
            ..goal_link(2)
        },
        AncestryLink {
            time_scope: Some(scope(80)),
            ..goal_link(3)
        },
    ]);

    assert_eq!(
        chain.nearest_scoped(),
        Search::Found((&scope(70), OnScopeExit::Keep)),
        "the nearer goal wins, and a goal is examined like any other link"
    );
}

#[test]
fn nearest_scoped_defaults_a_missing_on_exit_to_keep_and_otherwise_reports_the_stored_one() {
    let defaulted = rooted(vec![AncestryLink {
        time_scope: Some(scope(70)),
        ..task_link(1)
    }]);
    assert_eq!(
        defaulted.nearest_scoped(),
        Search::Found((&scope(70), OnScopeExit::Keep))
    );

    let stored = rooted(vec![AncestryLink {
        time_scope: Some(scope(70)),
        on_scope_exit: Some(OnScopeExit::Archive),
        ..task_link(1)
    }]);
    assert_eq!(
        stored.nearest_scoped(),
        Search::Found((&scope(70), OnScopeExit::Archive))
    );
}

#[test]
fn nearest_scoped_on_a_rooted_chain_with_nothing_scoped_is_unconstrained() {
    let chain = rooted(vec![task_link(1), goal_link(2)]);

    assert_eq!(chain.nearest_scoped(), Search::Unconstrained);
}

#[test]
fn nearest_scoped_prefers_a_scope_found_before_the_chain_broke() {
    let chain = broken_at(
        vec![
            AncestryLink {
                time_scope: Some(scope(70)),
                ..task_link(1)
            },
            task_link(2),
        ],
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
        Search::Undetermined {
            kind: NodeKind::Goal,
            id: 2,
            cause: BreakCause::Missing
        },
        "the scope walk needed that goal, so the question is unanswered — not answered 'no'"
    );
}

#[test]
fn nearest_planned_takes_the_nearest_task_plan() {
    let chain = rooted(vec![
        task_link(1),
        AncestryLink {
            plan: Some(scope(90)),
            ..task_link(2)
        },
        AncestryLink {
            plan: Some(scope(91)),
            ..task_link(3)
        },
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
        AncestryLink {
            plan: Some(scope(90)),
            ..task_link(3)
        },
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
        Search::Undetermined {
            kind: NodeKind::Goal,
            id: 2,
            cause: BreakCause::Missing
        },
        "the same chain leaves the scope question unanswered — this pair is the quirk"
    );
}

#[test]
fn nearest_planned_on_a_chain_broken_at_a_task_is_undetermined() {
    let chain = broken_at(vec![task_link(1)], NodeKind::Task, 2);

    assert_eq!(
        chain.nearest_planned(),
        Search::Undetermined {
            kind: NodeKind::Task,
            id: 2,
            cause: BreakCause::Missing
        },
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
        end: ChainEnd::Broken {
            kind: NodeKind::Task,
            id: 1,
            cause: BreakCause::Cycle,
        },
    };
    assert!(matches!(
        cyclic.nearest_scoped().or_reject(),
        Err(TaskError::AncestorCycle { node_id: 1 })
    ));
}

#[test]
fn both_policies_pass_a_found_answer_and_an_unconstrained_one_straight_through() {
    let found = rooted(vec![AncestryLink {
        time_scope: Some(scope(70)),
        ..task_link(1)
    }]);
    assert_eq!(
        found.nearest_scoped().or_unconstrained(),
        Some((&scope(70), OnScopeExit::Keep))
    );
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
    let mut db = SessionFactory::new(pool.clone())
        .connect()
        .await
        .expect("connect failed");

    let chain = climb(&mut db, "task", 3).await.expect("climb failed");

    assert_eq!(
        shape(&chain),
        vec![
            (NodeKind::Task, 3),
            (NodeKind::Task, 2),
            (NodeKind::Goal, 1)
        ],
        "the chain must include the starting node and climb through the goal"
    );
    assert_eq!(chain.end, ChainEnd::Root);
}

#[tokio::test]
async fn a_chain_whose_middle_parent_is_missing_ends_as_broken() {
    let pool = scratch_pool().await;
    // Task 3's parent, task 2, was never inserted — the chain dangles one step up.
    insert_task(&pool, 3, "task", 2).await;
    let mut db = SessionFactory::new(pool.clone())
        .connect()
        .await
        .expect("connect failed");

    let chain = climb(&mut db, "task", 3).await.expect("climb failed");

    assert_eq!(shape(&chain), vec![(NodeKind::Task, 3)]);
    assert_eq!(
        chain.end,
        ChainEnd::Broken {
            kind: NodeKind::Task,
            id: 2,
            cause: BreakCause::Missing
        },
        "a broken chain must name the reference it could not follow"
    );
}

#[tokio::test]
async fn a_cyclic_parent_chain_terminates_as_broken() {
    let pool = scratch_pool().await;
    // A tree the write path cannot currently prevent: 4 is its own grandparent.
    insert_task(&pool, 4, "task", 5).await;
    insert_task(&pool, 5, "task", 4).await;
    let mut db = SessionFactory::new(pool.clone())
        .connect()
        .await
        .expect("connect failed");

    let chain = climb(&mut db, "task", 4).await.expect("climb failed");

    assert_eq!(
        shape(&chain),
        vec![(NodeKind::Task, 4), (NodeKind::Task, 5)]
    );
    assert_eq!(
        chain.end,
        ChainEnd::Broken {
            kind: NodeKind::Task,
            id: 4,
            cause: BreakCause::Cycle
        },
        "a cycle must terminate the walk and name where it closed"
    );
}

#[tokio::test]
async fn a_start_that_is_not_a_scoped_node_yields_an_empty_rooted_chain() {
    let pool = scratch_pool().await;
    let mut db = SessionFactory::new(pool.clone())
        .connect()
        .await
        .expect("connect failed");

    let chain = climb(&mut db, "project", 99).await.expect("climb failed");

    assert!(chain.links.is_empty());
    assert_eq!(chain.end, ChainEnd::Root);
}

// --- nearest_verdict_window ---

#[test]
fn the_nearest_commitment_that_sets_a_verdict_window_wins() {
    let chain = rooted(vec![
        commitment_link(1),
        AncestryLink {
            verdict_window: Some(DurationSpec {
                n: 2,
                kind: "day".into(),
            }),
            ..commitment_link(2)
        },
        AncestryLink {
            verdict_window: Some(DurationSpec {
                n: 1,
                kind: "week".into(),
            }),
            ..commitment_link(3)
        },
    ]);
    assert_eq!(
        chain.nearest_verdict_window(),
        Search::Found(&DurationSpec {
            n: 2,
            kind: "day".to_string()
        }),
    );
}

#[test]
fn a_commitment_that_sets_its_own_verdict_window_needs_no_ancestor() {
    // The chain starts at the node itself, so its own value is the first link examined.
    let chain = rooted(vec![AncestryLink {
        verdict_window: Some(DurationSpec {
            n: 3,
            kind: "day".into(),
        }),
        ..commitment_link(1)
    }]);
    assert_eq!(
        chain.nearest_verdict_window(),
        Search::Found(&DurationSpec {
            n: 3,
            kind: "day".to_string()
        }),
    );
}

#[test]
fn a_chain_of_commitments_none_of_which_sets_one_is_unbounded() {
    let chain = rooted(vec![commitment_link(1), commitment_link(2)]);
    assert_eq!(chain.nearest_verdict_window(), Search::Unconstrained);
}

#[test]
fn the_search_stops_at_the_first_link_that_is_not_a_commitment() {
    // Only a Commitment has the column, so a task or goal above one ends the chain for this
    // question — exactly as a goal ends the plan chain.
    let chain = rooted(vec![commitment_link(1), task_link(2), goal_link(3)]);
    assert_eq!(chain.nearest_verdict_window(), Search::Unconstrained);
}

#[test]
fn a_chain_broken_above_a_non_commitment_still_answers_unbounded() {
    // The break is past where the search would have stopped anyway, so it cannot make the
    // question unanswerable.
    let chain = AncestryChain {
        links: vec![commitment_link(1), task_link(2)],
        end: ChainEnd::Broken {
            kind: NodeKind::Task,
            id: 3,
            cause: BreakCause::Missing,
        },
    };
    assert_eq!(chain.nearest_verdict_window(), Search::Unconstrained);
}

#[test]
fn a_commitment_chain_that_breaks_before_answering_is_undetermined() {
    let chain = AncestryChain {
        links: vec![commitment_link(1)],
        end: ChainEnd::Broken {
            kind: NodeKind::Commitment,
            id: 2,
            cause: BreakCause::Missing,
        },
    };
    assert_eq!(
        chain.nearest_verdict_window(),
        Search::Undetermined {
            kind: NodeKind::Commitment,
            id: 2,
            cause: BreakCause::Missing
        },
    );
}

#[test]
fn a_commitments_window_governs_the_tasks_beneath_it_and_they_keep_rather_than_archive() {
    // A Commitment has no On-exit column and always Keeps, so a task inheriting its window
    // lapses Overdue rather than Missed. Stated here because nothing else reads that column
    // for a commitment link.
    let chain = rooted(vec![
        task_link(1),
        AncestryLink {
            time_scope: Some(scope(70)),
            ..commitment_link(2)
        },
    ]);
    assert_eq!(
        chain.nearest_scoped(),
        Search::Found((&scope(70), OnScopeExit::Keep)),
    );
}

#[test]
fn a_missing_commitment_reference_rejects_a_write_by_name() {
    let undetermined: Search<()> = Search::Undetermined {
        kind: NodeKind::Commitment,
        id: 5,
        cause: BreakCause::Missing,
    };
    assert!(matches!(
        undetermined.or_reject(),
        Err(TaskError::CommitmentNotFound(5)),
    ));
}

#[test]
fn a_commitment_parent_type_names_the_commitments_table() {
    assert_eq!(NodeKind::from_db("commitment"), Some(NodeKind::Commitment));
}
