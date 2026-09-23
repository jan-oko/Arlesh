//! Integration tests for the Undo Journal.
//!
//! The seam under test is the **database**, not the commands: the whole point of writing the
//! journal from triggers is that a command does not know it is being recorded, so a test that
//! stubbed the recording would prove nothing. Every assertion here therefore drives a real command
//! (or a real MCP tool) and then reads `undo_journal`.
//!
//! Two of these tests are the guard ADR 0006 asks for. They enumerate the schema from
//! `sqlite_master` rather than listing tables, so a table added later fails them by existing —
//! which is the one obligation the trigger design does not remove.
//!
//! The pool has **one** connection (see [`helpers::test_pool`]), so every read of the journal
//! happens after the session that wrote it has closed.

mod helpers;

use arlesh_lib::commands::tasks as task_commands;
use arlesh_lib::mcp::{params, ArleshMcp};
use arlesh_lib::undo::{model::WriteSource, EXCLUDED_TABLES};
use arlesh_lib::{
    domains::model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
    tasks::model::{CreateTaskRequest, UpdateTaskRequest},
};
use rmcp::handler::server::wrapper::Parameters;
use tauri::Manager;

/// One row of `undo_journal`, as the tests read it back.
#[derive(sqlx::FromRow, Debug)]
struct Entry {
    gesture_id: Option<String>,
    source: String,
    table_name: String,
    operation: String,
    before_image: Option<String>,
    after_image: Option<String>,
}

/// Every journal entry, oldest first.
async fn journal(pool: &sqlx::SqlitePool) -> Vec<Entry> {
    sqlx::query_as(
        "SELECT gesture_id, source, table_name, operation, before_image, after_image \
           FROM undo_journal ORDER BY seq",
    )
    .fetch_all(pool)
    .await
    .expect("failed to read the undo journal")
}

/// The tables the schema says must be journaled: everything that is neither infrastructure nor on
/// the exclusion list. Read from `sqlite_master`, never listed, so that a new table is caught.
async fn journaled_tables(pool: &sqlx::SqlitePool) -> Vec<String> {
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master \
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_sqlx_migrations' \
          ORDER BY name",
    )
    .fetch_all(pool)
    .await
    .expect("failed to enumerate tables");
    tables
        .into_iter()
        .filter(|table| !EXCLUDED_TABLES.contains(&table.as_str()))
        .collect()
}

