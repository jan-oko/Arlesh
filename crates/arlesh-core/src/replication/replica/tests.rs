use super::*;
use crate::{
    database::session::SessionFactory,
    domains::model::{CreateDomainRequest, DomainSubtype},
    nodes::id::{NodeId, RowId},
    replication::{board_hash, rules::hash, snapshot, StoredRow},
    tasks::{
        answer_drafts::model::{DraftRequest, SendRequest},
        model::{
            CreateExpectationRequest, CreateTaskRequest, TaskAgentic, TaskId, UpdateTaskRequest,
        },
    },
};

fn task(title: &str, parent_type: &str, parent: NodeId) -> CreateTaskRequest {
    CreateTaskRequest {
        title: title.into(),
        parent_type: parent_type.into(),
        parent_id: parent,
        ..Default::default()
    }
}

fn task_id(id: &NodeId) -> TaskId {
    TaskId(id.require_stored().unwrap())
}

async fn rows(factory: &SessionFactory) -> Vec<StoredRow> {
    let mut db = factory.begin_read().await.unwrap();
    snapshot(&mut db).await.unwrap().rows
}

async fn board(factory: &SessionFactory) -> String {
    let mut db = factory.begin_read().await.unwrap();
    board_hash(&mut db).await.unwrap()
}

async fn aspect(factory: &SessionFactory) -> RowId {
    let mut db = factory.connect().await.unwrap();
    db.domains()
        .list(Some(DomainSubtype::Aspect))
        .await
        .unwrap()[0]
        .id
}

/// Copies the rows `from` holds into `to`, as a snapshot install does.
async fn mirror(from: &SessionFactory, to: &SessionFactory) {
    let mut db = from.begin_read().await.unwrap();
    let snapshot = snapshot(&mut db).await.unwrap();
    install_snapshot(to, &snapshot).await.unwrap();
}

/// A confirmed board with a project and a small tree of Tasks, on both a server stand-in and a
/// Replica installed from it. Returns the ids the predictions work on.
struct Confirmed {
    replica: SessionFactory,
    project: NodeId,
    first: NodeId,
    second: NodeId,
    child: NodeId,
}

async fn confirmed() -> Confirmed {
    let server = open_memory().await.unwrap();
    let aspect = aspect(&server).await;
    let mut db = server.begin().await.unwrap();
    let project: NodeId = db
        .domains()
        .create(CreateDomainRequest {
            id: None,
            title: "Sync".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(aspect),
            status: None,
            knowledge_base_directory: None,
        })
        .await
        .unwrap()
        .id
        .into();
    let first = crate::tasks::create_task(&mut db, task("First", "project", project.clone()))
        .await
        .unwrap()
        .id;
    let second = crate::tasks::create_task(&mut db, task("Second", "project", project.clone()))
        .await
        .unwrap()
        .id;
    let child = crate::tasks::create_task(&mut db, task("Child", "task", first.clone()))
        .await
        .unwrap()
        .id;
    crate::tasks::create_task(&mut db, task("Grandchild", "task", child.clone()))
        .await
        .unwrap();
    db.commit().await.unwrap();
    let replica = open_memory().await.unwrap();
    mirror(&server, &replica).await;
    Confirmed {
        replica,
        project,
        first,
        second,
        child,
    }
}

