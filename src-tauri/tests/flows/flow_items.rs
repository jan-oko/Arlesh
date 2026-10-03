//! Commitment and wait items in a Flow template (Task b66; ruled by the user, 2026-10-03).
//!
//! A template holds a Commitment item and a wait item beside its Task and Goal items. Each test
//! drives the board the way the app does — a command or a write, then a load — and asks what the
//! items drew: where they may sit, what each occurrence is, what holds an iteration open, when a
//! wait is first checked, and what starting or copying a Flow makes of them.

use crate::helpers;

use arlesh_lib::commands::{flows as flow_commands, mindmap as mindmap_commands};
use arlesh_lib::flows::{
    generate_habit_iterations,
    model::{
        ClockKind, CreateFlowItemRequest, CreateFlowRequest, FirstCheck, FlowCycleInput, FlowId,
        FlowItemType, InstanceType, IterationStatus, MissPolicy, SetRecurrenceRequest,
        StartFlowRequest, UpdateFlowItemRequest,
    },
};
use arlesh_lib::mindmap::model::MindmapLoad;
use arlesh_lib::nodes::{
    id::NodeId,
    key::{OccurrenceKey, TemplateItem, TemplateKind},
    write,
};
use arlesh_lib::scopes::key::ScopeKey;
use arlesh_lib::scopes::model::ScopeKind;
use arlesh_lib::tasks::model::{
    DurationSpec, ExpectationStatus, Status, TaskStatus, UpdateCommitmentRequest,
    UpdateExpectationRequest, UpdateTaskRequest, Verdict,
};
use tauri::Manager;

type App = tauri::App<tauri::test::MockRuntime>;

fn ymd(y: i32, m: u32, d: u32) -> chrono::NaiveDate {
    chrono::NaiveDate::from_ymd_opt(y, m, d).unwrap()
}

fn at(instant: &str) -> chrono::NaiveDateTime {
    chrono::NaiveDateTime::parse_from_str(instant, "%Y-%m-%dT%H:%M:%S").unwrap()
}

fn days(n: i64) -> DurationSpec {
    DurationSpec {
        n,
        kind: "day".into(),
    }
}

