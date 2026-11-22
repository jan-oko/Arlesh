//! Reading a Habit from what a board load already holds gives what reading it alone gives.

use super::*;
use crate::database::session::SessionFactory;
use crate::database::DatabasePool;
use crate::nodes::id::tid;
use sqlx::sqlite::SqlitePoolOptions;

async fn scratch_pool() -> DatabasePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("open");
    crate::database::run_migrations(&pool)
        .await
        .expect("migrations");
    sqlx::query("PRAGMA foreign_keys = OFF")
        .execute(&pool)
        .await
        .expect("pragma");
    pool
}

async fn run(pool: &DatabasePool, sql: &str, binds: &[&str]) {
    let mut query = sqlx::query(sql);
    for bind in binds {
        query = query.bind(*bind);
    }
    query.execute(pool).await.expect(sql);
}

/// Two Habits, so that one Habit's rows must not leak into the other's: items of every kind,
/// cycle pairs, a template edge, an edge an occurrence removed, and template tags.
async fn seeded() -> SessionFactory {
    let pool = scratch_pool().await;
    for (flow, instance_type) in [(1, "task"), (2, "commitment")] {
        let id = tid(flow).to_string();
        run(
            &pool,
            "INSERT INTO flows (id, title, instance_type, parent_type, parent_id)
             VALUES (?, 'habit', ?, 'domain', ?)",
            &[&id, instance_type, &tid(90).to_string()],
        )
        .await;
        run(
            &pool,
            "INSERT INTO flow_recurrences (flow_id, start_scope_id, clock, miss_policy)
             VALUES (?, '{\"kind\":\"week\",\"date\":\"2026-06-28\"}', 'window', 'overdue')",
            &[&id],
        )
        .await;
    }
    for (item, flow, table) in [
        (10, 1, "flow_tasks"),
        (11, 1, "flow_tasks"),
        (12, 2, "flow_tasks"),
        (13, 1, "flow_goals"),
        (14, 1, "flow_commitments"),
        (15, 1, "flow_expectations"),
    ] {
        run(
            &pool,
            &format!(
                "INSERT INTO {table} (id, flow_id, title, parent_type, parent_id)
                 VALUES (?, ?, 'item', 'flow', ?)"
            ),
            &[
                &tid(item).to_string(),
                &tid(flow).to_string(),
                &tid(flow).to_string(),
            ],
        )
        .await;
    }
    for (item, tag) in [(10, 5), (10, 4), (12, 6), (13, 7)] {
        let table = if item == 13 { "flow_goal" } else { "flow_task" };
        run(
            &pool,
            "INSERT INTO template_tags (item_type, item_id, tag_id) VALUES (?, ?, ?)",
            &[table, &tid(item).to_string(), &tid(tag).to_string()],
        )
        .await;
    }
    for (flow, item) in [(1, 10), (1, 10), (2, 12)] {
        run(
            &pool,
            "INSERT INTO flow_item_cycles (flow_id, item_type, item_id, position)
             VALUES (?, 'flow_task', ?, (SELECT COUNT(*) FROM flow_item_cycles))",
            &[&tid(flow).to_string(), &tid(item).to_string()],
        )
        .await;
    }
    for (flow, dependent, depends_on) in [(1, 10, 11), (2, 12, 12)] {
        run(
            &pool,
            "INSERT INTO flow_dependencies
                (flow_id, dependent_type, dependent_id, depends_on_type, depends_on_id)
             VALUES (?, 'flow_task', ?, 'flow_task', ?)",
            &[
                &tid(flow).to_string(),
                &tid(dependent).to_string(),
                &tid(depends_on).to_string(),
            ],
        )
        .await;
    }
    run(
        &pool,
        "INSERT INTO derived_dependencies (flow_id, dependent_key, target_type, target_key, added)
         VALUES (?, 'a', 'task', 'b', 0)",
        &[&tid(1).to_string()],
    )
    .await;
    SessionFactory::new(pool)
}

#[tokio::test]
async fn a_habit_read_from_the_shared_lists_equals_the_habit_read_alone() {
    let factory = seeded().await;
    let mut db = factory.begin_read().await.expect("session");
    let flows = db.flows().list().await.expect("flows");
    let goals = db.flows().list_all_goals().await.expect("goals");
    let tasks = db.flows().list_all_tasks().await.expect("tasks");
    let commitments = db.flows().list_commitment_items(None).await.expect("c");
    let expectations = db.flows().list_expectation_items(None).await.expect("e");
    let cycles = db.flows().list_all_cycles().await.expect("cycles");
    let dependencies = db.flows().list_all_dependencies().await.expect("deps");
    let shared = HabitShared::read(
        &mut db,
        FlowLists {
            goals: &goals,
            tasks: &tasks,
            commitments: &commitments,
            expectations: &expectations,
            cycles: &cycles,
            dependencies: &dependencies,
        },
    )
    .await
    .expect("shared");

    for flow in &flows {
        let alone = read_habit(&mut db, flow, None).await.expect("alone");
        let among = read_habit(&mut db, flow, Some(&shared))
            .await
            .expect("shared read");
        match (alone, among) {
            (None, None) => {}
            (Some(alone), Some(among)) => {
                assert_eq!(alone.template.goals, among.template.goals);
                assert_eq!(alone.template.tasks, among.template.tasks);
                assert_eq!(alone.template.commitments, among.template.commitments);
                assert_eq!(alone.template.expectations, among.template.expectations);
                assert_eq!(alone.template.cycles, among.template.cycles);
                assert_eq!(
                    alone.relations.template_edges,
                    among.relations.template_edges
                );
                assert_eq!(alone.relations.removed_edges, among.relations.removed_edges);
                assert_eq!(alone.last_checks, among.last_checks);
                assert_eq!(alone.instance_items, among.instance_items);
            }
            _ => panic!("one read drew the Habit and the other did not"),
        }
    }
    // The seed gives each Habit something of its own, so the comparison is not vacuous.
    let first = read_habit(&mut db, &flows[0], Some(&shared))
        .await
        .expect("read")
        .expect("a Habit");
    assert_eq!(first.relations.template_edges.len(), 1);
    assert_eq!(first.relations.removed_edges.len(), 1);
}