/// The `CREATE TRIGGER` text of one journal trigger, or `None` when it does not exist.
async fn trigger_sql(pool: &sqlx::SqlitePool, table: &str, operation: &str) -> Option<String> {
    sqlx::query_scalar("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
        .bind(format!("undo_journal_{table}_{operation}"))
        .fetch_optional(pool)
        .await
        .expect("failed to read sqlite_master")
}

async fn make_project(pool: &sqlx::SqlitePool) -> i64 {
    let aspect_id: i64 =
        sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
            .fetch_one(pool)
            .await
            .expect("the Growth aspect is seeded by the initial migration");
    helpers::session_factory(pool)
        .connect()
        .await
        .expect("connect")
        .domains()
        .create(CreateDomainRequest {
            title: "Journal Project".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(aspect_id),
            status: Some(ProjectStatus::Active),
            knowledge_base_directory: None,
        })
        .await
        .expect("create project")
        .id
}

async fn make_tag(pool: &sqlx::SqlitePool) -> i64 {
    let aspect_id: i64 =
        sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
            .fetch_one(pool)
            .await
            .expect("the Growth aspect is seeded by the initial migration");
    helpers::session_factory(pool)
        .connect()
        .await
        .expect("connect")
        .domains()
        .create(CreateDomainRequest {
            title: "journal-tag".into(),
            description: None,
            subtype: DomainSubtype::Tag,
            parent_id: Some(aspect_id),
            status: None,
            knowledge_base_directory: None,
        })
        .await
        .expect("create tag")
        .id
}

fn task_request(project_id: i64, title: &str) -> CreateTaskRequest {
    CreateTaskRequest {
        title: title.into(),
        parent_type: "project".into(),
        parent_id: project_id,
        status: None,
        time_scope: None,
        on_scope_exit: None,
        plan: None,
        // Master added this field while this branch was open. A plain fixture task is not set
        // aside, and `archival: None` is what the stored invariant wants beside `plan: None`.
        archival: None,
        agentic: None,
        asynchronous: None,
        async_template: None,
    }
}

/// Opens a Gesture and returns its id, as the frontend's `open_gesture` command does.
async fn open_gesture(pool: &sqlx::SqlitePool) -> String {
    helpers::session_factory(pool)
        .connect()
        .await
        .expect("connect")
        .undo()
        .open_gesture()
        .await
        .expect("open gesture")
        .0
}

async fn close_gesture(pool: &sqlx::SqlitePool) {
    helpers::session_factory(pool)
        .connect()
        .await
        .expect("connect")
        .undo()
        .close_gesture()
        .await
        .expect("close gesture");
}

/// Empties the journal so that a test asserts only on the writes it made itself.
async fn clear_journal(pool: &sqlx::SqlitePool) {
    sqlx::query("DELETE FROM undo_journal")
        .execute(pool)
        .await
        .expect("failed to clear the journal");
}

// ---------------------------------------------------------------------------------------------
// The guard: every table has its triggers, and every column is in them.
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn every_journaled_table_has_its_three_triggers() {
    let pool = helpers::test_pool().await;
    let tables = journaled_tables(&pool).await;
    assert!(
        tables.len() > 10,
        "the schema enumeration found only {tables:?}, which cannot be the whole board"
    );

    for table in &tables {
        for operation in ["insert", "update", "delete"] {
            assert!(
                trigger_sql(&pool, table, operation).await.is_some(),
                "table \"{table}\" has no {operation} journal trigger. A table that is not \
                 journaled is silently un-undoable: add its three triggers in a new migration \
                 (scripts/generate-undo-triggers.sh writes them), or add it to \
                 arlesh_lib::undo::EXCLUDED_TABLES with the reason it is derived."
            );
        }
    }

    let journal_triggers: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'undo_journal_%'",
    )
    .fetch_one(&pool)
    .await
    .expect("count triggers");
    assert_eq!(
        journal_triggers,
        i64::try_from(tables.len() * 3).expect("table count fits in i64"),
        "there are journal triggers that belong to no journaled table — a trigger left behind by \
         a dropped or excluded table"
    );

    for excluded in EXCLUDED_TABLES {
        let exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .bind(excluded)
        .fetch_one(&pool)
        .await
        .expect("count tables");
        assert_eq!(
            exists, 1,
            "EXCLUDED_TABLES names \"{excluded}\", which is not in the schema. A stale exclusion \
             is how a real table stops being journaled without anyone noticing."
        );
    }
}

