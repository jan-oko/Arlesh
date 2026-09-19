//! Command-level tests for `load_mindmap`.
//!
//! Two things need proving, and neither is provable from the return value alone.
//!
//! The first is **equivalence**: the envelope must carry what the fourteen commands it replaces
//! return, or the mindmap silently renders from a different database than it used to. Each field
//! is compared against the command it stands in for, on the wire (`serde_json::to_value`), since
//! that is the form the frontend actually receives.
//!
//! The second is the **commit**. `load_mindmap` opens a transaction because deriving a Habit's
//! iterations mints the scope rows its windows land on. Replacing `db.commit().await…?;` with
//! `Ok(())` still compiles, and sqlx rolls a dropped transaction back silently — so the command
//! returns a perfectly correct-looking envelope while nothing reaches disk. Only a test that
//! calls the real command and then reads the rows off the pool can tell the difference.
//!
//! The pool has **one** connection (see [`helpers::test_pool`]), so every assertion here reads it
//! only after the command's session has closed.

use crate::helpers;

use arlesh_lib::commands::{
    block_reasons as block_reason_commands, domains as domain_commands, flows as flow_commands,
    infos as info_commands, mindmap as mindmap_commands, tasks as task_commands,
};
use arlesh_lib::flows::model::{
    ConsumptionKind, CreateFlowItemRequest, CreateFlowRequest, FlowCycleInput, FlowItemType,
    InstanceType, SetRecurrenceRequest, UpdateFlowRequest,
};
use arlesh_lib::infos::model::CreateInfoRequest;
use arlesh_lib::mindmap::model::FlowHabitResult;
use arlesh_lib::scopes::model::ScopeKind;
use arlesh_lib::tasks::model::{CreateGoalRequest, CreateTaskRequest, Dependency};
use tauri::Manager;

fn ymd(y: i32, m: u32, d: u32) -> chrono::NaiveDate {
    chrono::NaiveDate::from_ymd_opt(y, m, d).unwrap()
}

/// The reference instant every test loads at.
fn now() -> chrono::NaiveDateTime {
    ymd(2026, 2, 4).and_hms_opt(9, 0, 0).unwrap()
}

