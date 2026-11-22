//! Writes made on the Replica: shown at once, sent in order, taken back when the server refuses
//! them or is lost, and undone locally while still unsent.

use std::{
    sync::atomic::Ordering,
    time::{Duration, Instant},
};

use arlesh_core::{
    nodes::{id::NodeId, new_id::new_row_id},
    tasks::model::{Task, UpdateTaskRequest},
};

use super::{
    queue::{DropReason, Dropped},
    tests::{first_project, session, task, Rig},
};
use crate::{
    expectations::WaitsPort, gestures::GesturesPort, http::ReadOnlyReason, tasks::TasksPort,
    undo::UndoPort, Backend,
};

async fn tasks(rig: &Rig) -> Vec<Task> {
    rig.replica
        .list_tasks(arlesh_core::clock::now())
        .await
        .expect("tasks")
}

async fn named(rig: &Rig, title: &str) -> NodeId {
    tasks(rig)
        .await
        .into_iter()
        .find(|task| task.title == title)
        .unwrap_or_else(|| panic!("no task titled {title}"))
        .id
}

/// A Replica that holds the scripted session's board.
async fn settled() -> Rig {
    let rig = Rig::start(|_| Vec::new()).await;
    session(&rig.server).await;
    rig.converge().await;
    rig
}

async fn project(rig: &Rig) -> NodeId {
    first_project(rig).await.into()
}

fn retitle(title: &str) -> UpdateTaskRequest {
    UpdateTaskRequest {
        title: Some(title.into()),
        ..Default::default()
    }
}

