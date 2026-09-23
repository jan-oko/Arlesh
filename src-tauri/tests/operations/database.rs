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

/// Migration `0025` clears the Target Node of every flow that already points at its own parent, so
/// that the parent default lives in the read path instead of in a column a move would leave behind.
///
/// The comparison is on the **normalised node id**: aspects, projects, domains and tags share one
/// `domains` table, so a flow can name the very same row `project` as a parent and `domain` as a
/// target — 8 of the 15 flows on the author's board do. A flow pointed at anything else keeps the
/// target it was given.
#[tokio::test]
async fn migration_0025_clears_a_target_that_is_already_the_parent() {
    let pool = helpers::test_pool().await;
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
