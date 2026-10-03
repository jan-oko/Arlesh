//! Command-level tests for the gestures the backend decides: the status cycle and `Alt+Enter`,
//! the Agentic key and the verdict controls.
//!
//! The rules themselves are unit-tested in `tasks::rules::gestures`; what these prove is that each
//! command reads the node as it stands, writes what the rule says through the editor's own writer,
//! and commits.

use crate::helpers;

use arlesh_lib::commands::{
    commitments as commitment_commands, gestures, gestures::StatusStepOutcome,
    tasks as task_commands,
};
use arlesh_lib::scopes::{key::ScopeKey, model::ScopeKind};
use arlesh_lib::tasks::{
    model::{
        AgenticStatus, CreateCommitmentRequest, CreateTaskRequest, Status, Task, TaskArchival,
        TaskStatus, TimeScope, UpdateTaskRequest, Verdict,
    },
    rules::gestures::{BacklogCleared, StatusRefusal, StatusStep, VerdictPress},
};
use tauri::Manager;

async fn task(app: &tauri::App<tauri::test::MockRuntime>, title: &str) -> Task {
    task_commands::create_task(
        app.state(),
        CreateTaskRequest {
            title: title.into(),
            parent_type: "aspect".into(),
            parent_id: 1.into(),
            ..Default::default()
        },
    )
    .await
    .unwrap()
}

fn written(outcome: StatusStepOutcome) -> (Task, Option<BacklogCleared>) {
    match outcome {
        StatusStepOutcome::Written {
            task,
            backlog_cleared,
        } => (*task, backlog_cleared),
        StatusStepOutcome::Refused { reason } => panic!("refused: {reason:?}"),
    }
}

#[tokio::test]
async fn enter_advances_a_task_one_step_of_its_cycle() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let created = task(&app, "Write").await;

    let outcome =
        gestures::step_task_status(app.state(), created.id.clone(), StatusStep::Advance, None)
            .await
            .unwrap();
    let (task, cleared) = written(outcome);
    assert_eq!(task.status, Status::Ordinary(TaskStatus::InProgress));
    assert_eq!(cleared, None);

    let outcome = gestures::step_task_status(app.state(), created.id, StatusStep::Advance, None)
        .await
        .unwrap();
    assert_eq!(
        written(outcome).0.status,
        Status::Ordinary(TaskStatus::Done)
    );
}

#[tokio::test]
async fn starting_a_backlogged_task_says_it_came_out_of_the_backlog() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let created = task(&app, "Someday").await;
    task_commands::update_task(
        app.state(),
        created.id.clone(),
        UpdateTaskRequest {
            archival: Some(TaskArchival::Backlog),
            ..Default::default()
        },
        None,
    )
    .await
    .unwrap();

    let outcome = gestures::step_task_status(app.state(), created.id, StatusStep::Alt, None)
        .await
        .unwrap();
    let (task, cleared) = written(outcome);
    assert_eq!(task.status, Status::Ordinary(TaskStatus::Started));
    assert_eq!(task.archival, TaskArchival::Live);
    assert_eq!(cleared, Some(BacklogCleared::ByStarted));
}

#[tokio::test]
async fn alt_enter_on_an_agentic_task_that_is_not_doing_is_refused_and_writes_nothing() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let created = task(&app, "Delegate").await;
    let toggled = gestures::toggle_task_agentic(app.state(), created.id.clone())
        .await
        .unwrap();
    assert_eq!(toggled.status, Status::Agentic(AgenticStatus::Todo));

    let outcome =
        gestures::step_task_status(app.state(), created.id.clone(), StatusStep::Alt, None)
            .await
            .unwrap();
    assert!(matches!(
        outcome,
        StatusStepOutcome::Refused {
            reason: StatusRefusal::AltEnterAgenticNotDoing
        }
    ));

    let back = gestures::toggle_task_agentic(app.state(), created.id)
        .await
        .unwrap();
    assert_eq!(
        back.status,
        Status::Ordinary(TaskStatus::Todo),
        "the key flips what the task reads as, each press"
    );
}

#[tokio::test]
async fn the_verdict_controls_toggle_and_the_cycle_walks_all_three() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let week = ScopeKey::containing(ScopeKind::Week, chrono::Local::now().date_naive()).unwrap();
    let commitment = commitment_commands::create_commitment(
        app.state(),
        CreateCommitmentRequest {
            title: "Call home".into(),
            parent_type: "aspect".into(),
            parent_id: 1.into(),
            time_scope: Some(TimeScope {
                start_id: week,
                end_id: week,
                duration: None,
            }),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let press =
        |press| gestures::press_commitment_verdict(app.state(), commitment.id.clone(), press);
    assert_eq!(
        press(VerdictPress::Kept).await.unwrap().verdict,
        Verdict::Kept
    );
    assert_eq!(
        press(VerdictPress::Kept).await.unwrap().verdict,
        Verdict::Unresolved,
        "pressing the control it reads clears it"
    );
    assert_eq!(
        press(VerdictPress::Cycle).await.unwrap().verdict,
        Verdict::Kept
    );
    assert_eq!(
        press(VerdictPress::Cycle).await.unwrap().verdict,
        Verdict::Broken
    );
}
