//! Fan-in remapping: the dependents-vs-blockers asymmetry.
//!
//! [`start`]'s fan-in loop skips every **dependent** instance that is not a task ("only tasks can
//! be dependents in the real model") but applies **no** such filter to blockers — a goal instance
//! is a perfectly good blocker and yields a `Dependency::Goal` edge.
//!
//! `tests/flows.rs` covers only the task→task case, where the two sides are indistinguishable. A
//! port that filtered blockers instead of dependents, or both sides, or neither, would still pass
//! it. These tests pin the asymmetry itself, so the split of the remapping into a pure renderer is
//! verifiable. They are deliberately in their own binary, leaving `tests/flows.rs` byte-identical
//! as the refactor's frozen behavioural contract.

use crate::helpers;

use arlesh_lib::flows::{
    model::{
        CreateFlowItemRequest, CreateFlowRequest, FlowCycleInput, FlowId, FlowItemType,
        InstanceType, StartFlowRequest,
    },
    start,
};

/// A flow over a 2-week window, parented under the seeded aspect 1.
fn create_req(title: &str, instance_type: InstanceType) -> CreateFlowRequest {
    CreateFlowRequest {
        title: title.into(),
        instance_type: Some(instance_type),
        parent_type: "aspect".into(),
        parent_id: 1,
        flow_duration_n: Some(2),
        flow_duration_kind: Some("week".into()),
        ..Default::default()
    }
}

fn day_cycle(index: i64) -> FlowCycleInput {
    FlowCycleInput {
        scope_kind: Some("day".into()),
        scope_index: Some(index),
        ..Default::default()
    }
}

/// The real nodes materialised from one template item, in creation order.
async fn nodes_from(
    pool: &sqlx::SqlitePool,
    item_type: FlowItemType,
    item_id: i64,
) -> Vec<(String, i64)> {
    sqlx::query_as::<_, (String, i64)>(
        "SELECT node_type, node_id FROM flow_instance_nodes
         WHERE source_item_type = ? AND source_item_id = ? ORDER BY rowid",
    )
    .bind(item_type.as_str())
    .bind(item_id)
    .fetch_all(pool)
    .await
    .expect("node lookup")
}

/// Every materialised dependency edge, as `(task_id, dependency_type, dependency_id)`.
async fn edges(pool: &sqlx::SqlitePool) -> Vec<(i64, String, i64)> {
    sqlx::query_as::<_, (i64, String, i64)>(
        "SELECT task_id, dependency_type, dependency_id FROM task_dependencies
         ORDER BY task_id, dependency_type, dependency_id",
    )
    .fetch_all(pool)
    .await
    .expect("edge lookup")
}