#[tokio::test]
async fn every_column_of_every_journaled_table_appears_in_its_triggers() {
    let pool = helpers::test_pool().await;

    for table in journaled_tables(&pool).await {
        let columns: Vec<(String, String)> = sqlx::query_as(&format!(
            "SELECT name, type FROM pragma_table_info('{table}')"
        ))
        .fetch_all(&pool)
        .await
        .expect("failed to read table_info");
        assert!(!columns.is_empty(), "table \"{table}\" has no columns");

        for (column, declared_type) in &columns {
            // json_object() refuses a BLOB, so a BLOB column would not fail the migration — it
            // would fail the write, at runtime, on the user's board. Catch it here instead.
            assert!(
                !declared_type.is_empty() && !declared_type.to_uppercase().contains("BLOB"),
                "column {table}.{column} is declared \"{declared_type}\", which has BLOB \
                 affinity. json_object() cannot hold a BLOB, so its trigger would fail at write \
                 time: store it as TEXT, or exclude the table."
            );

            for (operation, rows) in [
                ("insert", vec!["new"]),
                ("update", vec!["old", "new"]),
                ("delete", vec!["old"]),
            ] {
                let sql = trigger_sql(&pool, &table, operation)
                    .await
                    .unwrap_or_else(|| panic!("{table} has no {operation} trigger"));
                for row in rows {
                    assert!(
                        sql.contains(&format!("'{column}', {row}.{column}")),
                        "the {operation} trigger on \"{table}\" does not record the \"{column}\" \
                         column. A column added after the triggers were generated is restored as \
                         whatever it was at insert time — silently. Regenerate the triggers into \
                         a new migration."
                    );
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// What a write through a real command produces.
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn creating_a_task_journals_an_insert_carrying_the_row_it_wrote() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    clear_journal(&pool).await;

    let gesture = open_gesture(&pool).await;
    let task = task_commands::create_task(app.state(), task_request(project_id, "journaled"))
        .await
        .expect("create task");
    close_gesture(&pool).await;

    let entries = journal(&pool).await;
    let insert = entries
        .iter()
        .find(|entry| entry.table_name == "tasks")
        .expect("the task insert is not in the journal");
    assert_eq!(insert.operation, "insert");
    assert_eq!(insert.gesture_id.as_deref(), Some(gesture.as_str()));
    assert_eq!(insert.source, WriteSource::User.as_str());
    assert_eq!(insert.before_image, None, "an insert has nothing before it");

    let after: serde_json::Value = serde_json::from_str(
        insert
            .after_image
            .as_deref()
            .expect("an insert must carry an after image"),
    )
    .expect("the after image is JSON");
    assert_eq!(after["id"], serde_json::json!(task.id));
    assert_eq!(after["title"], serde_json::json!("journaled"));
    assert_eq!(after["parent_id"], serde_json::json!(project_id));
    assert_eq!(
        after["delegate_kind"],
        serde_json::json!(null),
        "a NULL column is recorded as null, not omitted — undo has to be able to put it back"
    );
}

#[tokio::test]
async fn updating_a_task_journals_both_the_row_it_was_and_the_row_it_became() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let task = task_commands::create_task(app.state(), task_request(project_id, "before"))
        .await
        .expect("create task");
    clear_journal(&pool).await;

    open_gesture(&pool).await;
    task_commands::update_task(
        app.state(),
        task.id,
        UpdateTaskRequest {
            title: Some("after".into()),
            ..Default::default()
        },
    )
    .await
    .expect("update task");
    close_gesture(&pool).await;

    let entries = journal(&pool).await;
    let update = entries
        .iter()
        .find(|entry| entry.table_name == "tasks" && entry.operation == "update")
        .expect("the task update is not in the journal");

    let before: serde_json::Value =
        serde_json::from_str(update.before_image.as_deref().expect("before image"))
            .expect("the before image is JSON");
    let after: serde_json::Value =
        serde_json::from_str(update.after_image.as_deref().expect("after image"))
            .expect("the after image is JSON");
    assert_eq!(before["title"], serde_json::json!("before"));
    assert_eq!(after["title"], serde_json::json!("after"));
}

#[tokio::test]
async fn deleting_a_task_journals_every_row_the_cascade_removed_under_one_gesture() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let tag_id = make_tag(&pool).await;

    let parent = task_commands::create_task(app.state(), task_request(project_id, "parent"))
        .await
        .expect("create parent");
    let child = task_commands::create_task(
        app.state(),
        CreateTaskRequest {
            parent_type: "task".into(),
            parent_id: parent.id,
            ..task_request(project_id, "child")
        },
    )
    .await
    .expect("create child");
    task_commands::add_tag_to_task(app.state(), child.id, tag_id)
        .await
        .expect("tag the child");
    clear_journal(&pool).await;

    let gesture = open_gesture(&pool).await;
    task_commands::delete_task(app.state(), parent.id)
        .await
        .expect("delete the parent");
    close_gesture(&pool).await;

    let entries = journal(&pool).await;
    assert!(
        entries
            .iter()
            .all(|entry| entry.gesture_id.as_deref() == Some(gesture.as_str())),
        "a cascade must land in the one gesture that caused it, got {entries:?}"
    );
    assert!(
        entries.iter().all(|entry| entry.operation == "delete"),
        "a delete cascade journals only deletes, got {entries:?}"
    );

    let deleted_tasks = entries
        .iter()
        .filter(|entry| entry.table_name == "tasks")
        .count();
    assert_eq!(deleted_tasks, 2, "both the parent and the child are gone");
    assert!(
        entries
            .iter()
            .any(|entry| entry.table_name == "tags_on_tasks"),
        "the tag link was removed by a foreign-key cascade the command never issued, and that is \
         exactly the row an inverse-per-command undo would forget: {entries:?}"
    );
}

// ---------------------------------------------------------------------------------------------
// Sources and suppression.
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn an_mcp_write_is_journaled_as_mcp_and_leaves_the_source_as_it_found_it() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = ArleshMcp::new(helpers::session_factory(&pool));
    let project_id = make_project(&pool).await;
    let task = task_commands::create_task(app.state(), task_request(project_id, "linked"))
        .await
        .expect("create task");
    clear_journal(&pool).await;

    let result = mcp
        .beads(Parameters(params::BeadsOperation::Set {
            node_type: params::BeadsNode::Task,
            node_id: task.id,
            beads_id: Some("Arlesh-npt".into()),
        }))
        .await
        .expect("the beads tool returned no result");
    assert_ne!(
        result.is_error,
        Some(true),
        "{:?}",
        result.structured_content
    );

    let entries = journal(&pool).await;
    assert_eq!(entries.len(), 1, "one UPDATE, one entry: {entries:?}");
    let entry = &entries[0];
    assert_eq!(entry.source, WriteSource::Mcp.as_str());
    assert_eq!(
        entry.gesture_id, None,
        "an agent's write belongs to no gesture of the user's"
    );

    // The tag must not outlive the write, or the next thing the user does is attributed to the
    // agent and Ctrl+Z quietly stops offering it.
    let context = helpers::session_factory(&pool)
        .connect()
        .await
        .expect("connect")
        .undo()
        .context()
        .await
        .expect("read context");
    assert_eq!(context.source, WriteSource::User);
}

#[tokio::test]
async fn a_write_under_suppression_is_not_journaled_at_all() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    clear_journal(&pool).await;

    let factory = helpers::session_factory(&pool);
    {
        let mut db = factory.begin().await.expect("begin");
        let resumed = db.undo().set_suppressed(true).await.expect("suppress");
        assert!(!resumed, "journalling is on until something turns it off");
        arlesh_lib::tasks::create_task(&mut db, task_request(project_id, "invisible"))
            .await
            .expect("create task");
        db.undo().set_suppressed(resumed).await.expect("resume");
        db.commit().await.expect("commit");
    }

    assert!(
        journal(&pool).await.is_empty(),
        "undo must not journal itself: a write under suppression leaves no trace"
    );

    // And journalling really did come back on, rather than the test passing because it stayed off.
    open_gesture(&pool).await;
    task_commands::create_task(app.state(), task_request(project_id, "visible"))
        .await
        .expect("create task");
    close_gesture(&pool).await;
    assert!(!journal(&pool).await.is_empty());
}

