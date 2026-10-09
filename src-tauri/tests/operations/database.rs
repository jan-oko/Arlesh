use crate::helpers;

use arlesh_lib::database;

#[tokio::test]
async fn connect_enables_foreign_keys() {
    let pool = database::connect("sqlite::memory:").await.unwrap();

    let fk_on: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(fk_on, 1, "after_connect hook must enable foreign_keys");
}

#[tokio::test]
async fn run_migrations_seeds_aspects() {
    let pool = database::connect("sqlite::memory:").await.unwrap();
    database::run_migrations(&pool).await.unwrap();

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM domains WHERE subtype = 'aspect'")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(count, 6);
}

#[tokio::test]
async fn connect_and_migrate_seeds_aspects() {
    let pool = helpers::test_pool().await;

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM domains WHERE subtype = 'aspect'")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(count, 6, "expected 6 seeded aspects");
}

#[tokio::test]
async fn aspects_have_expected_titles() {
    let pool = helpers::test_pool().await;

    let titles: Vec<String> =
        sqlx::query_scalar("SELECT title FROM domains WHERE subtype = 'aspect' ORDER BY title")
            .fetch_all(&pool)
            .await
            .unwrap();

    assert_eq!(
        titles,
        vec!["Body", "Connections", "Duty", "Flow", "Growth", "Self"]
    );
}

/// A one-connection database with foreign keys on, migrated through every migration numbered
/// below `version`, and the whole chain to finish it with.
async fn pool_before(version: i64) -> (sqlx::SqlitePool, sqlx::migrate::Migrator) {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .after_connect(|conn, _| {
            Box::pin(async move {
                sqlx::query("PRAGMA foreign_keys = ON")
                    .execute(conn)
                    .await?;
                Ok(())
            })
        })
        .connect("sqlite::memory:")
        .await
        .unwrap();
    let everything = sqlx::migrate!("./migrations");
    let mut before = sqlx::migrate!("./migrations");
    before.migrations = std::borrow::Cow::Owned(
        everything
            .migrations
            .iter()
            .filter(|migration| migration.version < version)
            .cloned()
            .collect(),
    );
    before.run(&pool).await.unwrap();
    (pool, everything)
}

