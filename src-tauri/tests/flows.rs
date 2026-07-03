mod helpers;

use arlesh_lib::flows::{
    model::{
        CreateFlowItemRequest, CreateFlowRequest, FlowCycleInput, FlowId, FlowItemType,
        InstanceType, StartFlowRequest, TargetRef, UpdateFlowItemRequest, UpdateFlowRequest,
    },
    FlowRepository,
};
use arlesh_lib::scopes::{model::ScopeKind, ScopeRepository};
use arlesh_lib::tasks::{
    model::{CreateGoalRequest, TimeScope},
    GoalRepository,
};

/// Creates a goal under aspect 1 whose Time Scope is the single canonical scope of `kind` covering
/// `date`, returning its id. Used to give target candidates a concrete window to contain (or not).
async fn scoped_goal(pool: &sqlx::SqlitePool, kind: ScopeKind, date: chrono::NaiveDate) -> i64 {
    let scope = ScopeRepository::new(pool).get_or_create(kind, date).await.unwrap();
    GoalRepository::new(pool)
        .create(CreateGoalRequest {
            title: "Scoped".into(),
            parent_type: "domain".into(),
            parent_id: 1,
            status: None,
            time_scope: Some(TimeScope { start_id: scope.id, end_id: scope.id, duration: None }),
        })
        .await
        .unwrap()
        .id
}

fn day_cycle(index: i64) -> FlowCycleInput {
    FlowCycleInput { scope_kind: Some("day".into()), scope_index: Some(index), ..Default::default() }
}

// Flows are parented under a seeded aspect (ids 1-6 exist from the initial migration).
fn create_req(title: &str) -> CreateFlowRequest {
    CreateFlowRequest {
        title: title.into(),
        instance_type: Some(InstanceType::Task),
        parent_type: "aspect".into(),
        parent_id: 1,
        flow_duration_n: Some(2),
        flow_duration_kind: Some("week".into()),
        ..Default::default()
    }
}

#[tokio::test]
async fn create_and_get_flow() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);

    let flow = repo.create(create_req("Add Feature")).await.unwrap();
    assert_eq!(flow.title, "Add Feature");
    assert_eq!(flow.instance_type, "task");
    assert_eq!(flow.parent_type, "aspect");
    assert_eq!(flow.flow_duration_n, Some(2));
    assert_eq!(flow.flow_duration_kind.as_deref(), Some("week"));

    let fetched = repo.get(FlowId(flow.id)).await.unwrap();
    assert_eq!(fetched.id, flow.id);
}

#[tokio::test]
async fn instance_type_defaults_to_task() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo
        .create(CreateFlowRequest { title: "F".into(), parent_type: "aspect".into(), parent_id: 1, ..Default::default() })
        .await
        .unwrap();
    assert_eq!(flow.instance_type, "task");
}

#[tokio::test]
async fn update_flow_changes_fields() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo.create(create_req("Draft")).await.unwrap();

    let updated = repo
        .update(
            FlowId(flow.id),
            UpdateFlowRequest {
                title: Some("Renamed".into()),
                instance_type: Some(InstanceType::Goal),
                target_type: Some(Some("domain".into())),
                target_id: Some(Some(3)),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(updated.title, "Renamed");
    assert_eq!(updated.instance_type, "goal");
    assert_eq!(updated.target_type.as_deref(), Some("domain"));
    assert_eq!(updated.target_id, Some(3));
}

#[tokio::test]
async fn flow_items_are_created_and_listed() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo.create(create_req("Feature")).await.unwrap();

    let specify = repo
        .create_task(CreateFlowItemRequest {
            flow_id: flow.id,
            title: "Specify".into(),
            parent_type: "flow".into(),
            parent_id: flow.id,
        })
        .await
        .unwrap();
    assert_eq!(specify.flow_id, flow.id);

    repo.create_goal(CreateFlowItemRequest {
        flow_id: flow.id,
        title: "Milestone".into(),
        parent_type: "flow".into(),
        parent_id: flow.id,
    })
    .await
    .unwrap();

    let tasks = repo.list_tasks(FlowId(flow.id)).await.unwrap();
    let goals = repo.list_goals(FlowId(flow.id)).await.unwrap();
    assert_eq!(tasks.len(), 1);
    assert_eq!(goals.len(), 1);
}

