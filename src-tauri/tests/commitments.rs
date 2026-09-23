//! Write-time rules for Commitments, and how a Commitment reads back once derived.
//!
//! The pure halves — what verdict a Commitment reads as, and what a retype would carry or drop —
//! are unit-tested where they live (`tasks::lifecycle`, `tasks::retype`). What needs a session,
//! and so lives here, is everything that has to consult the tree: the effective-scope rule, the
//! containment rule between a parent Commitment and its children, and the inheritance of both a
//! window and a Verdict Window down a subtree.

mod helpers;

use arlesh_lib::{
    domains::model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
    scopes::model::ScopeKind,
    tasks::{
        create_commitment, create_task, delete_commitment, derive_all_scope_lifecycles,
        error::TaskError,
        lifecycle::{Archival, Timing},
        model::{
            CommitmentId, CreateCommitmentRequest, CreateTaskRequest, DurationSpec, TimeScope,
            UpdateCommitmentRequest, Verdict,
        },
        update_commitment,
    },
};
use chrono::{NaiveDate, NaiveDateTime};

/// A project under the fixed Growth aspect, to hang fixtures off.
async fn make_project(pool: &sqlx::SqlitePool) -> i64 {
    let aspect_id: i64 =
        sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
            .fetch_one(pool)
            .await
            .unwrap();
    helpers::session_factory(pool)
        .connect()
        .await
        .unwrap()
        .domains()
        .create(CreateDomainRequest {
            title: "Test Project".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(aspect_id),
            status: Some(ProjectStatus::Active),
            knowledge_base_directory: None,
        })
        .await
        .unwrap()
        .id
}

/// A single-scope Time Scope of `kind` covering `date`.
async fn window(_pool: &sqlx::SqlitePool, kind: ScopeKind, date: NaiveDate) -> TimeScope {
    let scope = arlesh_lib::scopes::model::Scope::containing(kind, date).unwrap();
    TimeScope {
        start_id: scope.id,
        end_id: scope.id,
        duration: None,
    }
}

fn july(day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 7, day).unwrap()
}

fn at(iso: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%S").unwrap()
}

/// Runs `create_commitment` on its own transaction, committing only on success.
async fn create(
    pool: &sqlx::SqlitePool,
    request: CreateCommitmentRequest,
) -> Result<arlesh_lib::tasks::model::Commitment, TaskError> {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let result = create_commitment(&mut db, request).await;
    if result.is_ok() {
        db.commit().await.unwrap();
    }
    result
}

/// Runs `update_commitment` on its own transaction, committing only on success.
async fn update(
    pool: &sqlx::SqlitePool,
    id: i64,
    request: UpdateCommitmentRequest,
) -> Result<arlesh_lib::tasks::model::Commitment, TaskError> {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let result = update_commitment(&mut db, CommitmentId(id), request).await;
    if result.is_ok() {
        db.commit().await.unwrap();
    }
    result
}