#[tokio::test]
async fn a_rolled_back_prediction_leaves_the_confirmed_hash() {
    let board_before = confirmed().await;
    let replica = &board_before.replica;
    let confirmed_hash = board(replica).await;
    let mark = journal_mark(replica).await.unwrap();

    // A create, a re-parent, a cascade delete, and an answer draft sent: each a prediction.
    let mut db = replica.begin().await.unwrap();
    let made = crate::tasks::create_task(
        &mut db,
        task("Predicted", "project", board_before.project.clone()),
    )
    .await
    .unwrap()
    .id;
    crate::tasks::update_task(
        &mut db,
        task_id(&board_before.child),
        UpdateTaskRequest {
            parent_type: Some("task".into()),
            parent_id: Some(board_before.second.clone()),
            position: Some(0),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    crate::tasks::delete_task(&mut db, task_id(&board_before.second))
        .await
        .unwrap();
    let agentic = crate::tasks::create_task(
        &mut db,
        CreateTaskRequest {
            agentic: Some(TaskAgentic::Yes),
            ..task("Agent work", "project", board_before.project.clone())
        },
    )
    .await
    .unwrap()
    .id;
    let wait = crate::tasks::create_expectation(
        &mut db,
        CreateExpectationRequest {
            title: "Which one?".into(),
            parent_type: "task".into(),
            parent_id: agentic,
            agentic: true,
            agentic_note: Some("Pick".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .id;
    crate::tasks::answer_drafts::save_draft(
        &mut db,
        &wait,
        DraftRequest {
            answer: Some("The second".into()),
            verdict: None,
        },
        crate::clock::now(),
    )
    .await
    .unwrap();
    crate::tasks::answer_drafts::send_drafts(
        &mut db,
        SendRequest {
            shown: vec![wait.clone()],
        },
        crate::clock::now(),
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
    assert_ne!(board(replica).await, confirmed_hash, "the prediction shows");
    assert_ne!(made, board_before.first);

    settle(replica, mark, &[]).await.unwrap();

    assert_eq!(board(replica).await, confirmed_hash);
    assert_eq!(journal_mark(replica).await.unwrap(), 0);
}

#[tokio::test]
async fn settling_then_applying_the_servers_rows_gives_the_servers_board() {
    let held = confirmed().await;
    let replica = &held.replica;
    let mark = journal_mark(replica).await.unwrap();
    let mut db = replica.begin().await.unwrap();
    crate::tasks::delete_task(&mut db, task_id(&held.first))
        .await
        .unwrap();
    db.commit().await.unwrap();
    let predicted = rows(replica).await;
    let server_rows: Vec<RowChange> = predicted
        .iter()
        .filter(|row| row.table == "tasks")
        .take(1)
        .map(|row| RowChange {
            seq: 1,
            table: row.table.clone(),
            rowid: row.rowid,
            image: None,
        })
        .collect();

    settle(replica, mark, &server_rows).await.unwrap();

    let after = rows(replica).await;
    assert!(
        after
            .iter()
            .filter(|row| row.table == "tasks")
            .all(|row| Some(row.rowid) != server_rows.first().map(|change| change.rowid)),
        "the row the server deleted is gone, whatever the prediction did"
    );
}

#[tokio::test]
async fn cancelling_the_last_action_reverts_only_its_range() {
    let held = confirmed().await;
    let replica = &held.replica;
    let first_mark = journal_mark(replica).await.unwrap();
    let mut db = replica.begin().await.unwrap();
    crate::tasks::create_task(&mut db, task("Kept", "project", held.project.clone()))
        .await
        .unwrap();
    db.commit().await.unwrap();
    let kept_mark = journal_mark(replica).await.unwrap();
    let after_first = board(replica).await;
    let mut db = replica.begin().await.unwrap();
    crate::tasks::create_task(&mut db, task("Cancelled", "project", held.project.clone()))
        .await
        .unwrap();
    db.commit().await.unwrap();
    let through = journal_mark(replica).await.unwrap();
    assert!(kept_mark > first_mark && through > kept_mark);

    let undone = cancel(
        replica,
        JournalRange {
            after: kept_mark,
            through,
        },
    )
    .await
    .unwrap();

    assert!(!undone.is_empty());
    assert_eq!(board(replica).await, after_first);
    assert_eq!(journal_mark(replica).await.unwrap(), kept_mark);
}

#[tokio::test]
async fn the_ids_a_prediction_inserted_are_listed() {
    let held = confirmed().await;
    let replica = &held.replica;
    let after = journal_mark(replica).await.unwrap();
    let mut db = replica.begin().await.unwrap();
    let made = crate::tasks::create_task(&mut db, task("New", "project", held.project.clone()))
        .await
        .unwrap()
        .id;
    db.commit().await.unwrap();
    let through = journal_mark(replica).await.unwrap();

    let ids = inserted_ids(replica, JournalRange { after, through })
        .await
        .unwrap();

    assert!(ids.contains(&task_id(&made).0.to_string()), "{ids:?}");
}

#[tokio::test]
async fn applying_rows_never_cascades() {
    let held = confirmed().await;
    let replica = &held.replica;
    let before = rows(replica).await;
    let parent = before
        .iter()
        .find(|row| row.table == "tasks" && row.image.contains("\"First\""))
        .unwrap()
        .clone();

    // Replacing a parent row, as a server event would, must leave its children alone.
    apply_rows(
        replica,
        &[RowChange {
            seq: 1,
            table: parent.table.clone(),
            rowid: parent.rowid,
            image: Some(parent.image.clone()),
        }],
    )
    .await
    .unwrap();

    assert_eq!(rows(replica).await, before);
}

#[tokio::test]
async fn the_journal_is_never_pruned_and_is_truncated_on_settle() {
    let held = confirmed().await;
    let replica = &held.replica;
    let mark = journal_mark(replica).await.unwrap();
    for number in 0..120 {
        let mut db = replica.begin().await.unwrap();
        db.undo().open_gesture().await.unwrap();
        crate::tasks::create_task(
            &mut db,
            task(&format!("Task {number}"), "project", held.project.clone()),
        )
        .await
        .unwrap();
        db.commit().await.unwrap();
    }
    let mut db = replica.connect().await.unwrap();
    let held_entries = db.undo().entries_between(mark, i64::MAX).await.unwrap();
    drop(db);
    assert!(held_entries.len() >= 120, "{}", held_entries.len());

    settle(replica, mark, &[]).await.unwrap();

    let mut db = replica.connect().await.unwrap();
    assert!(db
        .undo()
        .entries_between(0, i64::MAX)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn an_in_memory_replica_survives_idle() {
    let replica = open_memory().await.unwrap();
    let before = rows(&replica).await;

    tokio::time::sleep(Duration::from_millis(300)).await;

    assert_eq!(rows(&replica).await, before, "the board is still there");
}

#[tokio::test]
async fn install_replaces_the_seed_rows() {
    let replica = open_memory().await.unwrap();
    let seeded = rows(&replica).await;
    assert!(!seeded.is_empty(), "the baseline seeds rows");
    let snapshot = Snapshot {
        upto: 5,
        hash: hash::board_hash(&[]),
        schema_version: 0,
        rows: Vec::new(),
    };

    install_snapshot(&replica, &snapshot).await.unwrap();

    assert!(rows(&replica).await.is_empty());
}

#[tokio::test]
async fn a_row_naming_an_unsafe_table_or_column_is_refused() {
    let replica = open_memory().await.unwrap();
    let bad_table = RowChange {
        seq: 1,
        table: "tasks\"; DROP TABLE tasks; --".into(),
        rowid: 1,
        image: Some("{}".into()),
    };
    let bad_column = RowChange {
        seq: 2,
        table: "tasks".into(),
        rowid: 1,
        image: Some(r#"{"x\" = 1; --":1}"#.into()),
    };
    let not_replicated = RowChange {
        seq: 3,
        table: "server_tokens".into(),
        rowid: 1,
        image: Some("{}".into()),
    };

    for change in [bad_table, bad_column, not_replicated] {
        assert!(matches!(
            apply_rows(&replica, &[change]).await,
            Err(ReplicaError::MalformedRow { .. })
        ));
    }
}

#[tokio::test]
async fn a_write_that_fails_leaves_foreign_keys_enforced_and_no_transaction_open() {
    let replica = open_memory().await.unwrap();
    let bad = RowChange {
        seq: 1,
        table: "tasks".into(),
        rowid: 1,
        image: Some("not json".into()),
    };

    assert!(apply_rows(&replica, &[bad]).await.is_err());

    // Constraints are on again: a link to a task that does not exist is refused...
    assert!(execute_for_tests(
        &replica,
        "INSERT INTO tags_on_tasks (task_id, tag_id) VALUES ('nobody', 'nothing')"
    )
    .await
    .is_err());
    // ...and the connection is free of a half-open transaction: the next write works.
    apply_rows(&replica, &[]).await.unwrap();
    journal_mark(&replica).await.unwrap();
}