/// Migration `0025` clears the Target Node of every flow that already points at its own parent, so
/// that the parent default lives in the read path instead of in a column a move would leave behind.
///
/// The comparison is on the **normalised node id**: aspects, projects, domains and tags share one
/// `domains` table, so a flow can name the very same row `project` as a parent and `domain` as a
/// target — 8 of the 15 flows on the author's board did. A flow pointed at anything else keeps the
/// target it was given. Run on the schema before 0096, which stores only `domain`.
#[tokio::test]
async fn migration_0025_clears_a_target_that_is_already_the_parent() {
    let (pool, _) = pool_before(96).await;
    sqlx::query(
        "INSERT INTO flows (id, title, instance_type, parent_type, parent_id, target_type, target_id) VALUES
           (1, 'target is the parent',            'task', 'domain',  7, 'domain', 7),
           (2, 'same row, different type labels', 'task', 'project', 7, 'domain', 7),
           (3, 'target is another node kind',     'task', 'domain',  7, 'goal',   7),
           (4, 'target is another domain',        'task', 'domain',  7, 'domain', 8),
           (5, 'no target at all',                'task', 'domain',  7, NULL,     NULL),
           (6, 'goal parent, goal target',        'task', 'goal',    3, 'goal',   3)",
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(include_str!(
        "../../migrations/0025_flow_target_defaults_to_parent.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();

    let rows: Vec<(i64, Option<String>, Option<i64>)> =
        sqlx::query_as("SELECT id, target_type, target_id FROM flows ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();

    assert_eq!(
        rows,
        vec![
            (1, None, None),
            (2, None, None),
            (3, Some("goal".to_string()), Some(7)),
            (4, Some("domain".to_string()), Some(8)),
            (5, None, None),
            (6, None, None),
        ]
    );
}

/// Two migrations claiming the same number is a merge hazard with no other guard: two branches
/// each take what was the next free number, neither conflicts with the other (the filenames
/// differ), and git, lint, `tsc` and the whole frontend gate are happy. sqlx refuses the duplicate
/// outright — `UNIQUE constraint failed: _sqlx_migrations.version` — but only once something opens
/// a database, so on a branch whose tests are all frontend the collision reaches a person before it
/// reaches a gate. This catches it at the moment everything else is checked, and names both files
/// so the fix is obvious from the failure alone.
///
/// The version is the text before the first `_`, parsed as a number, because that is what sqlx
/// does with it: `0025_a.sql` and `25_b.sql` collide as surely as two `0025_`s.
#[test]
fn every_migration_claims_its_own_number() {
    let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations");
    let mut by_version: std::collections::BTreeMap<i64, Vec<String>> =
        std::collections::BTreeMap::new();

    for entry in std::fs::read_dir(&directory).unwrap() {
        let name = entry.unwrap().file_name().to_string_lossy().into_owned();
        if !name.ends_with(".sql") {
            continue;
        }
        let version: i64 = name
            .split('_')
            .next()
            .unwrap_or_default()
            .parse()
            .unwrap_or_else(|_| {
                panic!("migration `{name}` must start with `<number>_`, which is the version sqlx reads it by")
            });
        by_version.entry(version).or_default().push(name);
    }

    assert!(
        !by_version.is_empty(),
        "no migrations found in {} — this test would pass vacuously",
        directory.display()
    );

    let collisions: Vec<String> = by_version
        .iter()
        .filter(|(_, files)| files.len() > 1)
        .map(|(version, files)| {
            let mut files = files.clone();
            files.sort();
            format!("{version}: {}", files.join(" and "))
        })
        .collect();

    assert!(
        collisions.is_empty(),
        "these migrations claim a number another one already claims, which sqlx refuses at \
         runtime (UNIQUE constraint failed: _sqlx_migrations.version). Renumber the one that \
         landed second to the next free number:\n  {}",
        collisions.join("\n  ")
    );
}

/// Migration `0037` rebuilds `tasks` to turn `delegate_to` into a `(delegate_kind, delegate_id)`
/// pair, on a board that already has delegates, tags, dependency edges and knowledge-base links.
///
/// The rebuild is the dangerous part: `DROP TABLE tasks` cascades into the three tables that
/// reference it, so this checks that every delegate became a Person delegate and that nothing
/// hanging off a task was lost on the way.
#[tokio::test]
async fn migration_0037_keeps_every_delegate_as_a_person_and_every_link() {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .after_connect(|conn, _| {
            Box::pin(async move {
                sqlx::query("PRAGMA foreign_keys = ON")
                    .execute(conn)
                    .await?;
                Ok(())
            })
        })
        .connect("sqlite::memory:")
        .await
        .unwrap();

    let everything = sqlx::migrate!("./migrations");
    let mut before = sqlx::migrate!("./migrations");
    before.migrations = std::borrow::Cow::Owned(
        everything
            .migrations
            .iter()
            .filter(|migration| migration.version < 37)
            .cloned()
            .collect(),
    );
    before.run(&pool).await.unwrap();

    sqlx::query(
        "INSERT INTO people (id, name) VALUES (1, 'Ada');
         INSERT INTO domains (id, title, subtype) VALUES (100, 'Tag', 'tag');
         INSERT INTO tasks (id, title, parent_type, parent_id, delegate_to)
             VALUES (1, 'delegated', 'domain', 1, 1), (2, 'not delegated', 'domain', 1, NULL);
         INSERT INTO task_dependencies (task_id, dependency_type, dependency_id) VALUES (2, 'task', 1);
         INSERT INTO tags_on_tasks (task_id, tag_id) VALUES (1, 100);
         INSERT INTO task_knowledge_base_links (task_id, entity_type, entity_id) VALUES (1, 'person', 1);",
    )
    .execute(&pool)
    .await
    .unwrap();

    everything.run(&pool).await.unwrap();

    let delegates: Vec<(i64, Option<String>, Option<i64>)> =
        sqlx::query_as("SELECT id, delegate_kind, delegate_id FROM tasks ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(
        delegates,
        vec![(1, Some("person".to_string()), Some(1)), (2, None, None)]
    );

    for table in [
        "task_dependencies",
        "tags_on_tasks",
        "task_knowledge_base_links",
    ] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1, "{table} lost its row in the rebuild");
    }

    let violations: Vec<(String, Option<i64>, String, i64)> =
        sqlx::query_as("PRAGMA foreign_key_check")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert!(violations.is_empty(), "{violations:?}");
}

/// Migration `0046` rewrites every scope reference from a `scopes` row id to the canonical text
/// of the scope's value key, rebuilding nine tables and carrying their ON DELETE CASCADE dependents aside, then drops
/// `scopes` (ADR 0009). This seeds a board with every kind of scope and every kind of reference —
/// a Time Scope, a Plan, a Recurrence, a Habit Modification, an event — plus the tags, links,
/// dependency edges and wait rows that hang off the rebuilt tables, and checks that each reference
/// became the key of the scope it named and that nothing hanging off a row was lost.
#[tokio::test]
async fn migration_0046_turns_every_scope_reference_into_its_key_and_keeps_every_link() {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .after_connect(|conn, _| {
            Box::pin(async move {
                sqlx::query("PRAGMA foreign_keys = ON")
                    .execute(conn)
                    .await?;
                Ok(())
            })
        })
        .connect("sqlite::memory:")
        .await
        .unwrap();

    let everything = sqlx::migrate!("./migrations");
    let mut before = sqlx::migrate!("./migrations");
    before.migrations = std::borrow::Cow::Owned(
        everything
            .migrations
            .iter()
            .filter(|migration| migration.version < 46)
            .cloned()
            .collect(),
    );
    before.run(&pool).await.unwrap();

    sqlx::query(
        "INSERT INTO scopes (id, kind, label, start_date, end_date) VALUES
             (1, 'week', 'Week 39 2026', '2026-09-20', '2026-09-26'),
             (2, 'day', '2026-09-23', '2026-09-23', '2026-09-23'),
             (3, 'month', 'September 2026', '2026-09-01', '2026-09-30'),
             (4, 'season', 'Autumn 2026', '2026-09-01', '2026-11-30');
         INSERT INTO scopes (id, kind, label, start_date, end_date, part, day_id) VALUES
             (5, 'part_of_day', '2026-09-23 night', '2026-09-23', '2026-09-24', 'night', 2);
         INSERT INTO scopes (id, kind, label, start_date, end_date, start_datetime, end_datetime)
             VALUES (6, 'exact', 'x', '2026-09-23', '2026-09-23',
                     '2026-09-23T14:00:00', '2026-09-23T15:30:00');
         INSERT INTO domains (id, title, subtype) VALUES (100, 'Tag', 'tag');
         INSERT INTO goals (id, title, parent_type, parent_id, time_scope_start_id,
                            time_scope_end_id, on_scope_exit)
             VALUES (1, 'autumn', 'domain', 1, 4, 4, 'keep');
         INSERT INTO tasks (id, title, parent_type, parent_id, time_scope_start_id,
                            time_scope_end_id, plan_start_id, plan_end_id, on_scope_exit)
             VALUES (1, 'planned', 'goal', 1, 3, 3, 2, 5, 'keep'),
                    (2, 'exact', 'goal', 1, 6, 6, NULL, NULL, 'archive'),
                    (3, 'unscoped', 'goal', 1, NULL, NULL, NULL, NULL, NULL);
         INSERT INTO tags_on_tasks (task_id, tag_id) VALUES (1, 100);
         INSERT INTO tags_on_goals (goal_id, tag_id) VALUES (1, 100);
         INSERT INTO task_dependencies (task_id, dependency_type, dependency_id)
             VALUES (2, 'task', 1);
         INSERT INTO task_knowledge_base_links (task_id, entity_type, entity_id)
             VALUES (1, 'person', 1);
         INSERT INTO task_async_templates (task_id, title) VALUES (3, 'reply');
         INSERT INTO tags_on_async_templates (task_id, tag_id) VALUES (3, 100);
         INSERT INTO spawned_waits (task_id) VALUES (3);
         INSERT INTO events (id, title, scope_id) VALUES (1, 'launch', 2);
         INSERT INTO flows (id, title, instance_type, parent_type, parent_id,
                            flow_duration_n, flow_duration_kind)
             VALUES (1, 'weekly', 'task', 'aspect', 1, 1, 'week');
         INSERT INTO flow_recurrences (flow_id, start_scope_id, end_scope_id, consumption_kind)
             VALUES (1, 1, NULL, 'destructive');
         INSERT INTO habit_instance_modifications
             (flow_id, item_type, item_id, iteration_scope_id, status)
             VALUES (1, 'flow_root', 1, 1, 'done');",
    )
    .execute(&pool)
    .await
    .unwrap();

    // Through 0059: 0060 folds `habit_instance_modifications` into the overlays (Arlesh-pnn), and
    // what is asked here is what 0046 made of it.
    let mut through_0059 = sqlx::migrate!("./migrations");
    through_0059.migrations = std::borrow::Cow::Owned(
        everything
            .migrations
            .iter()
            .filter(|migration| migration.version < 60)
            .cloned()
            .collect(),
    );
    through_0059.run(&pool).await.unwrap();

    type Window = (
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    );
    let windows: Vec<Window> = sqlx::query_as(
        "SELECT time_scope_start_id, time_scope_end_id, plan_start_id, plan_end_id
         FROM tasks ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let key = |raw: &str| Some(raw.to_string());
    assert_eq!(
        windows,
        vec![
            (
                key(r#"{"kind":"month","date":"2026-09-01"}"#),
                key(r#"{"kind":"month","date":"2026-09-01"}"#),
                key(r#"{"kind":"day","date":"2026-09-23"}"#),
                key(r#"{"kind":"part_of_day","date":"2026-09-23","part":"night"}"#),
            ),
            (
                key(
                    r#"{"kind":"exact","start":"2026-09-23T14:00:00","end":"2026-09-23T15:30:00"}"#
                ),
                key(
                    r#"{"kind":"exact","start":"2026-09-23T14:00:00","end":"2026-09-23T15:30:00"}"#
                ),
                None,
                None,
            ),
            (None, None, None, None),
        ]
    );

    let goal: Option<String> = sqlx::query_scalar("SELECT time_scope_start_id FROM goals")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        goal.as_deref(),
        Some(r#"{"kind":"season","date":"2026-09-01"}"#)
    );
    let event: Option<String> = sqlx::query_scalar("SELECT scope_id FROM events")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        event.as_deref(),
        Some(r#"{"kind":"day","date":"2026-09-23"}"#)
    );
    let recurrence: String = sqlx::query_scalar("SELECT start_scope_id FROM flow_recurrences")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(recurrence, r#"{"kind":"week","date":"2026-09-20"}"#);
    let iteration: String =
        sqlx::query_scalar("SELECT iteration_scope_id FROM habit_instance_modifications")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(iteration, r#"{"kind":"week","date":"2026-09-20"}"#);
    let scopes_left: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE name IN ('scopes', 'exact_scopes')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(scopes_left, 0, "the calendar table is gone");

    for table in [
        "tags_on_tasks",
        "tags_on_goals",
        "task_dependencies",
        "task_knowledge_base_links",
        "task_async_templates",
        "tags_on_async_templates",
        "spawned_waits",
    ] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1, "{table} lost its row in the rebuild");
    }

    let violations: Vec<(String, Option<i64>, String, i64)> =
        sqlx::query_as("PRAGMA foreign_key_check")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert!(violations.is_empty(), "{violations:?}");
}

/// Migrations 0060–0062 turn Habit occurrences into virtual rows (ADR 0008) and give templates
/// their kind's schema. None of them may touch what a template already planned: a flow's root
/// Cycle Plan and an item's (Cycle Scope, Cycle Plan) pairs come through exactly as they were.
#[tokio::test]
async fn migrations_0060_to_0062_keep_every_cycle_plan() {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .after_connect(|conn, _| {
            Box::pin(async move {
                sqlx::query("PRAGMA foreign_keys = ON")
                    .execute(conn)
                    .await?;
                Ok(())
            })
        })
        .connect("sqlite::memory:")
        .await
        .unwrap();

    let everything = sqlx::migrate!("./migrations");
    let mut through_0059 = sqlx::migrate!("./migrations");
    through_0059.migrations = std::borrow::Cow::Owned(
        everything
            .migrations
            .iter()
            .filter(|migration| migration.version < 60)
            .cloned()
            .collect(),
    );
    through_0059.run(&pool).await.unwrap();

    sqlx::query(
        "INSERT INTO flows (id, title, instance_type, parent_type, parent_id,
                            flow_duration_n, flow_duration_kind,
                            root_plan_kind, root_plan_start, root_plan_end)
             VALUES (5, 'weekly', 'task', 'aspect', 1, 1, 'week', 'day', 1, 1);
         INSERT INTO flow_tasks (id, flow_id, title, parent_type, parent_id)
             VALUES (9, 5, 'prepare', 'flow', 5);
         INSERT INTO flow_item_cycles (id, flow_id, item_type, item_id, scope_kind, scope_index,
                                       plan_kind, plan_start, plan_end, position)
             VALUES (3, 5, 'flow_task', 9, 'day', 3, 'part_of_day', 2, 4, 0);",
    )
    .execute(&pool)
    .await
    .unwrap();

    everything.run(&pool).await.unwrap();

    let root: (Option<String>, Option<i64>, Option<i64>) = sqlx::query_as(
        "SELECT root_plan_kind, root_plan_start, root_plan_end FROM flows WHERE id = 5",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(root, (Some("day".to_string()), Some(1), Some(1)));

    type Pair = (
        i64,
        Option<String>,
        Option<i64>,
        Option<String>,
        Option<i64>,
        Option<i64>,
    );
    let pairs: Vec<Pair> = sqlx::query_as(
        "SELECT id, scope_kind, scope_index, plan_kind, plan_start, plan_end
         FROM flow_item_cycles",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        pairs,
        vec![(
            3,
            Some("day".to_string()),
            Some(3),
            Some("part_of_day".to_string()),
            Some(2),
            Some(4),
        )],
        "the pair keeps its id — occurrences are keyed on it — and its Cycle Plan"
    );
}

/// Migration `0087` replaces a Habit's Consumption with a clock (Task #245): Destructive becomes
/// Window + Archive, Accumulating + Overlapping Window + Owed, and Accumulating + Blocking — under
/// every catch-up policy — Window + Overdue. Nothing else about a Habit is rewritten: every overlay
/// stays where it was, keyed as it was, and none reads an explicit due it never had.
#[tokio::test]
async fn migration_0087_gives_every_habit_a_clock_and_keeps_every_overlay() {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();

    let everything = sqlx::migrate!("./migrations");
    let mut before = sqlx::migrate!("./migrations");
    before.migrations = std::borrow::Cow::Owned(
        everything
            .migrations
            .iter()
            .filter(|migration| migration.version < 87)
            .cloned()
            .collect(),
    );
    before.run(&pool).await.unwrap();

    sqlx::query(
        r#"INSERT INTO flows (id, title, instance_type, parent_type, parent_id,
                              flow_duration_n, flow_duration_kind)
             VALUES (1, 'destructive', 'task', 'aspect', 1, 1, 'week'),
                    (2, 'overlapping', 'task', 'aspect', 1, 1, 'week'),
                    (3, 'latest', 'task', 'aspect', 1, 1, 'week'),
                    (4, 'next', 'task', 'aspect', 1, 1, 'day'),
                    (5, 'all pending', 'task', 'aspect', 1, 1, 'day');
         INSERT INTO flow_recurrences (flow_id, start_scope_id, gap_n, gap_kind, end_scope_id,
                                       consumption_kind, blocking_mode, catchup_policy)
             VALUES (1, '{"kind":"week","date":"2026-09-20"}', NULL, NULL, NULL,
                     'destructive', NULL, NULL),
                    (2, '{"kind":"week","date":"2026-09-20"}', NULL, NULL, NULL,
                     'accumulating', 'overlapping', NULL),
                    (3, '{"kind":"week","date":"2026-09-20"}', 3, 'week',
                     '{"kind":"week","date":"2026-12-27"}', 'accumulating', 'blocking', 'latest'),
                    (4, '{"kind":"day","date":"2026-09-20"}', NULL, NULL, NULL,
                     'accumulating', 'blocking', 'next'),
                    (5, '{"kind":"day","date":"2026-09-20"}', NULL, NULL, NULL,
                     'accumulating', 'blocking', 'all_pending');
         INSERT INTO task_overlays (origin, flow_id, item_type, item_id, iteration_scope,
                                    cycle_id, status, resolved_at, plan_start_id, plan_end_id,
                                    plan_set)
             VALUES ('habit', 3, 'flow_root', 3, '{"kind":"week","date":"2026-09-20"}', 0,
                     'done', 1790243033701, NULL, NULL, 0),
                    ('habit', 3, 'flow_root', 3, '{"kind":"week","date":"2026-09-27"}', 0,
                     NULL, NULL, '{"kind":"day","date":"2026-09-30"}',
                     '{"kind":"day","date":"2026-09-30"}', 1);"#,
    )
    .execute(&pool)
    .await
    .unwrap();

    everything.run(&pool).await.unwrap();

    type Clock = (i64, String, Option<String>, Option<i64>, Option<String>);
    let clocks: Vec<Clock> = sqlx::query_as(
        "SELECT flow_id, clock, miss_policy, gap_n, end_scope_id
         FROM flow_recurrences ORDER BY flow_id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let end = Some(r#"{"kind":"week","date":"2026-12-27"}"#.to_string());
    assert_eq!(
        clocks,
        vec![
            (1, "window".into(), Some("archive".into()), None, None),
            (2, "window".into(), Some("owed".into()), None, None),
            (3, "window".into(), Some("overdue".into()), Some(3), end),
            (4, "window".into(), Some("overdue".into()), None, None),
            (5, "window".into(), Some("overdue".into()), None, None),
        ]
    );

    type Overlay = (String, Option<String>, Option<String>, Option<String>);
    let overlays: Vec<Overlay> = sqlx::query_as(
        "SELECT iteration_scope, status, due_scope_start_id, due_scope_end_id
         FROM task_overlays ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        overlays,
        vec![
            (
                r#"{"kind":"week","date":"2026-09-20"}"#.into(),
                Some("done".into()),
                None,
                None
            ),
            (
                r#"{"kind":"week","date":"2026-09-27"}"#.into(),
                None,
                None,
                None
            ),
        ],
        "every overlay is kept where it was, with no due it never had"
    );

    let plan: Option<String> =
        sqlx::query_scalar("SELECT plan_start_id FROM task_overlays WHERE status IS NULL")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        plan.as_deref(),
        Some(r#"{"kind":"day","date":"2026-09-30"}"#)
    );
}

/// Migration `0096` (Task 13c) respells every reference to a domains-table row — stored as
/// `aspect`, `project`, `domain` or `tag`, whichever its writer used — as `domain`, rebuilding the
/// seven tables that hold one so their CHECKs admit no other spelling. Dropping `tasks`, `goals`,
/// `commitments`, `expectations` and `flows` cascades to everything hanging off them, so this seeds
/// a row in each kind of dependent, nested ones included, and checks that every one survives; and
/// the undo journal's images, written under the old spellings, are respelled to match.
#[tokio::test]
async fn migration_0096_spells_every_domains_table_parent_domain_and_keeps_every_link() {
    let (pool, everything) = pool_before(96).await;
    sqlx::query(
        "INSERT INTO domains (id, title, subtype, parent_id) VALUES
             (100, 'Project', 'project', 1), (101, 'Tag', 'tag', NULL);
         INSERT INTO goals (id, title, parent_type, parent_id) VALUES (1, 'goal', 'project', 100);
         INSERT INTO tasks (id, title, parent_type, parent_id) VALUES
             (1, 'under an aspect', 'aspect', 1), (2, 'under a project', 'project', 100),
             (3, 'under a goal', 'goal', 1), (4, 'already domain', 'domain', 100);
         INSERT INTO commitments (id, title, parent_type, parent_id)
             VALUES (1, 'vow', 'project', 100);
         INSERT INTO expectations (id, title, parent_type, parent_id)
             VALUES (1, 'wait', 'project', 100);
         INSERT INTO infos (id, body, parent_type, parent_id) VALUES
             (1, 'about the tag', 'tag', 101), (2, 'about the aspect', 'aspect', 1),
             (3, 'about a task', 'task', 2);
         INSERT INTO flows (id, title, instance_type, parent_type, parent_id, target_type, target_id)
             VALUES (1, 'habit', 'task', 'project', 100, 'aspect', 1);
         INSERT INTO flow_goals (id, flow_id, title, parent_type, parent_id)
             VALUES (1, 1, 'goal item', 'flow', 1);
         INSERT INTO flow_tasks (id, flow_id, title, parent_type, parent_id)
             VALUES (1, 1, 'task item', 'flow', 1);
         INSERT INTO flow_task_async_templates (flow_task_id, title) VALUES (1, 'reply');
         INSERT INTO tags_on_flow_task_async_templates (flow_task_id, tag_id) VALUES (1, 101);
         INSERT INTO flow_instances (id, flow_id, root_type, root_id, started_at)
             VALUES (1, 1, 'task', 2, 0);
         INSERT INTO flow_instance_nodes (flow_instance_id, node_type, node_id, source_item_type,
                                          source_item_id, original_parent_type, original_parent_id)
             VALUES (1, 'task', 2, 'flow', 1, 'project', 100);
         INSERT INTO tags_on_tasks (task_id, tag_id) VALUES (2, 101);
         INSERT INTO task_dependencies (task_id, dependency_type, dependency_id)
             VALUES (2, 'task', 1);
         INSERT INTO tags_on_goals (goal_id, tag_id) VALUES (1, 101);
         INSERT INTO tags_on_commitments (commitment_id, tag_id) VALUES (1, 101);
         INSERT INTO tags_on_expectations (expectation_id, tag_id) VALUES (1, 101);",
    )
    .execute(&pool)
    .await
    .unwrap();
    let journalled: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM undo_journal
         WHERE json_extract(after_image, '$.parent_type') IN ('aspect', 'project', 'tag')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(journalled > 0, "the seeding is journalled under the old spellings");

    everything.run(&pool).await.unwrap();

    for (table, expected) in [
        ("tasks", vec!["domain", "domain", "goal", "domain"]),
        ("goals", vec!["domain"]),
        ("commitments", vec!["domain"]),
        ("expectations", vec!["domain"]),
        ("infos", vec!["domain", "domain", "task"]),
        ("flows", vec!["domain"]),
    ] {
        let spellings: Vec<String> =
            sqlx::query_scalar(&format!("SELECT parent_type FROM {table} ORDER BY id"))
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(spellings, expected, "{table}");
    }
    let target: (String, i64) = sqlx::query_as("SELECT target_type, target_id FROM flows")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(target, ("domain".to_string(), 1));
    let original: String =
        sqlx::query_scalar("SELECT original_parent_type FROM flow_instance_nodes")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(original, "domain");

    for table in [
        "flow_goals",
        "flow_tasks",
        "flow_task_async_templates",
        "tags_on_flow_task_async_templates",
        "flow_instance_nodes",
        "tags_on_tasks",
        "task_dependencies",
        "tags_on_goals",
        "tags_on_commitments",
        "tags_on_expectations",
    ] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1, "{table} lost its row in the rebuild");
    }
    let run_flow: Option<i64> = sqlx::query_scalar("SELECT flow_id FROM flow_instances")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(run_flow, Some(1), "a started run keeps its Flow");

    let old_spellings: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM undo_journal
         WHERE json_extract(before_image, '$.parent_type') IN ('aspect', 'project', 'tag')
            OR json_extract(after_image, '$.parent_type') IN ('aspect', 'project', 'tag')
            OR json_extract(after_image, '$.target_type') IN ('aspect', 'project', 'tag')
            OR json_extract(after_image, '$.original_parent_type') IN ('aspect', 'project', 'tag')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(old_spellings, 0, "the journal's images are respelled");

    let violations: Vec<(String, i64, String, i64)> = sqlx::query_as("PRAGMA foreign_key_check")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert!(violations.is_empty(), "{violations:?}");

    for (table, insert) in [
        (
            "tasks",
            "INSERT INTO tasks (title, parent_type, parent_id) VALUES ('x', 'project', 100)",
        ),
        (
            "infos",
            "INSERT INTO infos (body, parent_type, parent_id) VALUES ('x', 'tag', 101)",
        ),
        (
            "flows",
            "INSERT INTO flows (title, instance_type, parent_type, parent_id)
             VALUES ('x', 'task', 'aspect', 1)",
        ),
    ] {
        assert!(
            sqlx::query(insert).execute(&pool).await.is_err(),
            "{table} refuses an old spelling"
        );
    }
}