// ---------------------------------------------------------------------------
// The effective-scope rule
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_commitment_with_a_window_of_its_own_is_created() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let tonight = window(&pool, ScopeKind::Day, july(1)).await;

    let commitment = create(
        &pool,
        CreateCommitmentRequest {
            title: "Asleep by 23:00".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(tonight.clone()),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    assert_eq!(commitment.time_scope, Some(tonight));
    assert_eq!(
        commitment.verdict,
        Verdict::Unresolved,
        "nobody has judged it yet"
    );
}

#[tokio::test]
async fn a_commitment_with_no_scoped_ancestor_at_all_is_refused() {
    // The rule that exists for this kind alone. Every other node may be Unscoped — always
    // active, never lapsing — but a commitment with no window can never come due, so it is
    // refused rather than written.
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let refused = create(
        &pool,
        CreateCommitmentRequest {
            title: "No social media".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        },
    )
    .await;

    assert!(
        matches!(refused, Err(TaskError::CommitmentUnscoped)),
        "got {refused:?}"
    );
}

#[tokio::test]
async fn a_commitment_under_a_scoped_parent_needs_no_window_of_its_own() {
    // Several of tonight's commitments under one scoped parent, without repeating the window on
    // each — the inheritance an Unscoped-is-invalid rule would otherwise make impossible.
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let tonight = window(&pool, ScopeKind::Day, july(1)).await;

    let parent = create(
        &pool,
        CreateCommitmentRequest {
            title: "Tonight".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(tonight),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let child = create(
        &pool,
        CreateCommitmentRequest {
            title: "Asleep by 23:00".into(),
            parent_type: "commitment".into(),
            parent_id: parent.id,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    assert_eq!(child.time_scope, None, "it holds no window of its own");
}

#[tokio::test]
async fn clearing_the_last_window_above_a_commitment_is_refused() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let tonight = window(&pool, ScopeKind::Day, july(1)).await;

    let commitment = create(
        &pool,
        CreateCommitmentRequest {
            title: "Asleep by 23:00".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(tonight),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let refused = update(
        &pool,
        commitment.id,
        UpdateCommitmentRequest {
            time_scope: Some(None),
            ..Default::default()
        },
    )
    .await;

    assert!(
        matches!(refused, Err(TaskError::CommitmentUnscoped)),
        "got {refused:?}"
    );
}

// ---------------------------------------------------------------------------
// Containment
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_child_commitments_window_must_fit_inside_its_parents() {
    // "No social media this month" cannot contain a day outside itself.
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let july_month = window(&pool, ScopeKind::Month, july(15)).await;
    let inside = window(&pool, ScopeKind::Day, july(15)).await;
    let outside = window(
        &pool,
        ScopeKind::Day,
        NaiveDate::from_ymd_opt(2026, 8, 20).unwrap(),
    )
    .await;

    let month = create(
        &pool,
        CreateCommitmentRequest {
            title: "No social media this month".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(july_month),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let fits = create(
        &pool,
        CreateCommitmentRequest {
            title: "No social media today".into(),
            parent_type: "commitment".into(),
            parent_id: month.id,
            time_scope: Some(inside),
            ..Default::default()
        },
    )
    .await;
    assert!(fits.is_ok(), "a day inside July belongs in July: {fits:?}");

    let escapes = create(
        &pool,
        CreateCommitmentRequest {
            title: "No social media in August".into(),
            parent_type: "commitment".into(),
            parent_id: month.id,
            time_scope: Some(outside),
            ..Default::default()
        },
    )
    .await;
    assert!(
        matches!(escapes, Err(TaskError::ScopeContainment(_))),
        "got {escapes:?}"
    );
}

#[tokio::test]
async fn a_commitment_holds_task_children_that_inherit_its_window() {
    // The supporting steps under a rule — "phone on charger", "set alarm" — and the inheritance
    // that makes them part of the same night without repeating the window.
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let tonight = window(&pool, ScopeKind::Day, july(1)).await;

    let commitment = create(
        &pool,
        CreateCommitmentRequest {
            title: "Asleep by 23:00".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(tonight),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let created = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Phone on charger".into(),
                parent_type: "commitment".into(),
                parent_id: commitment.id,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        db.commit().await.unwrap();
        created
    };

    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let lifecycles = derive_all_scope_lifecycles(&mut db, at("2026-07-01T09:00:00"))
        .await
        .unwrap();
    let task_state = lifecycles
        .iter()
        .find(|entry| entry.node_type == "task" && entry.node_id == task.id)
        .expect("the task has a derived lifecycle");
    assert_eq!(
        task_state.timing,
        Timing::Active,
        "it inherited tonight's window"
    );
}

// ---------------------------------------------------------------------------
// Verdicts and the Verdict Window, end to end
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_recorded_verdict_survives_a_round_trip_and_can_be_taken_back() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let tonight = window(&pool, ScopeKind::Day, july(1)).await;

    let commitment = create(
        &pool,
        CreateCommitmentRequest {
            title: "Asleep by 23:00".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(tonight),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    for verdict in [Verdict::Kept, Verdict::Broken, Verdict::Unresolved] {
        let written = update(
            &pool,
            commitment.id,
            UpdateCommitmentRequest {
                verdict: Some(verdict),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(written.verdict, verdict);
    }
}

#[tokio::test]
async fn an_unjudged_commitment_archives_only_once_its_verdict_window_has_run_out() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let tonight = window(&pool, ScopeKind::Day, july(1)).await;

    create(
        &pool,
        CreateCommitmentRequest {
            title: "Asleep by 23:00".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(tonight),
            verdict_window: Some(DurationSpec {
                n: 2,
                kind: "day".into(),
            }),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let state_at = |now: &'static str| {
        let pool = pool.clone();
        async move {
            let mut db = helpers::session_factory(&pool).connect().await.unwrap();
            let lifecycles = derive_all_scope_lifecycles(&mut db, at(now)).await.unwrap();
            lifecycles
                .into_iter()
                .find(|entry| entry.node_type == "commitment")
                .expect("the commitment has a derived lifecycle")
        }
    };

    // Next morning: the window has shut but the verdict is still answerable.
    let morning_after = state_at("2026-07-02T09:00:00").await;
    assert_eq!(morning_after.timing, Timing::Lapsed);
    assert_eq!(morning_after.archival, Archival::Live);
    assert_eq!(morning_after.verdict, Some(Verdict::Unresolved));

    // Two days on: answerable no longer, and still unresolved — not having judged it is part of
    // the record, so only Archival moved.
    let too_late = state_at("2026-07-05T09:00:00").await;
    assert_eq!(too_late.archival, Archival::Archived);
    assert_eq!(too_late.verdict, Some(Verdict::Unresolved));
    assert_eq!(
        too_late.resolution, None,
        "a Commitment answers with a verdict, not a resolution"
    );
}

#[tokio::test]
async fn a_child_commitment_inherits_the_verdict_window_of_the_nearest_ancestor_that_sets_one() {
    // Set the policy once for a subtree: the child has no window of its own and expires on the
    // parent's terms.
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let july_month = window(&pool, ScopeKind::Month, july(15)).await;
    let a_day = window(&pool, ScopeKind::Day, july(15)).await;

    let parent = create(
        &pool,
        CreateCommitmentRequest {
            title: "No social media this month".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(july_month),
            verdict_window: Some(DurationSpec {
                n: 1,
                kind: "day".into(),
            }),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let child = create(
        &pool,
        CreateCommitmentRequest {
            title: "No social media today".into(),
            parent_type: "commitment".into(),
            parent_id: parent.id,
            time_scope: Some(a_day),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(child.verdict_window, None, "it sets none of its own");

    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    // 17 July: one day past the child's 15 July window plus its inherited one-day grace.
    let lifecycles = derive_all_scope_lifecycles(&mut db, at("2026-07-17T09:00:00"))
        .await
        .unwrap();
    let child_state = lifecycles
        .iter()
        .find(|entry| entry.node_type == "commitment" && entry.node_id == child.id)
        .expect("the child has a derived lifecycle");
    let parent_state = lifecycles
        .iter()
        .find(|entry| entry.node_type == "commitment" && entry.node_id == parent.id)
        .expect("the parent has a derived lifecycle");

    assert_eq!(
        child_state.archival,
        Archival::Archived,
        "the inherited grace has run out"
    );
    assert_eq!(
        parent_state.archival,
        Archival::Live,
        "July has not finished yet"
    );
}

#[tokio::test]
async fn finishing_every_child_task_does_not_mark_a_commitment_kept() {
    // Credit is for the outcome, not for the sub-steps. Nothing derives a verdict from children,
    // in either direction.
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let tonight = window(&pool, ScopeKind::Day, july(1)).await;

    let commitment = create(
        &pool,
        CreateCommitmentRequest {
            title: "Asleep by 23:00".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(tonight),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        create_task(
            &mut db,
            CreateTaskRequest {
                title: "Phone on charger".into(),
                parent_type: "commitment".into(),
                parent_id: commitment.id,
                status: Some(arlesh_lib::tasks::model::TaskStatus::Done),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        db.commit().await.unwrap();
    }

    let reread = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .commitments()
        .get(CommitmentId(commitment.id))
        .await
        .unwrap();
    assert_eq!(reread.verdict, Verdict::Unresolved);
}

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

#[tokio::test]
async fn deleting_a_commitment_takes_its_whole_subtree_with_it() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let july_month = window(&pool, ScopeKind::Month, july(15)).await;

    let parent = create(
        &pool,
        CreateCommitmentRequest {
            title: "No social media this month".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(july_month),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    create(
        &pool,
        CreateCommitmentRequest {
            title: "No social media today".into(),
            parent_type: "commitment".into(),
            parent_id: parent.id,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        create_task(
            &mut db,
            CreateTaskRequest {
                title: "Log out everywhere".into(),
                parent_type: "commitment".into(),
                parent_id: parent.id,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        db.commit().await.unwrap();
    }

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        delete_commitment(&mut db, CommitmentId(parent.id))
            .await
            .unwrap();
        db.commit().await.unwrap();
    }

    let commitments: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM commitments")
        .fetch_one(&pool)
        .await
        .unwrap();
    let tasks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tasks")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(commitments, 0, "the child commitment went with its parent");
    assert_eq!(tasks, 0, "so did the supporting task");
}

// ---------------------------------------------------------------------------
// Tags and the issue link
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_commitment_carries_tags_and_an_issue_link() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let tonight = window(&pool, ScopeKind::Day, july(1)).await;
    let aspect_id: i64 =
        sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let tag_id = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .domains()
        .create(CreateDomainRequest {
            title: "sleep".into(),
            description: None,
            subtype: DomainSubtype::Tag,
            parent_id: Some(aspect_id),
            status: None,
            knowledge_base_directory: None,
        })
        .await
        .unwrap()
        .id;

    let commitment = create(
        &pool,
        CreateCommitmentRequest {
            title: "Asleep by 23:00".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(tonight),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let id = CommitmentId(commitment.id);
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    db.commitments().add_tag(id, tag_id).await.unwrap();
    db.commitments()
        .set_beads_id(id, Some("Arlesh-cyo".into()))
        .await
        .unwrap();
    let reread = db.commitments().get(id).await.unwrap();
    assert_eq!(reread.tag_ids, vec![tag_id]);
    assert_eq!(reread.beads_id, Some("Arlesh-cyo".to_string()));

    db.commitments().remove_tag(id, tag_id).await.unwrap();
    assert!(db.commitments().get(id).await.unwrap().tag_ids.is_empty());
}

#[tokio::test]
async fn linking_an_issue_to_a_commitment_that_does_not_exist_is_an_error_not_a_no_op() {
    let pool = helpers::test_pool().await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let refused = db
        .commitments()
        .set_beads_id(CommitmentId(4242), Some("Arlesh-cyo".into()))
        .await;
    assert!(
        matches!(refused, Err(TaskError::CommitmentNotFound(4242))),
        "got {refused:?}"
    );
}

#[tokio::test]
async fn reading_a_commitment_that_does_not_exist_names_the_id() {
    let pool = helpers::test_pool().await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let missing = db.commitments().get(CommitmentId(77)).await;
    assert!(
        matches!(missing, Err(TaskError::CommitmentNotFound(77))),
        "got {missing:?}"
    );
}

// ---------------------------------------------------------------------------
// Privacy, reparenting and listing
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_commitment_can_be_marked_private_and_reparented_under_another_commitment() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let july_month = window(&pool, ScopeKind::Month, july(15)).await;
    let a_day = window(&pool, ScopeKind::Day, july(15)).await;

    let month = create(
        &pool,
        CreateCommitmentRequest {
            title: "No social media this month".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(july_month),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let day = create(
        &pool,
        CreateCommitmentRequest {
            title: "No social media today".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(a_day),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let moved = update(
        &pool,
        day.id,
        UpdateCommitmentRequest {
            parent_type: Some("commitment".into()),
            parent_id: Some(month.id),
            position: Some(5),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(moved.parent_type, "commitment");
    assert_eq!(moved.parent_id, month.id);
    assert_eq!(moved.position, 5);

    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    db.commitments()
        .set_private(CommitmentId(day.id), true)
        .await
        .unwrap();
    assert!(
        db.commitments()
            .get(CommitmentId(day.id))
            .await
            .unwrap()
            .is_private
    );

    let listed = db.commitments().list().await.unwrap();
    assert_eq!(
        listed.len(),
        2,
        "both commitments are listed, in position order"
    );
    let children = db
        .commitments()
        .child_ids("commitment", month.id)
        .await
        .unwrap();
    assert_eq!(children, vec![day.id]);
}

#[tokio::test]
async fn a_commitment_under_a_scoped_task_inherits_that_window_and_no_verdict_window() {
    // A Commitment lives anywhere a Task can — including under one. A Task has no Verdict Window
    // column, so the search for one stops there rather than climbing past it.
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let tonight = window(&pool, ScopeKind::Day, july(1)).await;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let task = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Evening routine".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(tonight),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        db.commit().await.unwrap();
        task
    };

    let commitment = create(
        &pool,
        CreateCommitmentRequest {
            title: "Asleep by 23:00".into(),
            parent_type: "task".into(),
            parent_id: task.id,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let lifecycles = derive_all_scope_lifecycles(&mut db, at("2026-07-09T00:00:00"))
        .await
        .unwrap();
    let state = lifecycles
        .iter()
        .find(|entry| entry.node_type == "commitment" && entry.node_id == commitment.id)
        .expect("the commitment has a derived lifecycle");
    assert_eq!(
        state.timing,
        Timing::Lapsed,
        "it inherited the task's window"
    );
    assert_eq!(
        state.archival,
        Archival::Live,
        "nothing above it sets a Verdict Window, so it stays answerable indefinitely",
    );
}

// ---------------------------------------------------------------------------
// Clearing over the wire (Arlesh-atb)
// ---------------------------------------------------------------------------
//
// `Option<Option<T>>` spells *absent = leave unchanged, null = clear*, but serde collapses both
// spellings to `None` on its own, and `merge` reads that as "unchanged". The Commitment editor
// sends the whole form on every save, so emptying the Time Scope or the Verdict Window puts a JSON
// `null` on the wire — and the save reports success while the old value stays in the row. The
// request is built here the way the IPC boundary builds it, from the editor's own payload, because
// that is the hop that drops the clear: constructing `Some(None)` in Rust skips the very step
// under test.

#[tokio::test]
async fn the_editors_clear_payload_empties_a_commitments_own_window() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let july_month = window(&pool, ScopeKind::Month, july(15)).await;
    let a_day = window(&pool, ScopeKind::Day, july(15)).await;

    // A scoped parent, so clearing the child's own window is allowed rather than refused.
    let month = create(
        &pool,
        CreateCommitmentRequest {
            title: "No social media this month".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(july_month),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let commitment = create(
        &pool,
        CreateCommitmentRequest {
            title: "Asleep by 23:00".into(),
            parent_type: "commitment".into(),
            parent_id: month.id,
            time_scope: Some(a_day),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(
        commitment.time_scope.is_some(),
        "the scope was set and saved"
    );

    // Exactly what `updateCommitment` puts on the wire when the editor's scope field is emptied.
    let payload: UpdateCommitmentRequest = serde_json::from_str(
        r#"{"title":"Asleep by 23:00","verdict":"unresolved","time_scope":null,
            "verdict_window":null,"is_private":false}"#,
    )
    .unwrap();

    let cleared = update(&pool, commitment.id, payload).await.unwrap();
    assert_eq!(
        cleared.time_scope, None,
        "the emptied scope is emptied in the row"
    );

    let stored: Option<String> =
        sqlx::query_scalar("SELECT time_scope_start_id FROM commitments WHERE id = ?")
            .bind(commitment.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored, None, "and stays cleared when read back");
}

#[tokio::test]
async fn the_editors_clear_payload_empties_a_commitments_verdict_window() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let tonight = window(&pool, ScopeKind::Day, july(1)).await;

    let commitment = create(
        &pool,
        CreateCommitmentRequest {
            title: "Asleep by 23:00".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(tonight),
            verdict_window: Some(DurationSpec {
                n: 2,
                kind: "day".into(),
            }),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(
        commitment.verdict_window.is_some(),
        "the Verdict Window was set and saved"
    );

    let payload: UpdateCommitmentRequest = serde_json::from_str(
        r#"{"title":"Asleep by 23:00","verdict":"unresolved","verdict_window":null,
            "is_private":false}"#,
    )
    .unwrap();

    let cleared = update(&pool, commitment.id, payload).await.unwrap();
    assert_eq!(
        cleared.verdict_window, None,
        "the emptied Verdict Window goes back to inheriting"
    );

    let stored: Option<i64> =
        sqlx::query_scalar("SELECT verdict_window_n FROM commitments WHERE id = ?")
            .bind(commitment.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored, None, "and stays cleared when read back");
}

#[test]
fn an_explicit_null_time_scope_in_a_commitment_update_payload_clears_it() {
    let absent: UpdateCommitmentRequest = serde_json::from_str(r#"{"title":"Renamed"}"#).unwrap();
    assert_eq!(
        absent.time_scope, None,
        "an absent key leaves the window alone"
    );
    let nulled: UpdateCommitmentRequest = serde_json::from_str(r#"{"time_scope":null}"#).unwrap();
    assert_eq!(
        nulled.time_scope,
        Some(None),
        "an explicit null clears the window"
    );
    let set: UpdateCommitmentRequest =
        serde_json::from_str(r#"{"time_scope":{"start_id":1,"end_id":2}}"#).unwrap();
    assert_eq!(
        set.time_scope,
        Some(Some(TimeScope {
            start_id: 1,
            end_id: 2,
            duration: None
        }))
    );
}

#[test]
fn an_explicit_null_verdict_window_in_a_commitment_update_payload_clears_it() {
    let absent: UpdateCommitmentRequest = serde_json::from_str(r#"{"title":"Renamed"}"#).unwrap();
    assert_eq!(
        absent.verdict_window, None,
        "an absent key leaves the Verdict Window alone"
    );
    let nulled: UpdateCommitmentRequest =
        serde_json::from_str(r#"{"verdict_window":null}"#).unwrap();
    assert_eq!(
        nulled.verdict_window,
        Some(None),
        "an explicit null clears the Verdict Window"
    );
    let set: UpdateCommitmentRequest =
        serde_json::from_str(r#"{"verdict_window":{"n":3,"kind":"day"}}"#).unwrap();
    assert_eq!(
        set.verdict_window,
        Some(Some(DurationSpec {
            n: 3,
            kind: "day".into()
        }))
    );
}

/// A Commitment holds notes as a Task does: the `infos.parent_type` CHECK accepts `commitment`
/// (migration 0040), and deleting the Commitment takes its notes with it.
#[tokio::test]
async fn an_info_can_hang_under_a_commitment() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let tonight = window(&pool, ScopeKind::Day, july(14)).await;
    let commitment = create(
        &pool,
        CreateCommitmentRequest {
            title: "Asleep by 23:00".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(tonight),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let info = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .infos()
        .create(arlesh_lib::infos::model::CreateInfoRequest {
            body: "Phone stays in the kitchen".into(),
            details: None,
            parent_type: "commitment".into(),
            parent_id: commitment.id,
            position: 0,
        })
        .await
        .unwrap();
    assert_eq!(info.parent_type, "commitment");
    assert_eq!(info.parent_id, commitment.id);

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    delete_commitment(&mut db, CommitmentId(commitment.id))
        .await
        .unwrap();
    db.commit().await.unwrap();

    let remaining: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM infos WHERE id = ?")
        .bind(info.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(remaining, 0);
}