// ---------------------------------------------------------------------------------------------
// The gesture protocol.
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn a_nested_open_joins_the_gesture_already_running_and_only_the_outermost_close_ends_it() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    clear_journal(&pool).await;

    let outer = open_gesture(&pool).await;
    let inner = open_gesture(&pool).await;
    assert_eq!(
        inner, outer,
        "the caller that opened first owns the boundary; a nested open joins it"
    );

    task_commands::create_task(app.state(), task_request(project_id, "first"))
        .await
        .expect("create first");
    close_gesture(&pool).await;
    task_commands::create_task(app.state(), task_request(project_id, "second"))
        .await
        .expect("create second");
    close_gesture(&pool).await;

    let entries = journal(&pool).await;
    assert!(
        entries
            .iter()
            .all(|entry| entry.gesture_id.as_deref() == Some(outer.as_str())),
        "the inner close must not end the gesture the outer one opened: {entries:?}"
    );

    let after = open_gesture(&pool).await;
    assert_ne!(after, outer, "a closed gesture is never reopened");
}

#[tokio::test]
async fn a_write_with_no_gesture_open_is_journaled_ungrouped() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    clear_journal(&pool).await;

    task_commands::create_task(app.state(), task_request(project_id, "ungrouped"))
        .await
        .expect("create task");

    let entries = journal(&pool).await;
    assert!(
        !entries.is_empty(),
        "the write itself must still be recorded"
    );
    assert!(
        entries.iter().all(|entry| entry.gesture_id.is_none()),
        "forgetting to open a gesture must not lose the entry — the journal stays a faithful \
         history and it is the stack that declines to offer an ungrouped change: {entries:?}"
    );
}

#[tokio::test]
async fn closing_a_gesture_nobody_opened_is_refused() {
    let pool = helpers::test_pool().await;
    let error = helpers::session_factory(&pool)
        .connect()
        .await
        .expect("connect")
        .undo()
        .close_gesture()
        .await
        .expect_err("an unmatched close must not pass silently");
    assert!(
        matches!(error, arlesh_lib::undo::error::UndoError::NoGestureOpen),
        "got {error}"
    );
}