#[tokio::test]
async fn update_flow_item_changes_fields() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo.create(create_req("Feature")).await.unwrap();
    let task = repo
        .create_task(CreateFlowItemRequest {
            flow_id: flow.id,
            title: "Draft".into(),
            parent_type: "flow".into(),
            parent_id: flow.id,
        })
        .await
        .unwrap();

    let updated = repo
        .update_task(
            task.id,
            UpdateFlowItemRequest {
                title: Some("Implement".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(updated.title, "Implement");
}

#[tokio::test]
async fn set_cycles_replaces_prior_pairs() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo.create(create_req("Feature")).await.unwrap();
    let task = repo
        .create_task(CreateFlowItemRequest {
            flow_id: flow.id,
            title: "Exercise".into(),
            parent_type: "flow".into(),
            parent_id: flow.id,
        })
        .await
        .unwrap();

    // Sunday & Tuesday, each morning → two pairs.
    repo.set_cycles(
        flow.id,
        FlowItemType::FlowTask,
        task.id,
        &[
            FlowCycleInput { scope_kind: Some("day".into()), scope_index: Some(1), plan_kind: Some("part_of_day".into()), plan_start: Some(1), plan_end: Some(1) },
            FlowCycleInput { scope_kind: Some("day".into()), scope_index: Some(3), plan_kind: Some("part_of_day".into()), plan_start: Some(1), plan_end: Some(1) },
        ],
    )
    .await
    .unwrap();

    let cycles = repo.list_all_cycles().await.unwrap();
    assert_eq!(cycles.len(), 2);
    assert_eq!(cycles[0].scope_index, Some(1));
    assert_eq!(cycles[1].scope_index, Some(3));

    // Replacing with a single whole-scope pair drops the previous two.
    repo.set_cycles(flow.id, FlowItemType::FlowTask, task.id, &[FlowCycleInput::default()])
        .await
        .unwrap();
    let cycles = repo.list_all_cycles().await.unwrap();
    assert_eq!(cycles.len(), 1);
    assert_eq!(cycles[0].scope_kind, None);
}

#[tokio::test]
async fn dependencies_add_dedupe_and_remove() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo.create(create_req("Feature")).await.unwrap();
    let specify = repo
        .create_task(CreateFlowItemRequest { flow_id: flow.id, title: "Specify".into(), parent_type: "flow".into(), parent_id: flow.id })
        .await
        .unwrap();
    let implement = repo
        .create_task(CreateFlowItemRequest { flow_id: flow.id, title: "Implement".into(), parent_type: "flow".into(), parent_id: flow.id })
        .await
        .unwrap();

    repo.add_dependency(flow.id, FlowItemType::FlowTask, implement.id, FlowItemType::FlowTask, specify.id).await.unwrap();
    // Adding the same edge again is idempotent.
    repo.add_dependency(flow.id, FlowItemType::FlowTask, implement.id, FlowItemType::FlowTask, specify.id).await.unwrap();
    assert_eq!(repo.list_all_dependencies().await.unwrap().len(), 1);

    repo.remove_dependency(FlowItemType::FlowTask, implement.id, FlowItemType::FlowTask, specify.id).await.unwrap();
    assert!(repo.list_all_dependencies().await.unwrap().is_empty());
}