/// A **goal-instance** flow (so that goal items may hang directly off the root — `goals.parent_type`
/// forbids a `task` parent) whose fan-in exercises both sides of the asymmetry at once:
///
/// * `Build` (task, two cycle pairs → two instances) depends on `Approve` (**goal**, one instance)
///   — a goal blocker under a task dependent, which **must** yield two `goal`-typed edges.
/// * `Design` (**goal**) depends on `Spec` (task) — a goal dependent, which **must** yield none.
///
/// The two dependencies are deliberately balanced so that a port filtering the *wrong* side still
/// produces a plausible edge count; only the per-edge assertions below distinguish them.
#[tokio::test]
async fn fan_in_filters_dependents_to_tasks_but_never_filters_blockers() {
    let pool = helpers::test_pool().await;
    let flow = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .flows()
        .create(create_req("Asymmetry", InstanceType::Goal))
        .await
        .unwrap();

    let item = |title: &str| CreateFlowItemRequest {
        flow_id: flow.id,
        title: title.into(),
        parent_type: "flow".into(),
        parent_id: flow.id,
    };

    let build = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .flows()
        .create_task(item("Build"))
        .await
        .unwrap();
    let spec = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .flows()
        .create_task(item("Spec"))
        .await
        .unwrap();
    let approve = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .flows()
        .create_goal(item("Approve"))
        .await
        .unwrap();
    let design = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .flows()
        .create_goal(item("Design"))
        .await
        .unwrap();

    // Build runs twice (days 5 and 9); everything else once.
    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        db.flows()
            .set_cycles(
                flow.id,
                FlowItemType::FlowTask,
                build.id,
                &[day_cycle(5), day_cycle(9)],
            )
            .await
            .unwrap();
        db.commit().await.unwrap();
    }

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        // Task dependent, GOAL blocker — the case with no coverage in tests/flows.rs.
        db.flows()
            .add_dependency(
                flow.id,
                FlowItemType::FlowTask,
                build.id,
                FlowItemType::FlowGoal,
                approve.id,
            )
            .await
            .unwrap();
        // GOAL dependent, task blocker — must be skipped entirely.
        db.flows()
            .add_dependency(
                flow.id,
                FlowItemType::FlowGoal,
                design.id,
                FlowItemType::FlowTask,
                spec.id,
            )
            .await
            .unwrap();
        db.commit().await.unwrap();
    }

    let anchor = chrono::NaiveDate::from_ymd_opt(2026, 1, 5).unwrap();
    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        start(
            &mut db,
            FlowId(flow.id),
            StartFlowRequest {
                title: "Run".into(),
                target_type: "aspect".into(),
                target_id: 1,
                anchor_date: anchor,
            },
        )
        .await
        .unwrap();
        db.commit().await.unwrap();
    }

    let builds = nodes_from(&pool, FlowItemType::FlowTask, build.id).await;
    let approves = nodes_from(&pool, FlowItemType::FlowGoal, approve.id).await;
    let designs = nodes_from(&pool, FlowItemType::FlowGoal, design.id).await;
    let specs = nodes_from(&pool, FlowItemType::FlowTask, spec.id).await;
    assert_eq!(
        builds.len(),
        2,
        "Build has two cycle pairs, so two instances"
    );
    assert_eq!(approves.len(), 1);
    assert_eq!(designs.len(), 1);
    assert_eq!(specs.len(), 1);
    assert!(builds.iter().all(|(kind, _)| kind == "task"));
    assert_eq!(approves[0].0, "goal");
    assert_eq!(designs[0].0, "goal");

    let mut expected: Vec<(i64, String, i64)> = builds
        .iter()
        // The blocker is a GOAL instance, so the edge must be `Dependency::Goal`, not `::Task`.
        .map(|(_, build_node)| (*build_node, "goal".to_string(), approves[0].1))
        .collect();
    expected.sort();

    // Exactly these two edges: the goal blocker fans in to both Build instances, and the goal
    // dependent `Design` contributes nothing despite having a perfectly good task blocker.
    assert_eq!(edges(&pool).await, expected);

    // Stated separately, because the count alone is symmetric under a wrong-side filter.
    let design_edges: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM task_dependencies WHERE dependency_id = ?")
            .bind(specs[0].1)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(design_edges, 0, "a goal dependent yields no edges at all");
}

