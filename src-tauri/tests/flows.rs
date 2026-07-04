mod helpers;

use arlesh_lib::flows::{
    model::{
        BlockingMode, CatchupPolicy, ConsumptionKind, CreateFlowItemRequest, CreateFlowRequest,
        FlowCycleInput, FlowId, FlowItemType, InstanceType, SetRecurrenceRequest, StartFlowRequest,
        TargetRef, UpdateFlowItemRequest, UpdateFlowRequest,
    },
    FlowRepository,
};
use arlesh_lib::scopes::{model::ScopeKind, ScopeRepository};
use arlesh_lib::tasks::{
    model::{CreateGoalRequest, CreateTaskRequest, Dependency, GoalId, OnScopeExit, TaskId, TimeScope},
    GoalRepository, TaskRepository,
};

/// Creates a goal under aspect 1 whose Time Scope is the single canonical scope of `kind` covering
/// `date`, returning its id. Used to give target candidates a concrete window to contain (or not).
async fn week_scope_id(pool: &sqlx::SqlitePool, date: chrono::NaiveDate) -> i64 {
    ScopeRepository::new(pool).get_or_create(ScopeKind::Week, date).await.unwrap().id
}

/// A minimal valid Recurrence: continuous (no gap), open-ended, Destructive.
fn destructive_recurrence(start_scope_id: i64) -> SetRecurrenceRequest {
    SetRecurrenceRequest {
        start_scope_id,
        gap_n: None,
        gap_kind: None,
        end_scope_id: None,
        consumption_kind: ConsumptionKind::Destructive,
        blocking_mode: None,
        catchup_policy: None,
    }
}

async fn scoped_goal(pool: &sqlx::SqlitePool, kind: ScopeKind, date: chrono::NaiveDate) -> i64 {
    let scope = ScopeRepository::new(pool).get_or_create(kind, date).await.unwrap();
    GoalRepository::new(pool)
        .create(CreateGoalRequest {
            title: "Scoped".into(),
            parent_type: "domain".into(),
            parent_id: 1,
            status: None,
            time_scope: Some(TimeScope { start_id: scope.id, end_id: scope.id, duration: None }),
            on_scope_exit: None,
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
async fn starting_a_task_flow_resolves_its_root_cycle_plan() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    // Task instance, 2-week window, root planned into days 2–3 of the window.
    let flow = repo
        .create(CreateFlowRequest {
            root_plan_kind: Some("day".into()),
            root_plan_start: Some(2),
            root_plan_end: Some(3),
            ..create_req("Feature")
        })
        .await
        .unwrap();

    let anchor = chrono::NaiveDate::from_ymd_opt(2026, 1, 5).unwrap();
    let result = repo
        .start(FlowId(flow.id), StartFlowRequest { title: "Run".into(), target_type: "aspect".into(), target_id: 1, anchor_date: anchor })
        .await
        .unwrap();

    // The root task's Plan resolves to days 2–3 of the window. The 2-week window starts at its week
    // scope (Sunday 2026-01-04), so day 2 = 2026-01-05 and day 3 = 2026-01-06.
    let (plan_start, plan_end): (Option<i64>, Option<i64>) =
        sqlx::query_as("SELECT plan_start_id, plan_end_id FROM tasks WHERE id = ?")
            .bind(result.root_id).fetch_one(&pool).await.unwrap();
    let start_date: String = sqlx::query_scalar("SELECT start_date FROM scopes WHERE id = ?")
        .bind(plan_start.unwrap()).fetch_one(&pool).await.unwrap();
    let end_date: String = sqlx::query_scalar("SELECT start_date FROM scopes WHERE id = ?")
        .bind(plan_end.unwrap()).fetch_one(&pool).await.unwrap();
    assert_eq!(start_date, "2026-01-05");
    assert_eq!(end_date, "2026-01-06");
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

// --- Phase 8.1: Recurrence (a flow becomes a Habit) ---

#[tokio::test]
async fn setting_a_recurrence_makes_a_flow_a_habit() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo.create(create_req("Exercise")).await.unwrap(); // week-scoped
    assert!(repo.get_recurrence(FlowId(flow.id)).await.unwrap().is_none());

    let start = week_scope_id(&pool, chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap()).await;
    let recurrence = repo
        .set_recurrence(
            FlowId(flow.id),
            SetRecurrenceRequest {
                start_scope_id: start,
                gap_n: Some(1),
                gap_kind: Some("week".into()),
                end_scope_id: None,
                consumption_kind: ConsumptionKind::Accumulating,
                blocking_mode: Some(BlockingMode::Blocking),
                catchup_policy: Some(CatchupPolicy::AllPending),
            },
        )
        .await
        .unwrap();
    assert_eq!(recurrence.start_scope_id, start);
    assert_eq!(recurrence.consumption_kind, "accumulating");
    assert_eq!(recurrence.blocking_mode.as_deref(), Some("blocking"));
    assert_eq!(recurrence.catchup_policy.as_deref(), Some("all_pending"));

    let fetched = repo.get_recurrence(FlowId(flow.id)).await.unwrap();
    assert!(fetched.is_some());
}

#[tokio::test]
async fn setting_a_recurrence_replaces_the_previous_one() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo.create(create_req("Exercise")).await.unwrap();
    let start = week_scope_id(&pool, chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap()).await;

    repo.set_recurrence(FlowId(flow.id), destructive_recurrence(start)).await.unwrap();
    repo.set_recurrence(
        FlowId(flow.id),
        SetRecurrenceRequest { consumption_kind: ConsumptionKind::Accumulating, blocking_mode: Some(BlockingMode::Overlapping), ..destructive_recurrence(start) },
    )
    .await
    .unwrap();

    let fetched = repo.get_recurrence(FlowId(flow.id)).await.unwrap().unwrap();
    assert_eq!(fetched.consumption_kind, "accumulating");
    assert_eq!(fetched.blocking_mode.as_deref(), Some("overlapping"));
}

#[tokio::test]
async fn deleting_a_recurrence_demotes_the_habit_back_to_a_plain_flow() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo.create(create_req("Exercise")).await.unwrap();
    let start = week_scope_id(&pool, chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap()).await;
    repo.set_recurrence(FlowId(flow.id), destructive_recurrence(start)).await.unwrap();

    repo.delete_recurrence(FlowId(flow.id)).await.unwrap();

    assert!(repo.get_recurrence(FlowId(flow.id)).await.unwrap().is_none());
}