#[tokio::test]
async fn converting_an_item_preserves_cycles_deps_and_children() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo.create(create_req("Feature")).await.unwrap();

    // A goal item with a cycle, a dependency (as blocker), and a task child.
    let goal = repo
        .create_goal(CreateFlowItemRequest { flow_id: flow.id, title: "Milestone".into(), parent_type: "flow".into(), parent_id: flow.id })
        .await
        .unwrap();
    let dependent = repo
        .create_task(CreateFlowItemRequest { flow_id: flow.id, title: "After".into(), parent_type: "flow".into(), parent_id: flow.id })
        .await
        .unwrap();
    let child = repo
        .create_task(CreateFlowItemRequest { flow_id: flow.id, title: "Sub".into(), parent_type: "flow_goal".into(), parent_id: goal.id })
        .await
        .unwrap();
    repo.set_cycles(flow.id, FlowItemType::FlowGoal, goal.id, &[FlowCycleInput { scope_kind: Some("day".into()), scope_index: Some(2), ..Default::default() }])
        .await
        .unwrap();
    repo.add_dependency(flow.id, FlowItemType::FlowTask, dependent.id, FlowItemType::FlowGoal, goal.id)
        .await
        .unwrap();

    let new_id = repo
        .convert_item(FlowItemType::FlowGoal, goal.id, FlowItemType::FlowTask)
        .await
        .unwrap();

    // The goal is gone; a task took its place.
    assert!(repo.list_all_goals().await.unwrap().iter().all(|g| g.id != goal.id));
    let new_task = repo.list_all_tasks().await.unwrap().into_iter().find(|t| t.id == new_id).unwrap();
    assert_eq!(new_task.title, "Milestone");

    // The cycle followed the item to the tasks table.
    let cycles = repo.list_all_cycles().await.unwrap();
    assert_eq!(cycles.len(), 1);
    assert_eq!(cycles[0].item_type, "flow_task");
    assert_eq!(cycles[0].item_id, new_id);

    // The dependency now points at the new task.
    let deps = repo.list_all_dependencies().await.unwrap();
    assert_eq!(deps.len(), 1);
    assert_eq!(deps[0].depends_on_type, "flow_task");
    assert_eq!(deps[0].depends_on_id, new_id);

    // The task child was reparented onto the new task.
    let reparented = repo.list_all_tasks().await.unwrap().into_iter().find(|t| t.id == child.id).unwrap();
    assert_eq!(reparented.parent_type, "flow_task");
    assert_eq!(reparented.parent_id, new_id);
}

#[tokio::test]
async fn deleting_an_item_clears_its_cycles_and_dependencies() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo.create(create_req("Feature")).await.unwrap();
    let a = repo.create_task(CreateFlowItemRequest { flow_id: flow.id, title: "A".into(), parent_type: "flow".into(), parent_id: flow.id }).await.unwrap();
    let b = repo.create_task(CreateFlowItemRequest { flow_id: flow.id, title: "B".into(), parent_type: "flow".into(), parent_id: flow.id }).await.unwrap();
    repo.set_cycles(flow.id, FlowItemType::FlowTask, a.id, &[FlowCycleInput::default()]).await.unwrap();
    repo.add_dependency(flow.id, FlowItemType::FlowTask, b.id, FlowItemType::FlowTask, a.id).await.unwrap();

    repo.delete_item(FlowItemType::FlowTask, a.id).await.unwrap();

    // A's cycle is gone, and the dependency that referenced A (as the blocker) is gone too.
    assert!(repo.list_all_cycles().await.unwrap().is_empty());
    assert!(repo.list_all_dependencies().await.unwrap().is_empty());
    assert_eq!(repo.list_all_tasks().await.unwrap().len(), 1);
}