/// A Flow under the root aspect whose window is one `kind`, of `instance_type`.
async fn flow(app: &App, kind: &str, instance_type: InstanceType) -> i64 {
    flow_commands::create_flow(
        app.state(),
        CreateFlowRequest {
            title: "Routine".into(),
            instance_type: Some(instance_type),
            parent_type: "aspect".into(),
            parent_id: 1,
            flow_duration_n: Some(1),
            flow_duration_kind: Some(kind.into()),
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .id
}

/// Makes `flow` a Window + Owed Habit starting on the `kind` scope holding `start`.
async fn recur(app: &App, flow: i64, kind: ScopeKind, start: chrono::NaiveDate) {
    flow_commands::set_flow_recurrence(
        app.state(),
        flow,
        SetRecurrenceRequest {
            start_scope_id: ScopeKey::containing(kind, start).unwrap(),
            gap_n: None,
            gap_kind: None,
            end_scope_id: None,
            clock: ClockKind::Window,
            miss_policy: Some(MissPolicy::Owed),
            cooldown_n: None,
            cooldown_kind: None,
        },
    )
    .await
    .unwrap();
}

fn under(flow: i64, title: &str, parent: (&str, i64)) -> CreateFlowItemRequest {
    CreateFlowItemRequest {
        flow_id: flow,
        title: title.into(),
        parent_type: parent.0.into(),
        parent_id: parent.1,
    }
}

async fn commitment_item(app: &App, flow: i64, parent: (&str, i64)) -> i64 {
    flow_commands::create_flow_commitment(app.state(), under(flow, "Asleep by 23:00", parent))
        .await
        .unwrap()
        .id
}

async fn wait_item(app: &App, flow: i64, parent: (&str, i64)) -> i64 {
    flow_commands::create_flow_expectation(app.state(), under(flow, "Coach replies", parent))
        .await
        .unwrap()
        .id
}

async fn task_item(app: &App, flow: i64, parent: (&str, i64)) -> i64 {
    flow_commands::create_flow_task(app.state(), under(flow, "Stretch", parent))
        .await
        .unwrap()
        .id
}

fn occurrence(item_type: TemplateKind, item_id: i64, iteration: ScopeKey) -> NodeId {
    NodeId::Derived(
        OccurrenceKey {
            item: TemplateItem { item_type, item_id },
            iteration,
            cycle: 0,
        }
        .id(),
    )
}

async fn load(app: &App, instant: &str) -> MindmapLoad {
    mindmap_commands::load_mindmap(app.state(), app.state(), at(instant))
        .await
        .unwrap()
}

#[tokio::test]
async fn commitment_and_wait_items_sit_where_the_parenting_table_says() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow = flow(&app, "week", InstanceType::Task).await;

    let promise = commitment_item(&app, flow, ("flow", flow)).await;
    let step = task_item(&app, flow, ("flow_commitment", promise)).await;
    let nested = commitment_item(&app, flow, ("flow_commitment", promise)).await;
    let wait = wait_item(&app, flow, ("flow_task", step)).await;
    wait_item(&app, flow, ("flow_commitment", nested)).await;

    let goal_in_commitment = flow_commands::create_flow_goal(
        app.state(),
        under(flow, "Ship", ("flow_commitment", promise)),
    )
    .await;
    assert!(goal_in_commitment.is_err(), "a Commitment holds no Goal");
    let task_in_wait =
        flow_commands::create_flow_task(app.state(), under(flow, "x", ("flow_expectation", wait)))
            .await;
    assert!(task_in_wait.is_err(), "a wait holds nothing in a template");
    let commitment_item_depended_on = flow_commands::add_flow_dependency(
        app.state(),
        flow,
        FlowItemType::FlowTask,
        step,
        FlowItemType::FlowCommitment,
        promise,
    )
    .await;
    assert!(
        commitment_item_depended_on.is_err(),
        "nothing waits on a Commitment"
    );
}

#[tokio::test]
async fn each_iteration_gives_a_commitment_item_its_own_commitment() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow = flow(&app, "day", InstanceType::Task).await;
    let promise = commitment_item(&app, flow, ("flow", flow)).await;
    flow_commands::update_flow_commitment(
        app.state(),
        promise,
        UpdateFlowItemRequest {
            verdict_window: Some(Some(days(2))),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    recur(&app, flow, ScopeKind::Day, ymd(2026, 1, 5)).await;

    let monday = occurrence(
        TemplateKind::FlowCommitment,
        promise,
        ScopeKey::day(ymd(2026, 1, 5)),
    );
    let tuesday = occurrence(
        TemplateKind::FlowCommitment,
        promise,
        ScopeKey::day(ymd(2026, 1, 6)),
    );
    let board = load(&app, "2026-01-06T09:00:00").await;
    for id in [&monday, &tuesday] {
        let commitment = board
            .commitments
            .iter()
            .find(|commitment| commitment.id == *id)
            .expect("every iteration draws its own Commitment");
        assert_eq!(commitment.verdict, Verdict::Unresolved);
        assert_eq!(
            commitment.verdict_window,
            Some(days(2)),
            "copied from its item"
        );
        assert!(
            commitment.time_scope.is_some(),
            "over its iteration's window"
        );
    }

    let factory = helpers::session_factory(&pool);
    let mut db = factory.begin().await.unwrap();
    write::update_commitment(
        &mut db,
        &monday,
        UpdateCommitmentRequest {
            verdict: Some(Verdict::Kept),
            ..Default::default()
        },
        at("2026-01-06T09:00:00"),
    )
    .await
    .unwrap();
    let refused = write::update_commitment(
        &mut db,
        &tuesday,
        UpdateCommitmentRequest {
            verdict_window: Some(Some(days(5))),
            ..Default::default()
        },
        at("2026-01-06T09:00:00"),
    )
    .await;
    assert!(
        refused.is_err(),
        "an occurrence's Verdict Window is its item's"
    );
    db.commit().await.unwrap();

    let board = load(&app, "2026-01-06T09:00:00").await;
    let verdict = |id: &NodeId| {
        board
            .commitments
            .iter()
            .find(|commitment| commitment.id == *id)
            .map(|commitment| commitment.verdict)
    };
    assert_eq!(verdict(&monday), Some(Verdict::Kept));
    assert_eq!(
        verdict(&tuesday),
        Some(Verdict::Unresolved),
        "its own verdict"
    );
}

#[tokio::test]
async fn an_unsettled_item_holds_its_iteration_open_until_it_is_settled() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow = flow(&app, "day", InstanceType::Task).await;
    let step = task_item(&app, flow, ("flow", flow)).await;
    let wait = wait_item(&app, flow, ("flow_task", step)).await;
    let promise = commitment_item(&app, flow, ("flow", flow)).await;
    recur(&app, flow, ScopeKind::Day, ymd(2026, 1, 5)).await;
    let day = ScopeKey::day(ymd(2026, 1, 5));
    let now = at("2026-01-05T20:00:00");
    let factory = helpers::session_factory(&pool);

    let mut db = factory.begin().await.unwrap();
    for id in [
        occurrence(TemplateKind::FlowRoot, flow, day),
        occurrence(TemplateKind::FlowTask, step, day),
    ] {
        write::update_task(
            &mut db,
            &id,
            UpdateTaskRequest {
                status: Some(Status::Ordinary(TaskStatus::Done)),
                ..Default::default()
            },
            now,
        )
        .await
        .unwrap();
    }
    db.commit().await.unwrap();
    let status = |iterations: Vec<arlesh_lib::flows::model::HabitIteration>| {
        iterations
            .into_iter()
            .find(|iteration| iteration.anchor_scope_id == day)
            .map(|iteration| iteration.status)
    };
    let mut db = factory.begin().await.unwrap();
    let open = generate_habit_iterations(&mut db, FlowId(flow), now)
        .await
        .unwrap();
    assert_eq!(
        status(open),
        Some(IterationStatus::Active),
        "the wait and the verdict are owed"
    );

    write::update_expectation(
        &mut db,
        &occurrence(TemplateKind::FlowExpectation, wait, day),
        UpdateExpectationRequest {
            status: Some(ExpectationStatus::Released),
            ..Default::default()
        },
        now,
    )
    .await
    .unwrap();
    let still = generate_habit_iterations(&mut db, FlowId(flow), now)
        .await
        .unwrap();
    assert_eq!(
        status(still),
        Some(IterationStatus::Active),
        "the verdict is still owed"
    );

    write::update_commitment(
        &mut db,
        &occurrence(TemplateKind::FlowCommitment, promise, day),
        UpdateCommitmentRequest {
            verdict: Some(Verdict::Broken),
            ..Default::default()
        },
        now,
    )
    .await
    .unwrap();
    let settled = generate_habit_iterations(&mut db, FlowId(flow), now)
        .await
        .unwrap();
    assert_eq!(
        status(settled),
        Some(IterationStatus::Done),
        "a Broken verdict is an answer given"
    );
    db.commit().await.unwrap();
}

#[tokio::test]
async fn a_wait_occurrence_is_checked_from_its_items_first_check_and_released_on_its_own() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow = flow(&app, "week", InstanceType::Task).await;
    let step = task_item(&app, flow, ("flow", flow)).await;
    let wait = wait_item(&app, flow, ("flow_task", step)).await;
    flow_commands::update_flow_expectation(
        app.state(),
        wait,
        UpdateFlowItemRequest {
            check_every: Some(Some(days(2))),
            first_check: Some(Some(FirstCheck {
                kind: "day".into(),
                index: 3,
            })),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    // A Task item waits on a wait item, here one hung on another Task item.
    let other = task_item(&app, flow, ("flow", flow)).await;
    flow_commands::add_flow_dependency(
        app.state(),
        flow,
        FlowItemType::FlowTask,
        other,
        FlowItemType::FlowExpectation,
        wait,
    )
    .await
    .unwrap();
    // The week of Sunday 4 January 2026.
    recur(&app, flow, ScopeKind::Week, ymd(2026, 1, 4)).await;
    let week = ScopeKey::containing(ScopeKind::Week, ymd(2026, 1, 4)).unwrap();
    let wait_id = occurrence(TemplateKind::FlowExpectation, wait, week);

    let early = load(&app, "2026-01-05T09:00:00").await;
    let drawn = early
        .expectations
        .iter()
        .find(|expectation| expectation.id == wait_id)
        .expect("the iteration draws its wait");
    assert_eq!(
        drawn.check_starting,
        Some(at("2026-01-06T02:00:00")),
        "its third day"
    );
    assert_eq!(
        drawn.parent_id,
        occurrence(TemplateKind::FlowTask, step, week)
    );
    let checks = |board: &MindmapLoad| {
        board
            .tasks
            .iter()
            .filter(|task| task.parent_id == wait_id)
            .count()
    };
    assert_eq!(checks(&early), 0, "nothing to check before its first check");
    assert!(
        early.task_dependencies.iter().any(|edge| {
            edge.task_id == occurrence(TemplateKind::FlowTask, other, week)
                && edge.dependency_type == "expectation"
                && edge.dependency_id == wait_id
        }),
        "the Task item's occurrence waits on this iteration's wait"
    );

    let due = load(&app, "2026-01-06T09:00:00").await;
    assert_eq!(checks(&due), 1, "its first check is due");

    let factory = helpers::session_factory(&pool);
    let mut db = factory.begin().await.unwrap();
    let released = write::update_expectation(
        &mut db,
        &wait_id,
        UpdateExpectationRequest {
            status: Some(ExpectationStatus::Released),
            ..Default::default()
        },
        at("2026-01-06T09:00:00"),
    )
    .await
    .unwrap();
    assert_eq!(released.status, ExpectationStatus::Released);
    db.commit().await.unwrap();

    let after = load(&app, "2026-01-12T09:00:00").await;
    let next_week = ScopeKey::containing(ScopeKind::Week, ymd(2026, 1, 11)).unwrap();
    let next = after
        .expectations
        .iter()
        .find(|expectation| {
            expectation.id == occurrence(TemplateKind::FlowExpectation, wait, next_week)
        })
        .expect("next week draws its own wait");
    assert_eq!(
        next.status,
        ExpectationStatus::Pending,
        "released on its own"
    );
}

#[tokio::test]
async fn starting_a_plain_flow_stores_its_commitment_and_wait_items() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow = flow(&app, "week", InstanceType::Task).await;
    let promise = commitment_item(&app, flow, ("flow", flow)).await;
    flow_commands::update_flow_commitment(
        app.state(),
        promise,
        UpdateFlowItemRequest {
            verdict_window: Some(Some(days(3))),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let wait = wait_item(&app, flow, ("flow", flow)).await;
    flow_commands::update_flow_expectation(
        app.state(),
        wait,
        UpdateFlowItemRequest {
            check_every: Some(Some(days(1))),
            first_check: Some(Some(FirstCheck {
                kind: "day".into(),
                index: 2,
            })),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let step = task_item(&app, flow, ("flow_commitment", promise)).await;
    flow_commands::set_flow_item_cycles(
        app.state(),
        flow,
        FlowItemType::FlowTask,
        step,
        vec![FlowCycleInput {
            scope_kind: Some("day".into()),
            scope_index: Some(4),
            ..Default::default()
        }],
        None,
        None,
    )
    .await
    .unwrap();
    flow_commands::add_flow_dependency(
        app.state(),
        flow,
        FlowItemType::FlowTask,
        step,
        FlowItemType::FlowExpectation,
        wait,
    )
    .await
    .unwrap();

    flow_commands::start_flow(
        app.state(),
        flow,
        StartFlowRequest {
            title: "This week".into(),
            target_type: "aspect".into(),
            target_id: 1,
            anchor_date: ymd(2026, 1, 4),
        },
    )
    .await
    .unwrap();

    let board = load(&app, "2026-01-05T09:00:00").await;
    let commitment = board
        .commitments
        .iter()
        .find(|commitment| commitment.title == "Asleep by 23:00")
        .expect("the Commitment item became a stored Commitment");
    assert!(commitment.id.stored().is_some());
    assert_eq!(commitment.verdict_window, Some(days(3)));
    assert_eq!(
        commitment.time_scope.as_ref().map(|scope| scope.start_id),
        Some(ScopeKey::containing(ScopeKind::Week, ymd(2026, 1, 4)).unwrap()),
        "over the flow window"
    );
    let stored_wait = board
        .expectations
        .iter()
        .find(|expectation| expectation.title == "Coach replies")
        .expect("the wait item became a stored wait");
    assert_eq!(stored_wait.check_every, Some(days(1)));
    assert_eq!(stored_wait.check_starting, Some(at("2026-01-05T02:00:00")));
    let task = board
        .tasks
        .iter()
        .find(|task| task.title == "Stretch")
        .unwrap();
    assert_eq!(task.parent_type, "commitment");
    assert_eq!(task.parent_id, commitment.id);
    assert!(board.task_dependencies.iter().any(|edge| {
        edge.task_id == task.id
            && edge.dependency_type == "expectation"
            && edge.dependency_id == stored_wait.id
    }));
}

#[tokio::test]
async fn copying_a_flow_copies_its_commitment_and_wait_items() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow = flow(&app, "week", InstanceType::Task).await;
    let promise = commitment_item(&app, flow, ("flow", flow)).await;
    flow_commands::update_flow_commitment(
        app.state(),
        promise,
        UpdateFlowItemRequest {
            verdict_window: Some(Some(days(3))),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let wait = wait_item(&app, flow, ("flow_commitment", promise)).await;
    flow_commands::update_flow_expectation(
        app.state(),
        wait,
        UpdateFlowItemRequest {
            check_every: Some(Some(days(1))),
            is_private: Some(true),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let copy = flow_commands::duplicate_flow(app.state(), flow, "aspect".into(), 1, 9)
        .await
        .unwrap();
    let board = load(&app, "2026-01-05T09:00:00").await;
    let promise_copy = board
        .flow_commitments
        .iter()
        .find(|item| item.flow_id == copy.id)
        .expect("the Commitment item is copied");
    assert_eq!(promise_copy.verdict_window, Some(days(3)));
    let wait_copy = board
        .flow_expectations
        .iter()
        .find(|item| item.flow_id == copy.id)
        .expect("the wait item is copied");
    assert_eq!(wait_copy.check_every, Some(days(1)));
    assert!(wait_copy.is_private, "privacy travels with a copy");
    assert_eq!(wait_copy.parent_type, "flow_commitment");
    assert_eq!(
        wait_copy.parent_id, promise_copy.id,
        "remapped onto the copy"
    );
}

#[tokio::test]
async fn converting_a_subtree_turns_its_commitments_and_waits_into_items() {
    use arlesh_lib::nodes::id::NodeId as Id;
    use arlesh_lib::tasks::model::{
        CreateCommitmentRequest, CreateExpectationRequest, CreateTaskRequest, Dependency,
    };
    let pool = helpers::test_pool().await;
    let factory = helpers::session_factory(&pool);
    let mut db = factory.begin().await.unwrap();
    let root = arlesh_lib::tasks::create_task(
        &mut db,
        CreateTaskRequest {
            title: "Launch".into(),
            parent_type: "project".into(),
            parent_id: Id::Stored(1),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let root_id = root.id.stored().unwrap();
    let week = arlesh_lib::tasks::model::TimeScope::single(
        ScopeKey::containing(ScopeKind::Week, ymd(2026, 1, 4)).unwrap(),
    );
    let promise = arlesh_lib::tasks::create_commitment(
        &mut db,
        CreateCommitmentRequest {
            title: "No scope creep".into(),
            parent_type: "task".into(),
            parent_id: root.id.clone(),
            time_scope: Some(week.clone()),
            verdict_window: Some(days(2)),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let wait = arlesh_lib::tasks::create_expectation(
        &mut db,
        CreateExpectationRequest {
            title: "Legal signs off".into(),
            parent_type: "commitment".into(),
            parent_id: promise.id.clone(),
            time_scope: Some(week),
            check_every: Some(days(1)),
            check_starting: Some(at("2026-01-06T09:00:00")),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let step = arlesh_lib::tasks::create_task(
        &mut db,
        CreateTaskRequest {
            title: "Announce".into(),
            parent_type: "commitment".into(),
            parent_id: promise.id.clone(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    arlesh_lib::tasks::add_task_dependency(
        &mut db,
        arlesh_lib::tasks::model::TaskId(step.id.stored().unwrap()),
        Dependency::Expectation {
            id: wait.id.stored().unwrap(),
        },
    )
    .await
    .unwrap();

    let flow = arlesh_lib::flows::convert_to_flow(&mut db, "task", root_id, true, true)
        .await
        .unwrap();
    db.commit().await.unwrap();

    let app = helpers::command_host(&pool);
    let board = load(&app, "2026-01-05T09:00:00").await;
    let promise_item = board
        .flow_commitments
        .iter()
        .find(|item| item.flow_id == flow.id)
        .expect("the Commitment became a Commitment item");
    assert_eq!(promise_item.title, "No scope creep");
    assert_eq!(promise_item.verdict_window, Some(days(2)));
    let wait_item = board
        .flow_expectations
        .iter()
        .find(|item| item.flow_id == flow.id)
        .expect("the wait became a wait item");
    assert_eq!(wait_item.parent_type, "flow_commitment");
    assert_eq!(wait_item.parent_id, promise_item.id);
    assert_eq!(wait_item.check_every, Some(days(1)));
    assert_eq!(
        wait_item.first_check,
        Some(FirstCheck {
            kind: "day".into(),
            index: 3
        }),
        "its Starting, as days into its window"
    );
    let step_item = board
        .flow_tasks
        .iter()
        .find(|item| item.flow_id == flow.id && item.title == "Announce")
        .unwrap();
    assert_eq!(step_item.parent_type, "flow_commitment");
    assert!(board.flow_dependencies.iter().any(|edge| {
        edge.dependent_id == step_item.id
            && edge.depends_on_type == "flow_expectation"
            && edge.depends_on_id == wait_item.id
    }));
    assert!(
        !board
            .commitments
            .iter()
            .any(|commitment| commitment.title == "No scope creep"),
        "the stored subtree is gone"
    );
}
