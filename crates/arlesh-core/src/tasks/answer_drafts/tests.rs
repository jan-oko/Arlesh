use super::*;
use crate::database::open::{open, OpenMode};
use crate::domains::model::{CreateDomainRequest, DomainSubtype};
use crate::nodes::id::RowId;
use crate::tasks::model::{
    CreateExpectationRequest, CreateTaskRequest, ExpectationArchival, ReviewDetails, TaskAgentic,
};
use std::sync::atomic::{AtomicU32, Ordering};

/// Distinguishes the scratch directories of tests running concurrently in one process.
static NEXT_DIRECTORY: AtomicU32 = AtomicU32::new(0);

fn now() -> NaiveDateTime {
    crate::clock::now()
}

async fn session() -> Db<Transactional> {
    let directory = std::env::temp_dir().join(format!(
        "arlesh-answer-drafts-test-{}-{}",
        std::process::id(),
        NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();
    let factory = open(
        &directory.join("arlesh.db"),
        OpenMode::Write {
            client: "test".parse().unwrap(),
            force: false,
        },
    )
    .await
    .unwrap();
    factory.begin().await.unwrap()
}

/// An agentic Task in a fresh Project.
async fn agentic_task(db: &mut Db<Transactional>) -> NodeId {
    let aspect: RowId = db
        .domains()
        .list(Some(DomainSubtype::Aspect))
        .await
        .unwrap()[0]
        .id;
    let project = db
        .domains()
        .create(CreateDomainRequest {
            id: None,
            title: "Agents".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(aspect),
            status: None,
            knowledge_base_directory: None,
        })
        .await
        .unwrap()
        .id;
    crate::tasks::create_task(
        db,
        CreateTaskRequest {
            title: "Work".into(),
            parent_type: "project".into(),
            parent_id: project.into(),
            agentic: Some(TaskAgentic::Yes),
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .id
}

async fn ask(db: &mut Db<Transactional>, task: &NodeId, title: &str) -> NodeId {
    crate::tasks::create_expectation(
        db,
        CreateExpectationRequest {
            title: title.into(),
            parent_type: "task".into(),
            parent_id: task.clone(),
            agentic: true,
            agentic_note: Some("Which one?".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .id
}

async fn raise_review(db: &mut Db<Transactional>, task: &NodeId) -> NodeId {
    crate::tasks::create_expectation(
        db,
        CreateExpectationRequest {
            title: "PR is up".into(),
            parent_type: "task".into(),
            parent_id: task.clone(),
            agentic: true,
            agentic_note: Some("Please look".into()),
            review: Some(ReviewDetails::default()),
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .id
}

fn answer(text: &str) -> DraftRequest {
    DraftRequest {
        answer: Some(text.into()),
        verdict: None,
    }
}

async fn wait_named(db: &mut Db<Transactional>, id: &NodeId) -> Option<Expectation> {
    waits_by_id(db, now()).await.unwrap().remove(id)
}

#[tokio::test]
async fn saving_a_question_draft_stages_it_and_leaves_the_wait_pending() {
    let mut db = session().await;
    let task = agentic_task(&mut db).await;
    let wait = ask(&mut db, &task, "Colour?").await;

    let saved = save_draft(&mut db, &wait, answer(" blue "), now())
        .await
        .unwrap();

    assert_eq!(saved.answer.as_deref(), Some("blue"));
    assert_eq!(db.answer_drafts().list().await.unwrap(), vec![saved]);
    let stored = wait_named(&mut db, &wait).await.unwrap();
    assert_eq!(stored.status, ExpectationStatus::Pending);
    assert_eq!(stored.answer, None);
}

#[tokio::test]
async fn the_last_save_wins() {
    let mut db = session().await;
    let task = agentic_task(&mut db).await;
    let wait = ask(&mut db, &task, "Colour?").await;
    save_draft(&mut db, &wait, answer("red"), now())
        .await
        .unwrap();

    save_draft(&mut db, &wait, answer("blue"), now())
        .await
        .unwrap();

    let drafts = db.answer_drafts().list().await.unwrap();
    assert_eq!(drafts.len(), 1);
    assert_eq!(drafts[0].answer.as_deref(), Some("blue"));
}

#[tokio::test]
async fn a_review_draft_holds_a_verdict_and_a_note() {
    let mut db = session().await;
    let task = agentic_task(&mut db).await;
    let wait = raise_review(&mut db, &task).await;

    let saved = save_draft(
        &mut db,
        &wait,
        DraftRequest {
            answer: Some("fix the tests".into()),
            verdict: Some(ReviewVerdict::ChangesRequested),
        },
        now(),
    )
    .await
    .unwrap();

    assert_eq!(saved.verdict, Some(ReviewVerdict::ChangesRequested));
    assert_eq!(saved.answer.as_deref(), Some("fix the tests"));
}

#[tokio::test]
async fn a_refused_save_writes_nothing() {
    let mut db = session().await;
    let task = agentic_task(&mut db).await;
    let question = ask(&mut db, &task, "Colour?").await;
    let review = raise_review(&mut db, &task).await;
    let missing: NodeId = "6b0f3b9e-0000-4000-8000-000000000001".parse().unwrap();

    let blank = save_draft(&mut db, &question, answer("  "), now()).await;
    let with_verdict = save_draft(
        &mut db,
        &question,
        DraftRequest {
            answer: Some("x".into()),
            verdict: Some(ReviewVerdict::Approved),
        },
        now(),
    )
    .await;
    let without_verdict = save_draft(&mut db, &review, answer("note"), now()).await;
    let nowhere = save_draft(&mut db, &missing, answer("x"), now()).await;

    for refused in [blank, with_verdict, without_verdict, nowhere] {
        assert!(matches!(
            refused,
            Err(AppError::Task(TaskError::AnswerDraft(_)))
        ));
    }
    assert!(db.answer_drafts().list().await.unwrap().is_empty());
}

#[tokio::test]
async fn a_released_wait_takes_no_draft() {
    let mut db = session().await;
    let task = agentic_task(&mut db).await;
    let wait = ask(&mut db, &task, "Colour?").await;
    release_directly(&mut db, &wait).await;

    let refused = save_draft(&mut db, &wait, answer("blue"), now()).await;

    assert!(matches!(
        refused,
        Err(AppError::Task(TaskError::AnswerDraft(
            DraftRefusal::NotOpen
        )))
    ));
}

async fn release_directly(db: &mut Db<Transactional>, wait: &NodeId) {
    crate::nodes::write::update_expectation(
        db,
        wait,
        UpdateExpectationRequest {
            status: Some(ExpectationStatus::Released),
            answer: Some(Some("someone else".into())),
            ..Default::default()
        },
        now(),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn clearing_removes_the_draft_and_is_idempotent() {
    let mut db = session().await;
    let task = agentic_task(&mut db).await;
    let wait = ask(&mut db, &task, "Colour?").await;
    save_draft(&mut db, &wait, answer("blue"), now())
        .await
        .unwrap();

    clear_draft(&mut db, &wait).await.unwrap();
    clear_draft(&mut db, &wait).await.unwrap();

    assert!(db.answer_drafts().list().await.unwrap().is_empty());
}

#[tokio::test]
async fn sending_releases_every_staged_wait_with_its_answer_and_deletes_the_drafts() {
    let mut db = session().await;
    let task = agentic_task(&mut db).await;
    let question = ask(&mut db, &task, "Colour?").await;
    let review = raise_review(&mut db, &task).await;
    save_draft(&mut db, &question, answer("blue"), now())
        .await
        .unwrap();
    save_draft(
        &mut db,
        &review,
        DraftRequest {
            answer: None,
            verdict: Some(ReviewVerdict::Approved),
        },
        now(),
    )
    .await
    .unwrap();

    let outcome = send_drafts(&mut db, SendRequest::default(), now())
        .await
        .unwrap();

    let sent: BTreeSet<NodeId> = outcome
        .sent
        .iter()
        .map(|sent| sent.wait_id.clone())
        .collect();
    assert_eq!(sent, BTreeSet::from([question.clone(), review.clone()]));
    assert!(outcome.sent.iter().all(|sent| sent.task_id == task));
    assert!(outcome.skipped.is_empty());
    assert!(db.answer_drafts().list().await.unwrap().is_empty());
    let answered = wait_named(&mut db, &question).await.unwrap();
    assert_eq!(answered.status, ExpectationStatus::Released);
    assert_eq!(answered.answer.as_deref(), Some("blue"));
    let reviewed = wait_named(&mut db, &review).await.unwrap();
    assert_eq!(reviewed.status, ExpectationStatus::Released);
    assert_eq!(
        reviewed.review.and_then(|review| review.verdict),
        Some(ReviewVerdict::Approved)
    );
}

#[tokio::test]
async fn a_draft_whose_wait_was_released_meanwhile_is_skipped_and_the_rest_sent() {
    let mut db = session().await;
    let task = agentic_task(&mut db).await;
    let stale = ask(&mut db, &task, "Stale?").await;
    let fresh = ask(&mut db, &task, "Fresh?").await;
    save_draft(&mut db, &stale, answer("a"), now())
        .await
        .unwrap();
    save_draft(&mut db, &fresh, answer("b"), now())
        .await
        .unwrap();
    release_directly(&mut db, &stale).await;

    let outcome = send_drafts(&mut db, SendRequest::default(), now())
        .await
        .unwrap();

    assert_eq!(outcome.sent.len(), 1);
    assert_eq!(outcome.sent[0].wait_id, fresh);
    assert_eq!(
        outcome.skipped,
        vec![SkippedDraft {
            wait_id: stale,
            task_id: Some(task),
            title: Some("Stale?".into()),
            reason: SkipReason::Released,
        }]
    );
    assert!(db.answer_drafts().list().await.unwrap().is_empty());
}

#[tokio::test]
async fn a_draft_whose_wait_was_archived_is_skipped_as_gone() {
    let mut db = session().await;
    let task = agentic_task(&mut db).await;
    let wait = ask(&mut db, &task, "Gone?").await;
    save_draft(&mut db, &wait, answer("a"), now())
        .await
        .unwrap();
    crate::nodes::write::update_expectation(
        &mut db,
        &wait,
        UpdateExpectationRequest {
            archival: Some(ExpectationArchival::Archived),
            ..Default::default()
        },
        now(),
    )
    .await
    .unwrap();

    let outcome = send_drafts(&mut db, SendRequest::default(), now())
        .await
        .unwrap();

    assert!(outcome.sent.is_empty());
    assert_eq!(outcome.skipped.len(), 1);
    assert_eq!(outcome.skipped[0].reason, SkipReason::Gone);
}

#[tokio::test]
async fn a_draft_whose_wait_was_deleted_is_skipped_as_gone_without_a_title() {
    let mut db = session().await;
    let task = agentic_task(&mut db).await;
    let wait = ask(&mut db, &task, "Deleted?").await;
    save_draft(&mut db, &wait, answer("a"), now())
        .await
        .unwrap();
    crate::nodes::composite::delete_wait(&mut db, &wait, now())
        .await
        .unwrap();

    let outcome = send_drafts(&mut db, SendRequest::default(), now())
        .await
        .unwrap();

    assert_eq!(
        outcome.skipped,
        vec![SkippedDraft {
            wait_id: wait,
            task_id: None,
            title: None,
            reason: SkipReason::Gone,
        }]
    );
    assert!(db.answer_drafts().list().await.unwrap().is_empty());
}

#[tokio::test]
async fn a_shown_wait_with_no_draft_is_reported_by_why() {
    let mut db = session().await;
    let task = agentic_task(&mut db).await;
    let unstaged = ask(&mut db, &task, "Unstaged?").await;
    let released = ask(&mut db, &task, "Released?").await;
    release_directly(&mut db, &released).await;
    let missing: NodeId = "6b0f3b9e-0000-4000-8000-000000000002".parse().unwrap();

    let outcome = send_drafts(
        &mut db,
        SendRequest {
            shown: vec![unstaged.clone(), released.clone(), missing.clone()],
        },
        now(),
    )
    .await
    .unwrap();

    let reasons: Vec<(NodeId, SkipReason)> = outcome
        .skipped
        .iter()
        .map(|skipped| (skipped.wait_id.clone(), skipped.reason))
        .collect();
    assert_eq!(
        reasons,
        vec![
            (unstaged, SkipReason::Unstaged),
            (released, SkipReason::Released),
            (missing, SkipReason::Gone),
        ]
    );
}

#[tokio::test]
async fn a_staged_wait_that_is_also_shown_is_sent_once_and_not_skipped() {
    let mut db = session().await;
    let task = agentic_task(&mut db).await;
    let wait = ask(&mut db, &task, "Colour?").await;
    save_draft(&mut db, &wait, answer("blue"), now())
        .await
        .unwrap();

    let outcome = send_drafts(
        &mut db,
        SendRequest {
            shown: vec![wait.clone()],
        },
        now(),
    )
    .await
    .unwrap();

    assert_eq!(outcome.sent.len(), 1);
    assert!(outcome.skipped.is_empty());
}

#[tokio::test]
async fn a_send_with_nothing_staged_answers_empty() {
    let mut db = session().await;
    let outcome = send_drafts(&mut db, SendRequest::default(), now())
        .await
        .unwrap();
    assert_eq!(outcome, SendOutcome::default());
}

#[tokio::test]
async fn the_send_is_refused_whole_when_one_release_is_refused() {
    let mut db = session().await;
    let task = agentic_task(&mut db).await;
    let wait = ask(&mut db, &task, "Colour?").await;
    // A draft the rule would never have saved: a question with no answer, as a bad write or a
    // restored row might leave.
    db.answer_drafts()
        .upsert(&AnswerDraft {
            wait_id: wait.clone(),
            answer: None,
            verdict: Some(ReviewVerdict::Approved),
            saved_at: now(),
        })
        .await
        .unwrap();

    let refused = send_drafts(&mut db, SendRequest::default(), now()).await;

    match refused {
        Err(AppError::Task(TaskError::DraftSendRefused { title, .. })) => {
            assert_eq!(title, "Colour?");
        }
        other => panic!("expected the send to be refused, got {other:?}"),
    }
}

/// A wait that is derived, with no `expectations` row: the one a done Asynchronous Task spawns,
/// made an agentic question through its overlay.
async fn spawned_question(db: &mut Db<Transactional>) -> NodeId {
    use crate::tasks::model::{AsyncTemplate, Status, TaskStatus};
    let project = first_project(db).await;
    let task = crate::tasks::create_task(
        db,
        CreateTaskRequest {
            title: "Sends the email".into(),
            parent_type: "project".into(),
            parent_id: project.into(),
            status: Some(Status::Ordinary(TaskStatus::Done)),
            asynchronous: Some(true),
            async_template: Some(AsyncTemplate {
                title: "Reply".into(),
                ..Default::default()
            }),
            agentic: Some(TaskAgentic::Yes),
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .id;
    let spawned = waits_by_id(db, now())
        .await
        .unwrap()
        .into_values()
        .find(|wait| wait.parent_id == task)
        .expect("the done Task spawned a wait")
        .id;
    crate::nodes::write::update_expectation(
        db,
        &spawned,
        UpdateExpectationRequest {
            agentic: Some(true),
            question: Some(true),
            ..Default::default()
        },
        now(),
    )
    .await
    .unwrap();
    spawned
}

async fn first_project(db: &mut Db<Transactional>) -> RowId {
    db.domains()
        .list(Some(DomainSubtype::Project))
        .await
        .unwrap()[0]
        .id
}

#[tokio::test]
async fn a_derived_wait_is_staged_and_sent_like_a_stored_one() {
    let mut db = session().await;
    agentic_task(&mut db).await;
    let spawned = spawned_question(&mut db).await;
    assert!(spawned.is_derived());

    save_draft(&mut db, &spawned, answer("tomorrow"), now())
        .await
        .unwrap();
    let outcome = send_drafts(&mut db, SendRequest::default(), now())
        .await
        .unwrap();

    assert_eq!(outcome.sent.len(), 1);
    assert_eq!(outcome.sent[0].wait_id, spawned);
    let released = wait_named(&mut db, &spawned).await.unwrap();
    assert_eq!(released.status, ExpectationStatus::Released);
    assert_eq!(released.answer.as_deref(), Some("tomorrow"));
}