#[tokio::test]
async fn starting_a_flow_materialises_a_subtree_with_fan_in_deps() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo.create(create_req("Feature")).await.unwrap(); // task instance, 2-week scope
    let specify = repo
        .create_task(CreateFlowItemRequest { flow_id: flow.id, title: "Specify".into(), parent_type: "flow".into(), parent_id: flow.id })
        .await
        .unwrap();
    let implement = repo
        .create_task(CreateFlowItemRequest { flow_id: flow.id, title: "Implement".into(), parent_type: "flow".into(), parent_id: flow.id })
        .await
        .unwrap();
    // Specify runs once (day 1); Implement twice (day 3 and day 10) → two instances.
    repo.set_cycles(flow.id, FlowItemType::FlowTask, specify.id, &[day_cycle(1)]).await.unwrap();
    repo.set_cycles(flow.id, FlowItemType::FlowTask, implement.id, &[day_cycle(3), day_cycle(10)]).await.unwrap();
    repo.add_dependency(flow.id, FlowItemType::FlowTask, implement.id, FlowItemType::FlowTask, specify.id).await.unwrap();

    let anchor = chrono::NaiveDate::from_ymd_opt(2026, 1, 5).unwrap();
    let result = repo
        .start(FlowId(flow.id), StartFlowRequest { title: "Feature Run".into(), target_type: "aspect".into(), target_id: 1, anchor_date: anchor })
        .await
        .unwrap();
    assert_eq!(result.root_type, "task");

    // Root + Specify(1) + Implement(2) = 4 real tasks.
    let tasks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tasks").fetch_one(&pool).await.unwrap();
    assert_eq!(tasks, 4);
    // Fan-in: both Implement instances wait on the single Specify instance → 2 edges.
    let deps: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM task_dependencies").fetch_one(&pool).await.unwrap();
    assert_eq!(deps, 2);
    // One run recorded, tracking all four nodes.
    let instances: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM flow_instances").fetch_one(&pool).await.unwrap();
    assert_eq!(instances, 1);
    let nodes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM flow_instance_nodes").fetch_one(&pool).await.unwrap();
    assert_eq!(nodes, 4);
    // The root carries the resolved 2-week window.
    let scoped_root: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tasks WHERE id = ? AND time_scope_start_id IS NOT NULL")
        .bind(result.root_id).fetch_one(&pool).await.unwrap();
    assert_eq!(scoped_root, 1);
}

#[tokio::test]
async fn starting_an_unscoped_flow_materialises_one_item_each() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo
        .create(CreateFlowRequest { title: "Chores".into(), instance_type: Some(InstanceType::Task), parent_type: "aspect".into(), parent_id: 1, ..Default::default() })
        .await
        .unwrap(); // no flow scope
    repo.create_task(CreateFlowItemRequest { flow_id: flow.id, title: "A".into(), parent_type: "flow".into(), parent_id: flow.id }).await.unwrap();
    repo.create_task(CreateFlowItemRequest { flow_id: flow.id, title: "B".into(), parent_type: "flow".into(), parent_id: flow.id }).await.unwrap();

    let anchor = chrono::NaiveDate::from_ymd_opt(2026, 1, 5).unwrap();
    repo.start(FlowId(flow.id), StartFlowRequest { title: "Chores Run".into(), target_type: "aspect".into(), target_id: 1, anchor_date: anchor }).await.unwrap();

    // Root + A + B = 3 tasks, none scoped (unscoped flow).
    let tasks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tasks").fetch_one(&pool).await.unwrap();
    assert_eq!(tasks, 3);
    let scoped: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tasks WHERE time_scope_start_id IS NOT NULL").fetch_one(&pool).await.unwrap();
    assert_eq!(scoped, 0);
}

#[tokio::test]
async fn deleting_a_flow_cascades_to_its_items() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo.create(create_req("Doomed")).await.unwrap();
    repo.create_task(CreateFlowItemRequest {
        flow_id: flow.id,
        title: "T".into(),
        parent_type: "flow".into(),
        parent_id: flow.id,
    })
    .await
    .unwrap();

    repo.delete(FlowId(flow.id)).await.unwrap();

    assert!(repo.get(FlowId(flow.id)).await.is_err());
    assert!(repo.list_tasks(FlowId(flow.id)).await.unwrap().is_empty());
}

