use super::*;
use crate::database::hold::AppHold;
use crate::domains::model::{CreateDomainRequest, DomainSubtype};
use crate::undo::{close_gesture, stacks::UndoStacks};
use std::sync::atomic::{AtomicU32, Ordering};

/// Distinguishes the scratch directories of tests running concurrently in one process.
static NEXT_DIRECTORY: AtomicU32 = AtomicU32::new(0);

/// A database path in a fresh directory of its own. The file does not exist yet.
fn scratch_path() -> PathBuf {
    let directory = std::env::temp_dir().join(format!(
        "arlesh-open-test-{}-{}",
        std::process::id(),
        NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();
    directory.join("arlesh.db")
}

fn writer(name: &str) -> OpenMode {
    OpenMode::Write {
        client: name.parse().unwrap(),
        force: false,
    }
}

/// A migrated database at a fresh path, closed again.
async fn migrated_database() -> PathBuf {
    let path = scratch_path();
    let factory = open(&path, writer("setup")).await.unwrap();
    factory.close().await;
    path
}

/// Runs `sql` against the file at `path` outside every rule here, to stage a state.
async fn tamper(path: &Path, sql: &str) {
    let pool = connect_with(SqliteConnectOptions::new().filename(path), false)
        .await
        .unwrap();
    sqlx::query(sql).execute(&pool).await.unwrap();
    pool.close().await;
}

fn new_domain(title: &str) -> CreateDomainRequest {
    CreateDomainRequest {
        title: title.to_string(),
        description: None,
        subtype: DomainSubtype::Domain,
        parent_id: Some(1),
        status: None,
        knowledge_base_directory: None,
    }
}

#[tokio::test]
async fn a_write_open_creates_and_migrates_a_fresh_database() {
    let path = scratch_path();
    let factory = open(&path, writer("notebook")).await.unwrap();
    assert_eq!(factory.client().as_str(), "notebook");
    assert!(!factory.is_read_only());
    let pool = factory.pool_for_tests();
    let applied = applied_migrations(pool).await.unwrap();
    assert_eq!(applied.len(), MIGRATOR.iter().count());
}

#[tokio::test]
async fn a_read_only_open_of_a_current_database_reads() {
    let path = migrated_database().await;
    let factory = open(&path, OpenMode::ReadOnly).await.unwrap();
    assert!(factory.is_read_only());
    let mut db = factory.begin().await.unwrap();
    let domains = db.domains().list(None).await.unwrap();
    assert!(!domains.is_empty(), "the seeded Aspects are there");
}

#[tokio::test]
async fn a_read_only_open_cannot_write() {
    let path = migrated_database().await;
    let factory = open(&path, OpenMode::ReadOnly).await.unwrap();
    let mut db = factory.begin().await.unwrap();
    assert!(db.domains().create(new_domain("nope")).await.is_err());
}

#[tokio::test]
async fn a_read_only_open_of_a_missing_file_is_refused() {
    let path = scratch_path();
    assert!(matches!(
        open(&path, OpenMode::ReadOnly).await,
        Err(OpenError::Missing(missing)) if missing == path
    ));
    assert!(!path.exists(), "a reader never creates the file");
}

#[tokio::test]
async fn a_read_only_open_refuses_a_schema_that_is_behind() {
    let path = migrated_database().await;
    let last = MIGRATOR.iter().map(|m| m.version).max().unwrap();
    tamper(
        &path,
        &format!("DELETE FROM _sqlx_migrations WHERE version = {last}"),
    )
    .await;
    assert!(matches!(
        open(&path, OpenMode::ReadOnly).await,
        Err(OpenError::SchemaBehind { pending }) if pending == vec![last]
    ));
}

#[tokio::test]
async fn a_schema_newer_than_the_build_is_refused_for_reading_and_writing() {
    let path = migrated_database().await;
    tamper(
        &path,
        "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) \
         VALUES (999999, 'from the future', 1, x'00', 0)",
    )
    .await;
    assert!(matches!(
        open(&path, OpenMode::ReadOnly).await,
        Err(OpenError::SchemaAhead { unknown }) if unknown == vec![999999]
    ));
    assert!(matches!(
        open(&path, writer("notebook")).await,
        Err(OpenError::SchemaAhead { unknown }) if unknown == vec![999999]
    ));
}

#[tokio::test]
async fn a_write_open_while_the_app_holds_the_database_is_refused_unless_forced() {
    let path = migrated_database().await;
    let _app = AppHold::acquire(&path).unwrap();
    assert!(matches!(
        open(&path, writer("notebook")).await,
        Err(OpenError::HeldByApp(held)) if held == path
    ));
    let forced = OpenMode::Write {
        client: "notebook".parse().unwrap(),
        force: true,
    };
    assert!(open(&path, forced).await.is_ok());
    assert!(open(&path, OpenMode::ReadOnly).await.is_ok());
}

#[tokio::test]
async fn every_journal_entry_names_the_client_that_wrote_it() {
    let path = migrated_database().await;
    let notebook = open(&path, writer("notebook")).await.unwrap();
    let mut db = notebook.begin().await.unwrap();
    db.domains()
        .create(new_domain("from python"))
        .await
        .unwrap();
    db.commit().await.unwrap();

    let pool = notebook.pool_for_tests();
    let clients: Vec<String> = sqlx::query_scalar("SELECT DISTINCT client FROM undo_journal")
        .fetch_all(pool)
        .await
        .unwrap();
    assert_eq!(clients, vec!["notebook".to_string()]);
    let context: String = sqlx::query_scalar("SELECT client FROM undo_context WHERE id = 1")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(context, "desktop", "the stamp is put back at the commit");
}

#[tokio::test]
async fn a_rolled_back_write_leaves_the_context_on_desktop() {
    let path = migrated_database().await;
    let notebook = open(&path, writer("notebook")).await.unwrap();
    let mut db = notebook.begin().await.unwrap();
    db.domains().create(new_domain("never")).await.unwrap();
    drop(db);
    let context: String = sqlx::query_scalar("SELECT client FROM undo_context WHERE id = 1")
        .fetch_one(notebook.pool_for_tests())
        .await
        .unwrap();
    assert_eq!(context, "desktop");
}

#[tokio::test]
async fn the_desktop_undo_stack_never_takes_another_clients_write() {
    let path = migrated_database().await;
    let desktop = SessionFactory::new(
        connect_with(SqliteConnectOptions::new().filename(&path), false)
            .await
            .unwrap(),
    );
    let notebook = open(&path, writer("notebook")).await.unwrap();
    let stacks = UndoStacks::new();

    // The app opens a Gesture; a script writes while it is open, so its entry carries the
    // Gesture's id; the app closes the Gesture having written nothing itself.
    desktop
        .connect()
        .await
        .unwrap()
        .undo()
        .open_gesture()
        .await
        .unwrap();
    let mut db = notebook.begin().await.unwrap();
    db.domains()
        .create(new_domain("from python"))
        .await
        .unwrap();
    db.commit().await.unwrap();
    let closed = close_gesture(&desktop, &stacks).await.unwrap();

    assert_eq!(closed.undoable, None, "nothing of the desktop's to undo");
    assert!(
        closed.wrote,
        "but the board did move, so the windows must hear of it"
    );
}

#[tokio::test]
async fn the_desktop_undo_stack_takes_its_own_write() {
    let path = migrated_database().await;
    let desktop = SessionFactory::new(
        connect_with(SqliteConnectOptions::new().filename(&path), false)
            .await
            .unwrap(),
    );
    let stacks = UndoStacks::new();

    desktop
        .connect()
        .await
        .unwrap()
        .undo()
        .open_gesture()
        .await
        .unwrap();
    let mut db = desktop.begin().await.unwrap();
    db.domains()
        .create(new_domain("from the app"))
        .await
        .unwrap();
    db.commit().await.unwrap();
    let closed = close_gesture(&desktop, &stacks).await.unwrap();

    assert!(closed.undoable.is_some());
}