/// Total rows in `table`.
async fn count_all(pool: &sqlx::SqlitePool, table: &str) -> i64 {
    sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Counts the rows of `table` whose `column` equals `value`.
async fn count_where(pool: &sqlx::SqlitePool, table: &str, column: &str, value: i64) -> i64 {
    sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table} WHERE {column} = ?"))
        .bind(value)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// A two-week Span flow under the seeded aspect 1 — scoped, so it can be made a Habit.
fn scoped_flow(title: &str) -> CreateFlowRequest {
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

fn weekly_from(start_scope_id: i64) -> SetRecurrenceRequest {
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

/// Mints the week scope starting on `date` and returns its id.
async fn week_scope(pool: &sqlx::SqlitePool, date: chrono::NaiveDate) -> i64 {
    helpers::session_factory(pool)
        .connect()
        .await
        .unwrap()
        .scopes()
        .get_or_create(ScopeKind::Week, date)
        .await
        .unwrap()
        .id
}

/// Everything the mindmap reads, seeded: two domains, a goal, two tasks with a dependency and a
/// block reason, an info, and two flows — one a Habit with items, cycles and an intra-flow
/// dependency, one a plain flow.
///
/// Returns the Habit's id.
async fn seed(app: &tauri::App<tauri::test::MockRuntime>, pool: &sqlx::SqlitePool) -> i64 {
    use arlesh_lib::domains::model::{CreateDomainRequest, DomainSubtype};

    domain_commands::create_domain(
        app.state(),
        CreateDomainRequest {
            title: "Ops".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(1),
            status: None,
            knowledge_base_directory: None,
        },
    )
    .await
    .unwrap();

    let goal = task_commands::create_goal(
        app.state(),
        CreateGoalRequest {
            title: "Ship".into(),
            parent_type: "domain".into(),
            parent_id: 1,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let first = task_commands::create_task(
        app.state(),
        CreateTaskRequest {
            title: "Write".into(),
            parent_type: "goal".into(),
            parent_id: goal.id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let second = task_commands::create_task(
        app.state(),
        CreateTaskRequest {
            title: "Review".into(),
            parent_type: "goal".into(),
            parent_id: goal.id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    task_commands::add_task_dependency(
        app.state(),
        second.id,
        Dependency::Task { id: first.id },
    )
    .await
    .unwrap();
    block_reason_commands::set_block_reasons(
        app.state(),
        "task".into(),
        first.id,
        vec!["waiting on review".into()],
    )
    .await
    .unwrap();
    info_commands::create_info(
        app.state(),
        CreateInfoRequest {
            body: "a note".into(),
            details: None,
            parent_type: "task".into(),
            parent_id: first.id,
            position: 0,
        },
    )
    .await
    .unwrap();

    let habit = flow_commands::create_flow(app.state(), scoped_flow("Routine"))
        .await
        .unwrap();
    let item = flow_commands::create_flow_task(
        app.state(),
        CreateFlowItemRequest {
            flow_id: habit.id,
            title: "Exercise".into(),
            parent_type: "flow".into(),
            parent_id: habit.id,
        },
    )
    .await
    .unwrap();
    let other = flow_commands::create_flow_goal(
        app.state(),
        CreateFlowItemRequest {
            flow_id: habit.id,
            title: "Feel good".into(),
            parent_type: "flow".into(),
            parent_id: habit.id,
        },
    )
    .await
    .unwrap();
    flow_commands::set_flow_item_cycles(
        app.state(),
        habit.id,
        FlowItemType::FlowTask,
        item.id,
        vec![FlowCycleInput {
            scope_kind: Some("week".into()),
            scope_index: Some(1),
            plan_kind: None,
            plan_start: None,
            plan_end: None,
        }],
    )
    .await
    .unwrap();
    flow_commands::add_flow_dependency(
        app.state(),
        habit.id,
        FlowItemType::FlowGoal,
        other.id,
        FlowItemType::FlowTask,
        item.id,
    )
    .await
    .unwrap();

    let start = week_scope(pool, ymd(2026, 1, 5)).await;
    flow_commands::set_flow_recurrence(app.state(), habit.id, weekly_from(start))
        .await
        .unwrap();

    flow_commands::create_flow(app.state(), scoped_flow("Plain"))
        .await
        .unwrap();

    habit.id
}

#[tokio::test]
async fn the_envelope_carries_what_the_individual_commands_return() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    seed(&app, &pool).await;

    let load = mindmap_commands::load_mindmap(app.state(), now())
        .await
        .unwrap();

    // Each field against the command it replaces, compared on the wire — the form the frontend
    // receives — because most of these models derive no `PartialEq`.
    macro_rules! same {
        ($field:expr, $command:expr, $label:literal) => {
            assert_eq!(
                serde_json::to_value(&$field).unwrap(),
                serde_json::to_value(&$command.await.unwrap()).unwrap(),
                $label
            );
        };
    }

    same!(load.domains, domain_commands::list_domains(app.state(), None), "domains");
    same!(load.goals, task_commands::list_goals(app.state()), "goals");
    same!(load.tasks, task_commands::list_tasks(app.state()), "tasks");
    same!(load.infos, info_commands::list_infos(app.state()), "infos");
    same!(load.flows, flow_commands::list_flows(app.state()), "flows");
    same!(load.flow_goals, flow_commands::list_all_flow_goals(app.state()), "flow goals");
    same!(load.flow_tasks, flow_commands::list_all_flow_tasks(app.state()), "flow tasks");
    same!(load.flow_cycles, flow_commands::list_all_flow_cycles(app.state()), "flow cycles");
    same!(
        load.flow_dependencies,
        flow_commands::list_all_flow_dependencies(app.state()),
        "flow dependencies"
    );
    same!(
        load.block_reasons,
        block_reason_commands::list_all_block_reasons(app.state()),
        "block reasons"
    );
    same!(
        load.task_dependencies,
        task_commands::list_all_task_dependencies(app.state()),
        "task dependencies"
    );
    same!(
        load.flow_instance_nodes,
        flow_commands::list_flow_instance_nodes(app.state()),
        "flow instance nodes"
    );
    same!(
        load.lifecycles,
        task_commands::derive_scope_lifecycles(app.state(), now()),
        "lifecycles"
    );

    // And the dependent wave, which the frontend used to fetch per flow after the flow list.
    assert_eq!(load.habits.len(), load.flows.len(), "one habit entry per flow, in flow order");
    for (entry, flow) in load.habits.iter().zip(&load.flows) {
        assert_eq!(entry.flow_id, flow.id);
        assert_eq!(entry.flow_title, flow.title);
        let FlowHabitResult::Loaded {
            iterations,
            statuses,
        } = &entry.result
        else {
            panic!("flow {} should have loaded: {:?}", flow.id, entry.result);
        };
        assert_eq!(
            serde_json::to_value(iterations).unwrap(),
            serde_json::to_value(
                flow_commands::generate_habit_iterations(app.state(), flow.id, now())
                    .await
                    .unwrap_or_default()
            )
            .unwrap(),
            "iterations for flow {}",
            flow.id
        );
        assert_eq!(
            serde_json::to_value(statuses).unwrap(),
            serde_json::to_value(
                flow_commands::list_habit_item_statuses(app.state(), flow.id)
                    .await
                    .unwrap()
            )
            .unwrap(),
            "statuses for flow {}",
            flow.id
        );
    }
}

#[tokio::test]
async fn the_command_commits_the_scopes_its_habit_derivation_materialises() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let habit = seed(&app, &pool).await;
    let scopes_before = count_all(&pool, "scopes").await;

    let load = mindmap_commands::load_mindmap(app.state(), now())
        .await
        .unwrap();

    let entry = load
        .habits
        .iter()
        .find(|entry| entry.flow_id == habit)
        .expect("the habit has an entry");
    let FlowHabitResult::Loaded { iterations, .. } = &entry.result else {
        panic!("the habit should have loaded: {:?}", entry.result);
    };
    assert_eq!(iterations.len(), 3, "three two-week windows have started by 4 February");

    // The assertion that fails when the commit goes: a rolled-back load returns this same
    // envelope, but leaves no scope behind.
    assert!(
        count_all(&pool, "scopes").await > scopes_before,
        "the canonical scopes each window landed on must be committed, not rolled back"
    );
    for iteration in iterations {
        assert_eq!(
            count_where(&pool, "scopes", "id", iteration.anchor_scope_id).await,
            1,
            "every iteration's anchoring scope must be on disk"
        );
    }
}

#[tokio::test]
async fn one_flow_failing_is_recorded_on_its_entry_and_the_rest_still_loads() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let habit = seed(&app, &pool).await;

    // A Habit that cannot be derived: it has a recurrence but no Duration to repeat. Reached the
    // way a user reaches it — `set_flow_recurrence` refuses an unscoped flow, so the recurrence
    // goes on first and the Duration is cleared afterwards, which `update_flow` permits.
    let broken = flow_commands::create_flow(app.state(), scoped_flow("Broken"))
        .await
        .unwrap();
    let start = week_scope(&pool, ymd(2026, 1, 5)).await;
    flow_commands::set_flow_recurrence(app.state(), broken.id, weekly_from(start))
        .await
        .unwrap();
    flow_commands::update_flow(
        app.state(),
        broken.id,
        UpdateFlowRequest {
            flow_duration_kind: Some(None),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let load = mindmap_commands::load_mindmap(app.state(), now())
        .await
        .unwrap();

    let entry = load
        .habits
        .iter()
        .find(|entry| entry.flow_id == broken.id)
        .expect("the broken flow still has an entry");
    let FlowHabitResult::Failed { message } = &entry.result else {
        panic!("the broken flow should have failed: {:?}", entry.result);
    };
    assert!(!message.is_empty(), "the failure carries a reason for the user");
    assert_eq!(entry.flow_title, "Broken", "named, so the notice can say which flow");

    // The whole point: one bad flow does not abort the load.
    let good = load
        .habits
        .iter()
        .find(|entry| entry.flow_id == habit)
        .expect("the healthy habit is still there");
    assert!(
        matches!(good.result, FlowHabitResult::Loaded { .. }),
        "a healthy flow is unaffected by its neighbour's failure"
    );
    assert!(!load.domains.is_empty(), "and the rest of the mindmap arrived");
    assert!(!load.tasks.is_empty());
    assert!(!load.goals.is_empty());
}

#[tokio::test]
async fn a_flow_with_no_recurrence_loads_as_an_empty_habit_not_a_failure() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let plain = flow_commands::create_flow(app.state(), scoped_flow("Plain"))
        .await
        .unwrap();

    let load = mindmap_commands::load_mindmap(app.state(), now())
        .await
        .unwrap();

    let entry = load
        .habits
        .iter()
        .find(|entry| entry.flow_id == plain.id)
        .expect("every flow has an entry");
    let FlowHabitResult::Loaded { iterations, .. } = &entry.result else {
        panic!(
            "an ordinary flow is not a failure — it would raise a notice on every load: {:?}",
            entry.result
        );
    };
    assert!(iterations.is_empty(), "no recurrence, no iterations");
}

#[tokio::test]
async fn an_empty_database_loads_an_empty_envelope() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);

    let load = mindmap_commands::load_mindmap(app.state(), now())
        .await
        .unwrap();

    assert!(load.goals.is_empty());
    assert!(load.tasks.is_empty());
    assert!(load.infos.is_empty());
    assert!(load.flows.is_empty());
    assert!(load.habits.is_empty(), "no flows, no per-flow wave");
    assert_eq!(
        serde_json::to_value(&load.domains).unwrap(),
        serde_json::to_value(domain_commands::list_domains(app.state(), None).await.unwrap())
            .unwrap(),
        "the seeded aspects are still there"
    );
}