// --- Phase 7.5: target scope-validity + flow-origin lookup ---

#[tokio::test]
async fn valid_targets_unscoped_flow_accepts_every_candidate() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let july1 = chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap();
    let goal = scoped_goal(&pool, ScopeKind::Day, july1).await; // even a day-scoped node passes
    let cands = vec![
        TargetRef { node_type: "aspect".into(), node_id: 1 },
        TargetRef { node_type: "goal".into(), node_id: goal },
    ];

    // An Unscoped flow imposes no window, so no target is filtered out.
    let valid = repo.valid_targets(None, None, cands.clone()).await.unwrap();
    assert_eq!(valid, cands);
}

#[tokio::test]
async fn valid_targets_concrete_anchor_filters_by_interval_containment() {
    let pool = helpers::test_pool().await;
    let july1 = chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap();
    let week_goal = scoped_goal(&pool, ScopeKind::Week, july1).await;
    let repo = FlowRepository::new(&pool);
    let cands = vec![
        TargetRef { node_type: "goal".into(), node_id: week_goal },
        TargetRef { node_type: "aspect".into(), node_id: 1 }, // unscoped ancestor → always valid
    ];

    // A 1-week flow anchored inside the goal's week fits → both candidates valid.
    let inside = repo
        .valid_targets(Some((1, "week".into())), Some(july1), cands.clone())
        .await
        .unwrap();
    assert_eq!(inside.len(), 2);

    // Anchored in a different week, the goal can no longer contain the window → only the aspect.
    let other_week = chrono::NaiveDate::from_ymd_opt(2026, 7, 15).unwrap();
    let outside = repo
        .valid_targets(Some((1, "week".into())), Some(other_week), cands)
        .await
        .unwrap();
    assert_eq!(outside, vec![TargetRef { node_type: "aspect".into(), node_id: 1 }]);
}

#[tokio::test]
async fn valid_targets_without_anchor_applies_coarse_length_filter() {
    let pool = helpers::test_pool().await;
    let july1 = chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap();
    let week_goal = scoped_goal(&pool, ScopeKind::Week, july1).await;
    let season_goal = scoped_goal(&pool, ScopeKind::Season, july1).await;
    let repo = FlowRepository::new(&pool);
    let cands = vec![
        TargetRef { node_type: "goal".into(), node_id: week_goal },
        TargetRef { node_type: "goal".into(), node_id: season_goal },
    ];

    // A 2-week flow with no anchor: a single week can never hold it; a season always can.
    let valid = repo
        .valid_targets(Some((2, "week".into())), None, cands)
        .await
        .unwrap();
    assert_eq!(valid, vec![TargetRef { node_type: "goal".into(), node_id: season_goal }]);
}

#[tokio::test]
async fn origins_reports_the_flow_title_for_materialised_nodes_only() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo.create(create_req("Feature")).await.unwrap();
    repo.create_task(CreateFlowItemRequest { flow_id: flow.id, title: "Specify".into(), parent_type: "flow".into(), parent_id: flow.id })
        .await
        .unwrap();
    let anchor = chrono::NaiveDate::from_ymd_opt(2026, 1, 5).unwrap();
    let result = repo
        .start(FlowId(flow.id), StartFlowRequest { title: "Run".into(), target_type: "aspect".into(), target_id: 1, anchor_date: anchor })
        .await
        .unwrap();

    let origins = repo
        .origins(vec![
            TargetRef { node_type: result.root_type.clone(), node_id: result.root_id },
            TargetRef { node_type: "task".into(), node_id: 999_999 }, // never materialised
        ])
        .await
        .unwrap();

    assert_eq!(origins.len(), 1);
    assert_eq!(origins[0].node_id, result.root_id);
    assert_eq!(origins[0].flow_title, "Feature");
}