#[tokio::test]
async fn a_recurrence_requires_a_scoped_flow() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo
        .create(CreateFlowRequest { title: "Chores".into(), parent_type: "aspect".into(), parent_id: 1, ..Default::default() })
        .await
        .unwrap(); // Unscoped
    let start = week_scope_id(&pool, chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap()).await;

    assert!(repo.set_recurrence(FlowId(flow.id), destructive_recurrence(start)).await.is_err());
}

#[tokio::test]
async fn a_gap_finer_than_the_habit_scope_is_rejected() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo.create(create_req("Exercise")).await.unwrap(); // week habit scope
    let start = week_scope_id(&pool, chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap()).await;

    let day_gap = SetRecurrenceRequest {
        gap_n: Some(3),
        gap_kind: Some("day".into()),
        ..destructive_recurrence(start)
    };
    assert!(repo.set_recurrence(FlowId(flow.id), day_gap).await.is_err());
}

#[tokio::test]
async fn generating_a_habit_derives_and_classifies_its_iterations() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    // A 1-week-window Destructive habit with a single item.
    let flow = repo
        .create(CreateFlowRequest {
            title: "Exercise".into(),
            instance_type: Some(InstanceType::Task),
            parent_type: "aspect".into(),
            parent_id: 1,
            flow_duration_n: Some(1),
            flow_duration_kind: Some("week".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    let _item = repo
        .create_task(CreateFlowItemRequest { flow_id: flow.id, title: "Workout".into(), parent_type: "flow".into(), parent_id: flow.id })
        .await
        .unwrap();
    let start = week_scope_id(&pool, chrono::NaiveDate::from_ymd_opt(2026, 1, 5).unwrap()).await;
    repo.set_recurrence(FlowId(flow.id), destructive_recurrence(start)).await.unwrap();

    // Resolve the first iteration (W0) — the root and its single item marked done in the start-week scope.
    repo.set_iteration_done(FlowId(flow.id), start, true, 1_767_600_000_000).await.unwrap();

    // now falls in W2 (2026-01-18..25): W0 done, W1 lapsed (passed unfinished), W2 active.
    let now = chrono::NaiveDate::from_ymd_opt(2026, 1, 22)
        .unwrap()
        .and_time(chrono::NaiveTime::MIN);
    let iterations = repo.generate_habit_iterations(FlowId(flow.id), now).await.unwrap();

    assert_eq!(iterations.len(), 3);
    assert_eq!(iterations[0].index, 0);
    assert_eq!(iterations[0].anchor_scope_id, start);
    assert_eq!(iterations[0].anchor_date, "2026-01-04"); // weeks snap to Sunday-start
    let kinds: Vec<_> = iterations.iter().map(|it| format!("{:?}", it.status)).collect();
    assert_eq!(kinds, vec!["Done", "Lapsed", "Active"]);
}

#[tokio::test]
async fn generating_iterations_requires_a_habit() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo.create(create_req("Plain")).await.unwrap(); // no recurrence
    let now = chrono::NaiveDate::from_ymd_opt(2026, 1, 22)
        .unwrap()
        .and_time(chrono::NaiveTime::MIN);
    assert!(repo.generate_habit_iterations(FlowId(flow.id), now).await.is_err());
}

#[tokio::test]
async fn an_inconsistent_consumption_tree_is_rejected() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo.create(create_req("Exercise")).await.unwrap();
    let start = week_scope_id(&pool, chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap()).await;

    // Destructive must not carry a blocking mode.
    let destructive_with_mode = SetRecurrenceRequest { blocking_mode: Some(BlockingMode::Blocking), ..destructive_recurrence(start) };
    assert!(repo.set_recurrence(FlowId(flow.id), destructive_with_mode).await.is_err());

    // Accumulating must carry a blocking mode.
    let accumulating_without_mode = SetRecurrenceRequest { consumption_kind: ConsumptionKind::Accumulating, ..destructive_recurrence(start) };
    assert!(repo.set_recurrence(FlowId(flow.id), accumulating_without_mode).await.is_err());

    // Blocking must carry a catch-up policy.
    let blocking_without_catchup = SetRecurrenceRequest {
        consumption_kind: ConsumptionKind::Accumulating,
        blocking_mode: Some(BlockingMode::Blocking),
        ..destructive_recurrence(start)
    };
    assert!(repo.set_recurrence(FlowId(flow.id), blocking_without_catchup).await.is_err());
}