// ---------------------------------------------------------------------------------------------
// Lifecycle: startup, depth, and the context row itself.
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn a_new_session_starts_with_an_empty_journal_and_a_clear_context() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;

    // A session that ended badly: a gesture left open, journalling left suppressed.
    let factory = helpers::session_factory(&pool);
    {
        let mut db = factory.connect().await.expect("connect");
        db.undo().open_gesture().await.expect("open");
        db.undo().set_suppressed(true).await.expect("suppress");
    }
    task_commands::create_task(app.state(), task_request(project_id, "last run"))
        .await
        .expect("create task");

    arlesh_lib::undo::reset_journal(&factory)
        .await
        .expect("reset");

    assert!(
        journal(&pool).await.is_empty(),
        "the stack is session-scoped"
    );
    let context = factory
        .connect()
        .await
        .expect("connect")
        .undo()
        .context()
        .await
        .expect("read context");
    assert_eq!(context.gesture, None);
    assert_eq!(context.depth, 0);
    assert_eq!(context.source, WriteSource::User);
    assert!(
        !context.suppressed,
        "a suppression left behind by a crash mid-undo would stop the triggers recording for the \
         whole of this session"
    );
}

#[tokio::test]
async fn a_reset_re_seeds_the_context_row_when_it_has_gone_missing() {
    let pool = helpers::test_pool().await;
    sqlx::query("DELETE FROM undo_context")
        .execute(&pool)
        .await
        .expect("remove the context row");

    arlesh_lib::undo::reset_journal(&helpers::session_factory(&pool))
        .await
        .expect("reset");

    let context = helpers::session_factory(&pool)
        .connect()
        .await
        .expect("connect")
        .undo()
        .context()
        .await
        .expect("the context row is back");
    assert_eq!(context.source, WriteSource::User);
}

#[tokio::test]
async fn a_source_the_enum_does_not_name_is_reported_rather_than_guessed() {
    let pool = helpers::test_pool().await;
    sqlx::query("UPDATE undo_context SET source = 'scheduler' WHERE id = 1")
        .execute(&pool)
        .await
        .expect("write an unknown source");

    let error = helpers::session_factory(&pool)
        .connect()
        .await
        .expect("connect")
        .undo()
        .context()
        .await
        .expect_err("an unreadable source must not be treated as the user's");
    assert!(
        matches!(
            &error,
            arlesh_lib::undo::error::UndoError::UnknownWriteSource(seen) if seen == "scheduler"
        ),
        "got {error}"
    );
}

#[tokio::test]
async fn pruning_keeps_the_newest_gestures_and_drops_the_rest_whole() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    clear_journal(&pool).await;

    let mut gestures = Vec::new();
    for title in ["one", "two", "three"] {
        gestures.push(open_gesture(&pool).await);
        task_commands::create_task(app.state(), task_request(project_id, title))
            .await
            .expect("create task");
        close_gesture(&pool).await;
    }

    let before = journal(&pool).await.len();
    let removed = helpers::session_factory(&pool)
        .connect()
        .await
        .expect("connect")
        .undo()
        .prune(1)
        .await
        .expect("prune");

    let newest = gestures.last().expect("three gestures were opened");
    let surviving = journal(&pool).await.len();
    assert_eq!(
        usize::try_from(removed).expect("a row count fits in usize"),
        before - surviving,
        "prune reports what it removed"
    );
    let entries = journal(&pool).await;
    assert!(
        !entries.is_empty()
            && entries
                .iter()
                .all(|entry| entry.gesture_id.as_deref() == Some(newest.as_str())),
        "only the newest gesture survives a prune to one: {entries:?}"
    );
}

#[tokio::test]
async fn pruning_counts_an_ungrouped_entry_as_a_gesture_of_its_own() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    clear_journal(&pool).await;

    for title in ["one", "two", "three"] {
        task_commands::create_task(app.state(), task_request(project_id, title))
            .await
            .expect("create task");
    }
    assert!(journal(&pool).await.len() > 2);

    helpers::session_factory(&pool)
        .connect()
        .await
        .expect("connect")
        .undo()
        .prune(2)
        .await
        .expect("prune");

    assert_eq!(
        journal(&pool).await.len(),
        2,
        "ungrouped writes must age out one at a time rather than surviving as one unbounded bucket"
    );
}