/// The fan-in is a **cross product**, not a zip: three dependent instances over two blocker
/// instances give six edges. The 1x2 case in `tests/flows.rs` cannot tell the two apart.
#[tokio::test]
async fn fan_in_is_a_cross_product_of_dependent_and_blocker_instances() {
    let pool = helpers::test_pool().await;
    let flow = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .flows()
        .create(create_req("Cross", InstanceType::Task))
        .await
        .unwrap();

    let item = |title: &str| CreateFlowItemRequest {
        flow_id: flow.id,
        title: title.into(),
        parent_type: "flow".into(),
        parent_id: flow.id,
    };
    let dependent = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .flows()
        .create_task(item("Dependent"))
        .await
        .unwrap();
    let blocker = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .flows()
        .create_task(item("Blocker"))
        .await
        .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        db.flows()
            .set_cycles(
                flow.id,
                FlowItemType::FlowTask,
                dependent.id,
                &[day_cycle(3), day_cycle(5), day_cycle(7)],
            )
            .await
            .unwrap();
        db.flows()
            .set_cycles(
                flow.id,
                FlowItemType::FlowTask,
                blocker.id,
                &[day_cycle(1), day_cycle(2)],
            )
            .await
            .unwrap();
        db.flows()
            .add_dependency(
                flow.id,
                FlowItemType::FlowTask,
                dependent.id,
                FlowItemType::FlowTask,
                blocker.id,
            )
            .await
            .unwrap();
        db.commit().await.unwrap();
    }

    let anchor = chrono::NaiveDate::from_ymd_opt(2026, 1, 5).unwrap();
    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        start(
            &mut db,
            FlowId(flow.id),
            StartFlowRequest {
                title: "Run".into(),
                target_type: "aspect".into(),
                target_id: 1,
                anchor_date: anchor,
            },
        )
        .await
        .unwrap();
        db.commit().await.unwrap();
    }

    let dependents = nodes_from(&pool, FlowItemType::FlowTask, dependent.id).await;
    let blockers = nodes_from(&pool, FlowItemType::FlowTask, blocker.id).await;
    assert_eq!(dependents.len(), 3);
    assert_eq!(blockers.len(), 2);

    let mut expected: Vec<(i64, String, i64)> = Vec::new();
    for (_, dependent_node) in &dependents {
        for (_, blocker_node) in &blockers {
            expected.push((*dependent_node, "task".to_string(), *blocker_node));
        }
    }
    expected.sort();
    assert_eq!(expected.len(), 6, "3 x 2 is a cross product, not a zip");
    assert_eq!(edges(&pool).await, expected);
}

/// A dependency belonging to **another** flow is ignored, and one naming an item with no
/// instances yields nothing rather than panicking.
#[tokio::test]
async fn fan_in_ignores_other_flows_and_items_without_instances() {
    let pool = helpers::test_pool().await;
    let factory = || helpers::session_factory(&pool);
    let flow = factory()
        .connect()
        .await
        .unwrap()
        .flows()
        .create(create_req("Started", InstanceType::Task))
        .await
        .unwrap();
    let other = factory()
        .connect()
        .await
        .unwrap()
        .flows()
        .create(create_req("Other", InstanceType::Task))
        .await
        .unwrap();

    let started_task = factory()
        .connect()
        .await
        .unwrap()
        .flows()
        .create_task(CreateFlowItemRequest {
            flow_id: flow.id,
            title: "Work".into(),
            parent_type: "flow".into(),
            parent_id: flow.id,
        })
        .await
        .unwrap();
    // An orphan: its parent chain never reaches "flow", so the traversal never materialises it.
    let orphan = factory()
        .connect()
        .await
        .unwrap()
        .flows()
        .create_task(CreateFlowItemRequest {
            flow_id: flow.id,
            title: "Orphan".into(),
            parent_type: "flow_task".into(),
            parent_id: 9_999,
        })
        .await
        .unwrap();
    let other_task = factory()
        .connect()
        .await
        .unwrap()
        .flows()
        .create_task(CreateFlowItemRequest {
            flow_id: other.id,
            title: "Elsewhere".into(),
            parent_type: "flow".into(),
            parent_id: other.id,
        })
        .await
        .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        // Blocker has no instances — `unwrap_or_default()`, so no edges and no panic.
        db.flows()
            .add_dependency(
                flow.id,
                FlowItemType::FlowTask,
                started_task.id,
                FlowItemType::FlowTask,
                orphan.id,
            )
            .await
            .unwrap();
        // Belongs to a different flow — filtered out by `d.flow_id == flow_id`.
        db.flows()
            .add_dependency(
                other.id,
                FlowItemType::FlowTask,
                other_task.id,
                FlowItemType::FlowTask,
                other_task.id,
            )
            .await
            .unwrap();
        db.commit().await.unwrap();
    }

    let anchor = chrono::NaiveDate::from_ymd_opt(2026, 1, 5).unwrap();
    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        start(
            &mut db,
            FlowId(flow.id),
            StartFlowRequest {
                title: "Run".into(),
                target_type: "aspect".into(),
                target_id: 1,
                anchor_date: anchor,
            },
        )
        .await
        .unwrap();
        db.commit().await.unwrap();
    }

    assert!(edges(&pool).await.is_empty());
    // The orphan is never materialised, so the run has only the root and `Work`.
    let nodes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM flow_instance_nodes")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(nodes, 2);
}