// --- Phase (sub-day) Flow Window model round-trip (Feature B / S3) ---

#[tokio::test]
async fn phase_part_window_round_trips() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo
        .create(CreateFlowRequest {
            title: "Evening flow".into(),
            instance_type: Some(InstanceType::Task),
            parent_type: "aspect".into(),
            parent_id: 1,
            flow_duration_n: Some(1),
            flow_duration_kind: Some("part".into()),
            flow_window_part: Some("evening".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(flow.flow_duration_kind.as_deref(), Some("part"));
    assert_eq!(flow.flow_window_part.as_deref(), Some("evening"));
    assert_eq!(flow.flow_window_time_start, None);
}

#[tokio::test]
async fn phase_exact_window_round_trips() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo
        .create(CreateFlowRequest {
            title: "10-12 flow".into(),
            instance_type: Some(InstanceType::Task),
            parent_type: "aspect".into(),
            parent_id: 1,
            flow_duration_n: Some(1),
            flow_duration_kind: Some("exact".into()),
            flow_window_time_start: Some("10:00".into()),
            flow_window_time_end: Some("12:00".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(flow.flow_duration_kind.as_deref(), Some("exact"));
    assert_eq!(flow.flow_window_time_start.as_deref(), Some("10:00"));
    assert_eq!(flow.flow_window_time_end.as_deref(), Some("12:00"));
    assert_eq!(flow.flow_window_part, None);

    // An invalid part band is rejected by the CHECK constraint.
    let bad = repo
        .create(CreateFlowRequest {
            title: "bad".into(),
            instance_type: Some(InstanceType::Task),
            parent_type: "aspect".into(),
            parent_id: 1,
            flow_duration_kind: Some("part".into()),
            flow_window_part: Some("teatime".into()),
            ..Default::default()
        })
        .await;
    assert!(bad.is_err(), "invalid part band should violate the CHECK");
}

// --- Sub-day (Phase) Habit generation (Feature B / S4) ---

fn ymd(y: i32, m: u32, d: u32) -> chrono::NaiveDate {
    chrono::NaiveDate::from_ymd_opt(y, m, d).unwrap()
}

#[tokio::test]
async fn exact_phase_habit_recurs_at_the_fixed_time_each_day() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo
        .create(CreateFlowRequest {
            title: "Meds".into(),
            instance_type: Some(InstanceType::Task),
            parent_type: "aspect".into(),
            parent_id: 1,
            flow_duration_n: Some(1),
            flow_duration_kind: Some("exact".into()),
            flow_window_time_start: Some("10:00".into()),
            flow_window_time_end: Some("12:00".into()),
            ..Default::default()
        })
        .await
        .unwrap();

    // The start scope pins only the first occurrence day; Gap of 1 day → daily at 10:00–12:00.
    let day = ScopeRepository::new(&pool).get_or_create(ScopeKind::Day, ymd(2026, 1, 5)).await.unwrap();
    repo.set_recurrence(
        FlowId(flow.id),
        SetRecurrenceRequest {
            start_scope_id: day.id,
            gap_n: Some(1),
            gap_kind: Some("day".into()),
            end_scope_id: None,
            consumption_kind: ConsumptionKind::Destructive,
            blocking_mode: None,
            catchup_policy: None,
        },
    )
    .await
    .unwrap();

    // now = 2026-01-08 11:00, inside that day's 10:00–12:00 window.
    let now = ymd(2026, 1, 8).and_hms_opt(11, 0, 0).unwrap();
    let iters = repo.generate_habit_iterations(FlowId(flow.id), now).await.unwrap();
    let dates: Vec<_> = iters.iter().map(|it| it.anchor_date.clone()).collect();
    assert_eq!(dates, vec!["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"]);
    let kinds: Vec<_> = iters.iter().map(|it| format!("{:?}", it.status)).collect();
    // The three passed days lapsed (Destructive, unfinished); today's window is still open.
    assert_eq!(kinds, vec!["Lapsed", "Lapsed", "Lapsed", "Active"]);
}

#[tokio::test]
async fn part_phase_habit_recurs_every_gap_days_in_the_same_band() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo
        .create(CreateFlowRequest {
            title: "Evening walk".into(),
            instance_type: Some(InstanceType::Task),
            parent_type: "aspect".into(),
            parent_id: 1,
            flow_duration_n: Some(1),
            flow_duration_kind: Some("part".into()),
            flow_window_part: Some("evening".into()),
            ..Default::default()
        })
        .await
        .unwrap();

    let day = ScopeRepository::new(&pool).get_or_create(ScopeKind::Day, ymd(2026, 1, 5)).await.unwrap();
    // Gap of 2 days → every 2nd day's Evening: Jan 5, 7, 9, ...
    repo.set_recurrence(
        FlowId(flow.id),
        SetRecurrenceRequest {
            start_scope_id: day.id,
            gap_n: Some(2),
            gap_kind: Some("day".into()),
            end_scope_id: None,
            consumption_kind: ConsumptionKind::Destructive,
            blocking_mode: None,
            catchup_policy: None,
        },
    )
    .await
    .unwrap();

    // now = 2026-01-09 20:00, inside the Evening (18:00–22:00) of the third occurrence.
    let now = ymd(2026, 1, 9).and_hms_opt(20, 0, 0).unwrap();
    let iters = repo.generate_habit_iterations(FlowId(flow.id), now).await.unwrap();
    let dates: Vec<_> = iters.iter().map(|it| it.anchor_date.clone()).collect();
    assert_eq!(dates, vec!["2026-01-05", "2026-01-07", "2026-01-09"]);
    let kinds: Vec<_> = iters.iter().map(|it| format!("{:?}", it.status)).collect();
    assert_eq!(kinds, vec!["Lapsed", "Lapsed", "Active"]);
}

#[tokio::test]
async fn starting_an_exact_phase_flow_materializes_a_sub_day_window() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo
        .create(CreateFlowRequest {
            title: "Meds".into(),
            instance_type: Some(InstanceType::Task),
            parent_type: "aspect".into(),
            parent_id: 1,
            flow_duration_n: Some(1),
            flow_duration_kind: Some("exact".into()),
            flow_window_time_start: Some("10:00".into()),
            flow_window_time_end: Some("12:00".into()),
            ..Default::default()
        })
        .await
        .unwrap();

    // Target the (unscoped) aspect row; the anchor supplies only the day.
    let mat = repo
        .start(
            FlowId(flow.id),
            StartFlowRequest {
                title: "Meds today".into(),
                target_type: "aspect".into(),
                target_id: 1,
                anchor_date: ymd(2026, 1, 5),
            },
        )
        .await
        .unwrap();
    assert_eq!(mat.root_type, "task");

    // The materialized root carries a single exact scope spanning 10:00–12:00 on the anchor day.
    let (start_id, end_id): (Option<i64>, Option<i64>) =
        sqlx::query_as("SELECT time_scope_start_id, time_scope_end_id FROM tasks WHERE id = ?")
            .bind(mat.root_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(start_id, end_id);
    let (kind, sdt, edt): (String, Option<String>, Option<String>) =
        sqlx::query_as("SELECT kind, start_datetime, end_datetime FROM scopes WHERE id = ?")
            .bind(start_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(kind, "exact");
    assert_eq!(sdt.as_deref(), Some("2026-01-05T10:00:00"));
    assert_eq!(edt.as_deref(), Some("2026-01-05T12:00:00"));
}

#[tokio::test]
async fn starting_a_part_phase_flow_materializes_the_band() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo
        .create(CreateFlowRequest {
            title: "Evening walk".into(),
            instance_type: Some(InstanceType::Task),
            parent_type: "aspect".into(),
            parent_id: 1,
            flow_duration_n: Some(1),
            flow_duration_kind: Some("part".into()),
            flow_window_part: Some("evening".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    let mat = repo
        .start(
            FlowId(flow.id),
            StartFlowRequest {
                title: "Walk".into(),
                target_type: "aspect".into(),
                target_id: 1,
                anchor_date: ymd(2026, 1, 5),
            },
        )
        .await
        .unwrap();

    let start_id: Option<i64> =
        sqlx::query_scalar("SELECT time_scope_start_id FROM tasks WHERE id = ?")
            .bind(mat.root_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let (kind, part): (String, Option<String>) =
        sqlx::query_as("SELECT kind, part FROM scopes WHERE id = ?")
            .bind(start_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(kind, "part_of_day");
    assert_eq!(part.as_deref(), Some("evening"));
}

#[tokio::test]
async fn completing_an_iteration_marks_it_done_and_uncompleting_reverts() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo.create(create_req("Exercise")).await.unwrap(); // 2-week Span
    repo.create_task(CreateFlowItemRequest {
        flow_id: flow.id,
        title: "Do it".into(),
        parent_type: "flow".into(),
        parent_id: flow.id,
    })
    .await
    .unwrap();
    let start = week_scope_id(&pool, ymd(2026, 1, 5)).await;
    repo.set_recurrence(FlowId(flow.id), destructive_recurrence(start)).await.unwrap();

    // Well past the first window → Destructive lapses it while unfinished.
    let now = ymd(2026, 3, 1).and_hms_opt(12, 0, 0).unwrap();
    let before = repo.generate_habit_iterations(FlowId(flow.id), now).await.unwrap();
    let first_scope = before[0].anchor_scope_id;
    assert_eq!(format!("{:?}", before[0].status), "Lapsed");

    repo.set_iteration_done(FlowId(flow.id), first_scope, true, 1_767_600_000_000).await.unwrap();
    let after = repo.generate_habit_iterations(FlowId(flow.id), now).await.unwrap();
    assert_eq!(format!("{:?}", after[0].status), "Done");

    repo.set_iteration_done(FlowId(flow.id), first_scope, false, 0).await.unwrap();
    let reverted = repo.generate_habit_iterations(FlowId(flow.id), now).await.unwrap();
    assert_eq!(format!("{:?}", reverted[0].status), "Lapsed");
}

#[tokio::test]
async fn iteration_resolves_only_when_the_root_and_every_item_are_done() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo.create(create_req("Meals")).await.unwrap();
    let breakfast = repo
        .create_task(CreateFlowItemRequest {
            flow_id: flow.id, title: "Breakfast".into(), parent_type: "flow".into(), parent_id: flow.id,
        })
        .await
        .unwrap();
    let dinner = repo
        .create_task(CreateFlowItemRequest {
            flow_id: flow.id, title: "Dinner".into(), parent_type: "flow".into(), parent_id: flow.id,
        })
        .await
        .unwrap();
    let start = week_scope_id(&pool, ymd(2026, 1, 5)).await;
    repo.set_recurrence(FlowId(flow.id), destructive_recurrence(start)).await.unwrap();

    let now = ymd(2026, 1, 8).and_hms_opt(12, 0, 0).unwrap(); // inside the first (Active) window
    let scope = repo.generate_habit_iterations(FlowId(flow.id), now).await.unwrap()[0].anchor_scope_id;

    // Every item done but NOT the root → still open (the root is its own instance).
    repo.set_item_done(FlowId(flow.id), "flow_task", breakfast.id, scope, true, 1_767_600_000_000).await.unwrap();
    repo.set_item_done(FlowId(flow.id), "flow_task", dinner.id, scope, true, 1_767_600_000_000).await.unwrap();
    assert_ne!(format!("{:?}", repo.generate_habit_iterations(FlowId(flow.id), now).await.unwrap()[0].status), "Done");

    // Completing the root instance too resolves the iteration.
    repo.set_item_done(FlowId(flow.id), "flow_root", flow.id, scope, true, 1_767_600_000_000).await.unwrap();
    let completions = repo.list_item_completions(FlowId(flow.id)).await.unwrap();
    assert_eq!(completions.len(), 3); // breakfast, dinner, root
    assert!(completions.iter().any(|c| c.item_type == "flow_root" && c.item_id == flow.id));
    assert_eq!(format!("{:?}", repo.generate_habit_iterations(FlowId(flow.id), now).await.unwrap()[0].status), "Done");

    // Un-checking the root alone reverts it.
    repo.set_item_done(FlowId(flow.id), "flow_root", flow.id, scope, false, 0).await.unwrap();
    assert_ne!(format!("{:?}", repo.generate_habit_iterations(FlowId(flow.id), now).await.unwrap()[0].status), "Done");
}

#[tokio::test]
async fn an_item_less_habit_resolves_by_completing_its_root() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo.create(create_req("Shave")).await.unwrap(); // no items — the root is the only instance
    let start = week_scope_id(&pool, ymd(2026, 1, 5)).await;
    repo.set_recurrence(FlowId(flow.id), destructive_recurrence(start)).await.unwrap();

    let now = ymd(2026, 1, 8).and_hms_opt(12, 0, 0).unwrap();
    let scope = repo.generate_habit_iterations(FlowId(flow.id), now).await.unwrap()[0].anchor_scope_id;
    assert_ne!(format!("{:?}", repo.generate_habit_iterations(FlowId(flow.id), now).await.unwrap()[0].status), "Done");

    repo.set_item_done(FlowId(flow.id), "flow_root", flow.id, scope, true, 1_767_600_000_000).await.unwrap();
    assert_eq!(format!("{:?}", repo.generate_habit_iterations(FlowId(flow.id), now).await.unwrap()[0].status), "Done");
}

// --- Edit-habit reconciliation: fork / discard (Phase 8.5) ---

#[tokio::test]
async fn fork_flow_deep_clones_the_template_and_leaves_the_original() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo.create(create_req("Routine")).await.unwrap();
    let goal = repo
        .create_goal(CreateFlowItemRequest {
            flow_id: flow.id, title: "Milestone".into(), parent_type: "flow".into(), parent_id: flow.id,
        })
        .await
        .unwrap();
    let task = repo
        .create_task(CreateFlowItemRequest {
            flow_id: flow.id, title: "Step".into(), parent_type: "flow_goal".into(), parent_id: goal.id,
        })
        .await
        .unwrap();
    repo.set_cycles(flow.id, FlowItemType::FlowTask, task.id, &[day_cycle(2)]).await.unwrap();
    repo.add_dependency(flow.id, FlowItemType::FlowTask, task.id, FlowItemType::FlowGoal, goal.id).await.unwrap();

    let forked = repo.fork_flow(FlowId(flow.id)).await.unwrap();
    assert_ne!(forked.id, flow.id);
    assert_eq!(forked.title, "Routine");

    let new_goals = repo.list_goals(FlowId(forked.id)).await.unwrap();
    let new_tasks = repo.list_tasks(FlowId(forked.id)).await.unwrap();
    assert_eq!(new_goals.len(), 1);
    assert_eq!(new_tasks.len(), 1);
    let new_goal = &new_goals[0];
    let new_task = &new_tasks[0];
    assert_ne!(new_goal.id, goal.id);
    assert_ne!(new_task.id, task.id);
    // The child task is reparented under the CLONED goal, not the original.
    assert_eq!(new_task.parent_type, "flow_goal");
    assert_eq!(new_task.parent_id, new_goal.id);

    let cycles: Vec<_> =
        repo.list_all_cycles().await.unwrap().into_iter().filter(|c| c.flow_id == forked.id).collect();
    assert_eq!(cycles.len(), 1);
    assert_eq!(cycles[0].item_id, new_task.id);
    assert_eq!(cycles[0].scope_index, Some(2));
    let deps: Vec<_> =
        repo.list_all_dependencies().await.unwrap().into_iter().filter(|d| d.flow_id == forked.id).collect();
    assert_eq!(deps.len(), 1);
    assert_eq!(deps[0].dependent_id, new_task.id);
    assert_eq!(deps[0].depends_on_id, new_goal.id);

    // The original template is untouched (no recurrence/completions carried over either).
    assert_eq!(repo.list_goals(FlowId(flow.id)).await.unwrap().len(), 1);
    assert!(repo.get_recurrence(FlowId(forked.id)).await.unwrap().is_none());
}

#[tokio::test]
async fn clearing_modifications_drops_completions_and_reverts_iterations() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo.create(create_req("Habit")).await.unwrap();
    repo.create_task(CreateFlowItemRequest {
        flow_id: flow.id, title: "Do".into(), parent_type: "flow".into(), parent_id: flow.id,
    })
    .await
    .unwrap();
    let start = week_scope_id(&pool, ymd(2026, 1, 5)).await;
    repo.set_recurrence(FlowId(flow.id), destructive_recurrence(start)).await.unwrap();

    let now = ymd(2026, 3, 1).and_hms_opt(12, 0, 0).unwrap();
    let scope = repo.generate_habit_iterations(FlowId(flow.id), now).await.unwrap()[0].anchor_scope_id;
    repo.set_iteration_done(FlowId(flow.id), scope, true, 1_767_600_000_000).await.unwrap();
    assert_eq!(repo.habit_completion_count(FlowId(flow.id)).await.unwrap(), 1);

    repo.clear_habit_modifications(FlowId(flow.id)).await.unwrap();
    assert_eq!(repo.habit_completion_count(FlowId(flow.id)).await.unwrap(), 0);
    let reverted = repo.generate_habit_iterations(FlowId(flow.id), now).await.unwrap();
    assert_eq!(format!("{:?}", reverted[0].status), "Lapsed");
}

// --- Convert a Task/Goal subtree into a Flow (context-menu feature) ---

#[tokio::test]
async fn convert_to_flow_builds_a_template_maps_scopes_deps_and_deletes_the_subtree() {
    let pool = helpers::test_pool().await;
    let goals = GoalRepository::new(&pool);
    let tasks = TaskRepository::new(&pool);
    let sc = ScopeRepository::new(&pool);

    // Root goal under a domain (aspect 1), scoped to a week → maps to a Span(1, week) window.
    let week = sc.get_or_create(ScopeKind::Week, ymd(2026, 1, 5)).await.unwrap();
    let root = goals
        .create(CreateGoalRequest {
            title: "Routine".into(),
            parent_type: "domain".into(),
            parent_id: 1,
            time_scope: Some(TimeScope { start_id: week.id, end_id: week.id, duration: None }),
            on_scope_exit: Some(OnScopeExit::Keep),
            ..Default::default()
        })
        .await
        .unwrap();
    // A task scoped to a day inside that week → maps to a (day, offset) cycle scope.
    let day = sc.get_or_create(ScopeKind::Day, ymd(2026, 1, 7)).await.unwrap();
    let step = tasks
        .create(CreateTaskRequest {
            title: "Step".into(),
            parent_type: "goal".into(),
            parent_id: root.id,
            time_scope: Some(TimeScope { start_id: day.id, end_id: day.id, duration: None }),
            on_scope_exit: Some(OnScopeExit::Keep),
            ..Default::default()
        })
        .await
        .unwrap();
    let prep = tasks
        .create(CreateTaskRequest { title: "Prep".into(), parent_type: "goal".into(), parent_id: root.id, ..Default::default() })
        .await
        .unwrap();
    tasks.add_dependency(step.id.into(), Dependency::Task { id: prep.id }).await.unwrap();

    let repo = FlowRepository::new(&pool);
    let flow = repo.convert_to_flow("goal", root.id, true, true).await.unwrap();

    assert_eq!(flow.instance_type, "goal");
    assert_eq!(flow.title, "Routine");
    assert_eq!(flow.flow_duration_kind.as_deref(), Some("week")); // root scope → Span window
    assert_eq!(flow.flow_duration_n, Some(1));

    // Two flow-task items mirror the two task children.
    assert_eq!(repo.list_goals(FlowId(flow.id)).await.unwrap().len(), 0);
    let ftasks = repo.list_tasks(FlowId(flow.id)).await.unwrap();
    assert_eq!(ftasks.len(), 2);

    // The task→task dependency is remapped to a flow dependency.
    let deps: Vec<_> =
        repo.list_all_dependencies().await.unwrap().into_iter().filter(|d| d.flow_id == flow.id).collect();
    assert_eq!(deps.len(), 1);

    // The day-scoped item got a relative day cycle (Jan 7 is 3 days after the Sun-start → index 4).
    let cycles: Vec<_> =
        repo.list_all_cycles().await.unwrap().into_iter().filter(|c| c.flow_id == flow.id).collect();
    assert_eq!(cycles.len(), 1);
    assert_eq!(cycles[0].scope_kind.as_deref(), Some("day"));
    assert_eq!(cycles[0].scope_index, Some(4));

    // The original real subtree is gone.
    assert!(goals.get(GoalId(root.id)).await.is_err());
    assert!(tasks.get(TaskId(step.id)).await.is_err());
    assert!(tasks.get(TaskId(prep.id)).await.is_err());
}

#[tokio::test]
async fn convert_to_flow_rejects_a_task_under_a_task() {
    let pool = helpers::test_pool().await;
    let tasks = TaskRepository::new(&pool);
    let parent = tasks
        .create(CreateTaskRequest { title: "Parent".into(), parent_type: "domain".into(), parent_id: 1, ..Default::default() })
        .await
        .unwrap();
    let child = tasks
        .create(CreateTaskRequest { title: "Child".into(), parent_type: "task".into(), parent_id: parent.id, ..Default::default() })
        .await
        .unwrap();
    // A flow can't be parented under a task, so converting the child is rejected.
    assert!(FlowRepository::new(&pool).convert_to_flow("task", child.id, true, true).await.is_err());
}

#[tokio::test]
async fn convert_a_task_subtree_without_deps_or_scope_mapping() {
    let pool = helpers::test_pool().await;
    let tasks = TaskRepository::new(&pool);
    // A task under a domain (valid flow parent) with a task child.
    let root = tasks
        .create(CreateTaskRequest { title: "Build".into(), parent_type: "domain".into(), parent_id: 1, ..Default::default() })
        .await
        .unwrap();
    tasks
        .create(CreateTaskRequest { title: "Sub".into(), parent_type: "task".into(), parent_id: root.id, ..Default::default() })
        .await
        .unwrap();

    let repo = FlowRepository::new(&pool);
    let flow = repo.convert_to_flow("task", root.id, false, false).await.unwrap();
    assert_eq!(flow.instance_type, "task");
    assert!(flow.flow_duration_kind.is_none()); // no scope to map → unscoped window
    assert_eq!(repo.list_tasks(FlowId(flow.id)).await.unwrap().len(), 1); // the one child
    assert_eq!(repo.list_goals(FlowId(flow.id)).await.unwrap().len(), 0);
    assert!(repo.list_all_cycles().await.unwrap().iter().all(|c| c.flow_id != flow.id)); // no cycles mapped
    assert!(tasks.get(TaskId(root.id)).await.is_err());
}

#[tokio::test]
async fn is_habit_flag_reflects_the_recurrence() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo.create(create_req("Routine")).await.unwrap();
    assert!(!repo.get(FlowId(flow.id)).await.unwrap().is_habit);

    let start = week_scope_id(&pool, ymd(2026, 1, 5)).await;
    repo.set_recurrence(FlowId(flow.id), destructive_recurrence(start)).await.unwrap();
    assert!(repo.get(FlowId(flow.id)).await.unwrap().is_habit);
    assert!(repo.list().await.unwrap().iter().find(|f| f.id == flow.id).unwrap().is_habit);

    repo.delete_recurrence(FlowId(flow.id)).await.unwrap();
    assert!(!repo.get(FlowId(flow.id)).await.unwrap().is_habit);
}