/// Waits for `ready`, panicking after a few seconds.
async fn until(what: &str, mut ready: impl FnMut() -> bool) {
    let start = Instant::now();
    while !ready() {
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "{what}: it did not happen"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tokio::test]
async fn a_write_shows_on_the_replica_before_the_server_answers_and_then_settles() {
    let rig = settled().await;
    let before = rig.published.lock().expect("lock").len();
    rig.gate.hold();

    let created = rig
        .replica
        .create_task(task("Shown at once", "project", project(&rig).await))
        .await
        .expect("a local answer");

    assert_eq!(created.title, "Shown at once");
    until("the board paints", || {
        rig.published.lock().expect("lock").len() > before
    })
    .await;
    assert!(named(&rig, "Shown at once").await == created.id);
    assert!(
        rig.server.rows().await != rig.replica_rows().await,
        "the server has not been told"
    );
    rig.gate.release();
    rig.converge().await;
    assert!(rig.dropped.lock().expect("lock").is_empty());
    assert_eq!(rig.gate.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_local_refusal_sends_nothing() {
    let rig = settled().await;
    let sent = rig.gate.calls.load(Ordering::SeqCst);

    let refused = rig
        .replica
        .update_task(NodeId::from(new_row_id()), retitle("Nobody"), None)
        .await;

    assert!(refused.is_err(), "no such task");
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(rig.gate.calls.load(Ordering::SeqCst), sent);
    assert!(
        rig.dropped.lock().expect("lock").is_empty(),
        "nothing was taken back"
    );
    rig.converge().await;
}

#[tokio::test]
async fn a_server_refusal_rolls_back_reruns_and_toasts_once() {
    let rig = settled().await;
    rig.server
        .bracketed
        .create_task(task("Kept", "project", project(&rig).await))
        .await
        .expect("a sibling");
    rig.converge().await;
    let (doomed, kept) = (
        named(&rig, "Second, renamed").await,
        named(&rig, "Kept").await,
    );
    rig.gate.hold();
    // Behind the replica's back, another client deletes the task the first write edits.
    let first = rig
        .replica
        .update_task(doomed.clone(), retitle("Too late"), None);
    let second = rig
        .replica
        .update_task(kept.clone(), retitle("Still wanted"), None);
    let third = rig
        .replica
        .update_task(doomed.clone(), retitle("Too late again"), None);
    let (first, second, third) = (
        first.await.expect("shown at once"),
        second.await.expect("shown at once"),
        third.await.expect("shown at once"),
    );
    assert_eq!(first.title, "Too late");
    assert_eq!(
        (second.title.as_str(), third.title.as_str()),
        ("Still wanted", "Too late again")
    );
    rig.server
        .bracketed
        .delete_task(doomed.clone())
        .await
        .expect("another client's delete");

    rig.gate.release();
    rig.converge().await;
    until("the notice", || {
        !rig.dropped.lock().expect("lock").is_empty()
    })
    .await;

    let notices = rig.dropped.lock().expect("lock").clone();
    assert_eq!(
        notices,
        vec![Dropped {
            count: 2,
            maybe_saved: 0,
            reason: DropReason::Refused
        }],
        "the refused write and the one that no longer applies, said once"
    );
    let held = tasks(&rig).await;
    assert!(held.iter().all(|task| task.id != doomed));
    assert!(
        held.iter().any(|task| task.title == "Still wanted"),
        "the write behind the refusal was made after it"
    );
}

#[tokio::test]
async fn a_lost_connection_rolls_back_drops_unsent_and_goes_read_only() {
    let rig = settled().await;
    let confirmed = rig.server.rows().await;
    rig.gate.unreachable.store(true, Ordering::SeqCst);
    rig.gate.hold();
    let parent = project(&rig).await;
    rig.replica
        .create_task(task("Lost one", "project", parent.clone()))
        .await
        .expect("shown at once");
    rig.replica
        .create_task(task("Lost two", "project", parent.clone()))
        .await
        .expect("shown at once");
    rig.source.down.store(true, Ordering::SeqCst);
    rig.source.break_streams();

    rig.gate.release();
    until("the notice", || {
        !rig.dropped.lock().expect("lock").is_empty()
    })
    .await;

    assert_eq!(
        rig.dropped.lock().expect("lock").clone(),
        vec![Dropped {
            count: 1,
            maybe_saved: 1,
            reason: DropReason::Unreachable
        }]
    );
    assert_eq!(
        rig.replica_rows().await,
        confirmed,
        "the predictions are gone"
    );
    let refused = rig
        .replica
        .create_task(task("Not now", "project", parent))
        .await
        .expect_err("read-only");
    assert_eq!(
        refused.details().and_then(|details| details.get("reason")),
        Some(&serde_json::json!(ReadOnlyReason::ServerUnreachable))
    );

    // The server comes back: the Replica fetches a board and takes writes again.
    rig.gate.unreachable.store(false, Ordering::SeqCst);
    rig.source.down.store(false, Ordering::SeqCst);
    rig.converge().await;
    let parent = project(&rig).await;
    let start = Instant::now();
    loop {
        if rig
            .replica
            .create_task(task("Back", "project", parent.clone()))
            .await
            .is_ok()
        {
            break;
        }
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "writes never came back"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    rig.converge().await;
}

#[tokio::test]
async fn a_press_on_a_provisional_node_waits_until_settled() {
    let rig = settled().await;
    let source = named(&rig, "Second, renamed").await;
    let target = project(&rig).await;
    rig.gate.hold();
    // A duplicate makes rows (the copies' children) the press never named.
    let copy = rig
        .replica
        .duplicate_task(
            source.require_stored().expect("stored"),
            "project".into(),
            target.require_stored().expect("stored"),
            0,
        )
        .await
        .expect("shown at once");
    let copied = copy.copy.id.clone();

    let press = tokio::spawn({
        let replica = std::sync::Arc::clone(&rig.replica);
        async move {
            replica
                .update_task(copied, retitle("On the copy"), None)
                .await
        }
    });
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert!(
        !press.is_finished(),
        "the press waits while the copy is unconfirmed"
    );

    rig.gate.release();
    let answered = tokio::time::timeout(Duration::from_secs(10), press)
        .await
        .expect("the press is answered once settled")
        .expect("the task ran");
    // The copy's ids follow the write's seed on both sides, so the press finds the copy.
    answered.expect("the copy has the same id on the server");
    rig.converge().await;
}

#[tokio::test]
async fn undo_cancels_an_unsent_action_locally() {
    let rig = settled().await;
    let parent = project(&rig).await;
    rig.gate.hold();
    rig.replica
        .create_task(task("In flight", "project", parent.clone()))
        .await
        .expect("shown at once");
    until("the first write is on its way", || {
        rig.gate.calls.load(Ordering::SeqCst) == 1
    })
    .await;
    rig.replica
        .create_task(task("Unsent", "project", parent))
        .await
        .expect("shown at once");

    let undone = rig.replica.undo().await.expect("an answer");

    assert!(
        undone.is_some_and(|summary| summary.inserted >= 1),
        "it says what it undid"
    );
    assert!(tasks(&rig).await.iter().all(|task| task.title != "Unsent"));
    rig.gate.release();
    rig.converge().await;
    assert_eq!(
        rig.gate.calls.load(Ordering::SeqCst),
        1,
        "the cancelled write was never sent"
    );
    assert!(tasks(&rig)
        .await
        .iter()
        .any(|task| task.title == "In flight"));
}

#[tokio::test]
async fn undo_after_sent_waits_then_goes_to_the_server() {
    let rig = settled().await;
    let parent = project(&rig).await;
    rig.gate.hold();
    rig.replica
        .create_task(task("Sent", "project", parent))
        .await
        .expect("shown at once");
    until("the write is on its way", || {
        rig.gate.calls.load(Ordering::SeqCst) == 1
    })
    .await;
    let undo = tokio::spawn({
        let replica = std::sync::Arc::clone(&rig.replica);
        async move { replica.undo().await }
    });
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(
        !undo.is_finished(),
        "the undo waits for the write it follows"
    );

    rig.gate.release();
    let undone = tokio::time::timeout(Duration::from_secs(10), undo)
        .await
        .expect("answered")
        .expect("ran")
        .expect("the server's answer");

    assert!(undone.is_some(), "the server had a gesture to undo");
    rig.converge().await;
    assert!(tasks(&rig).await.iter().all(|task| task.title != "Sent"));
    assert_eq!(
        rig.source.told.snapshots.load(Ordering::SeqCst),
        1,
        "the undo settled without falling back to a whole board"
    );
    let _ = rig.replica.undo_status().await;
    let _: Option<&dyn Backend> = None;
}

#[tokio::test]
async fn a_press_records_where_its_time_went() {
    let rig = settled().await;

    rig.replica
        .create_task(task("Timed", "project", project(&rig).await))
        .await
        .expect("shown at once");
    until("the timing is kept", || {
        !rig.replica.press_timings().is_empty()
    })
    .await;

    let timing = rig.replica.press_timings().pop().expect("a timing");
    assert!(timing.turn.derive > Duration::ZERO || timing.turn.read > Duration::ZERO);
    rig.converge().await;
}

#[tokio::test]
async fn a_session_that_ends_on_an_error_drops_the_queue_and_sends_nothing_after_reconnect() {
    let rig = settled().await;
    let parent = project(&rig).await;
    let doomed = named(&rig, "Second, renamed").await;
    // The event that says the task is gone never arrives, so settling has to fetch a whole board,
    // and that fetch fails.
    let next = rig.server.seq() + 1;
    rig.source.drop_events(next..next + 3);
    rig.gate.hold();
    rig.replica
        .update_task(doomed.clone(), retitle("Too late"), None)
        .await
        .expect("shown at once");
    rig.replica
        .create_task(task("Queued one", "project", parent.clone()))
        .await
        .expect("shown at once");
    rig.replica
        .create_task(task("Queued two", "project", parent))
        .await
        .expect("shown at once");
    until("the first write is on its way", || {
        rig.gate.calls.load(Ordering::SeqCst) == 1
    })
    .await;
    rig.server
        .bracketed
        .delete_task(doomed)
        .await
        .expect("another client's delete");
    rig.source.snapshot_fails.store(true, Ordering::SeqCst);

    rig.gate.release();
    until("the notice", || {
        !rig.dropped.lock().expect("lock").is_empty()
    })
    .await;
    rig.source.snapshot_fails.store(false, Ordering::SeqCst);
    rig.converge().await;

    assert_eq!(
        rig.gate.calls.load(Ordering::SeqCst),
        1,
        "only the refused write ever reached the server: nothing queued survived the session"
    );
    let titles: Vec<String> = tasks(&rig)
        .await
        .into_iter()
        .map(|task| task.title)
        .collect();
    assert!(
        !titles.iter().any(|title| title.starts_with("Queued")),
        "{titles:?}"
    );
}

#[tokio::test]
async fn undo_while_a_press_is_parked_cancels_the_press_and_never_touches_the_server_stack() {
    let rig = settled().await;
    let source = named(&rig, "Second, renamed").await;
    let target = project(&rig).await;
    rig.gate.hold();
    let copy = rig
        .replica
        .duplicate_task(
            source.require_stored().expect("stored"),
            "project".into(),
            target.require_stored().expect("stored"),
            0,
        )
        .await
        .expect("shown at once");
    let press = tokio::spawn({
        let replica = std::sync::Arc::clone(&rig.replica);
        let copied = copy.copy.id.clone();
        async move {
            replica
                .update_task(copied, retitle("On the copy"), None)
                .await
        }
    });
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(!press.is_finished(), "the press is parked");

    let undone = rig.replica.undo().await.expect("an answer");

    assert!(undone.is_some(), "the parked press is what was undone");
    assert!(
        press.await.expect("ran").is_err(),
        "the cancelled press is told so"
    );
    rig.gate.release();
    rig.converge().await;
    assert!(
        tasks(&rig).await.iter().any(|task| task.id == copy.copy.id),
        "the duplicate before it was not undone on the server"
    );
}

#[tokio::test]
async fn a_local_refusal_that_is_an_answer_sends_nothing() {
    let rig = settled().await;
    let agentic = rig
        .server
        .bracketed
        .create_task(arlesh_core::tasks::model::CreateTaskRequest {
            agentic: Some(arlesh_core::tasks::model::TaskAgentic::Yes),
            ..task("Agent work", "project", project(&rig).await)
        })
        .await
        .expect("an agentic task")
        .id;
    rig.converge().await;
    let sent = rig.gate.calls.load(Ordering::SeqCst);

    let outcome = rig
        .replica
        .step_task_status(
            agentic,
            arlesh_core::tasks::rules::gestures::StatusStep::Alt,
            None,
        )
        .await
        .expect("an answer");

    assert!(matches!(
        outcome,
        crate::gestures::StatusStepOutcome::Refused { .. }
    ));
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(
        rig.gate.calls.load(Ordering::SeqCst),
        sent,
        "a refusal is never sent"
    );
    assert!(rig.dropped.lock().expect("lock").is_empty());
}

#[tokio::test]
async fn a_server_answer_that_differs_from_the_prediction_is_said_once() {
    let rig = settled().await;
    let agentic = rig
        .server
        .bracketed
        .create_task(arlesh_core::tasks::model::CreateTaskRequest {
            agentic: Some(arlesh_core::tasks::model::TaskAgentic::Yes),
            ..task("Agent work", "project", project(&rig).await)
        })
        .await
        .expect("an agentic task")
        .id;
    let wait = rig
        .server
        .bracketed
        .create_expectation(arlesh_core::tasks::model::CreateExpectationRequest {
            title: "Which one?".into(),
            parent_type: "task".into(),
            parent_id: agentic,
            agentic: true,
            agentic_note: Some("Pick".into()),
            ..Default::default()
        })
        .await
        .expect("a wait")
        .id;
    let draft = || arlesh_core::tasks::answer_drafts::model::DraftRequest {
        answer: Some("The second".into()),
        verdict: None,
    };
    rig.server
        .bracketed
        .save_answer_draft(wait.clone(), draft())
        .await
        .expect("a draft");
    rig.converge().await;
    rig.gate.hold();
    let sent = rig
        .replica
        .send_answer_drafts(arlesh_core::tasks::answer_drafts::model::SendRequest {
            shown: vec![wait.clone()],
        })
        .await
        .expect("shown at once");
    assert!(sent.skipped.is_empty(), "the Replica sent it");
    // Another client sends the same answer first.
    rig.server
        .bracketed
        .send_answer_drafts(arlesh_core::tasks::answer_drafts::model::SendRequest {
            shown: vec![wait],
        })
        .await
        .expect("another client's send");

    rig.gate.release();
    until("the notice", || {
        !rig.dropped.lock().expect("lock").is_empty()
    })
    .await;

    assert_eq!(
        rig.dropped.lock().expect("lock").clone(),
        vec![Dropped {
            count: 1,
            maybe_saved: 0,
            reason: DropReason::Differed
        }]
    );
    rig.converge().await;
}

#[tokio::test]
async fn redo_after_a_local_cancel_does_not_go_to_the_server_and_undo_status_counts_unsent_writes()
{
    let rig = settled().await;
    let parent = project(&rig).await;
    rig.gate.hold();
    rig.replica
        .create_task(task("In flight", "project", parent.clone()))
        .await
        .expect("shown at once");
    until("the first write is on its way", || {
        rig.gate.calls.load(Ordering::SeqCst) == 1
    })
    .await;
    rig.replica
        .create_task(task("Unsent", "project", parent))
        .await
        .expect("shown at once");
    let status = rig.replica.undo_status().await.expect("a status");
    assert!(
        status.undo.is_some_and(|summary| summary.inserted >= 1),
        "the unsent write is what Ctrl+Z would undo"
    );

    rig.replica.undo().await.expect("cancelled locally");
    let redone = rig.replica.redo().await.expect("an answer");

    assert!(redone.is_none(), "there is nothing the server could redo");
    rig.gate.release();
    rig.converge().await;
    assert_eq!(
        rig.gate.calls.load(Ordering::SeqCst),
        1,
        "neither press was sent"
    );
}
