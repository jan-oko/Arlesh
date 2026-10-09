// Included by every integration-test binary via `mod helpers;`, and no one binary uses all of it.
#![allow(dead_code)]

use std::sync::{Mutex, OnceLock};

use arlesh_lib::database::session::SessionFactory;
use arlesh_lib::undo::stacks::UndoStacks;
use libsqlite3_sys as ffi;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;

/// A migrated, in-memory database for one test.
///
/// Created the way a fresh install is (`database::migrate`), but only once per test binary: the
/// first caller migrates a template database, and every test then starts from a copy of it made
/// with SQLite's backup API. The copy is page for page what migrating would have built, at a
/// fraction of the cost.
///
/// **One connection only.** Anything that holds a `Db` session open and then queries the pool
/// waits on `acquire` for sqlx's 30-second default and fails with a connection timeout rather than
/// an assertion. Read the pool only after the session has been committed or dropped.
pub async fn test_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .after_connect(|conn, _| {
            Box::pin(async move {
                sqlx::query("PRAGMA foreign_keys = ON")
                    .execute(conn)
                    .await?;
                Ok(())
            })
        })
        .connect("sqlite::memory:")
        .await
        .expect("failed to open in-memory SQLite");

    let mut connection = pool
        .acquire()
        .await
        .expect("failed to acquire the connection");
    let mut handle = connection
        .lock_handle()
        .await
        .expect("failed to lock the connection");
    // SAFETY: the pointer is the open handle of the connection locked just above, which stays
    // locked, and so unused by anything else, until `handle` drops at the end of the block.
    unsafe {
        copy_database(
            template().lock().expect("template poisoned").0,
            handle.as_raw_handle().as_ptr(),
        )
    };
    drop(handle);
    drop(connection);

    pool
}

/// An open SQLite handle that may be moved between threads: the template is only ever touched
/// under the [`Mutex`] it lives in, and the bundled SQLite is built thread-safe.
struct Handle(*mut ffi::sqlite3);

// SAFETY: see the type's documentation.
unsafe impl Send for Handle {}

/// The migrated database every test copies, built the first time it is asked for.
fn template() -> &'static Mutex<Handle> {
    static TEMPLATE: OnceLock<Mutex<Handle>> = OnceLock::new();
    TEMPLATE.get_or_init(|| {
        // A runtime of its own on its own thread: the first caller is one test's runtime, and a
        // pool created on it would not outlive that test.
        std::thread::spawn(build_template)
            .join()
            .expect("the template database could not be built")
    })
}

/// Migrates an in-memory database and moves its pages into a handle opened directly, which does
/// not depend on the runtime and pool that migrated it.
fn build_template() -> Mutex<Handle> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("failed to build the template runtime");
    runtime.block_on(async {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("failed to open the template database");
        arlesh_lib::database::migrate(&pool)
            .await
            .expect("migrations failed");

        let mut connection = pool
            .acquire()
            .await
            .expect("failed to acquire the template");
        let mut handle = connection
            .lock_handle()
            .await
            .expect("failed to lock the template connection");
        let mut template = std::ptr::null_mut();
        // SAFETY: `template` is a valid out-pointer; the source handle is the template
        // connection's, locked until `handle` drops.
        unsafe {
            let opened = ffi::sqlite3_open_v2(
                c":memory:".as_ptr(),
                &mut template,
                ffi::SQLITE_OPEN_READWRITE | ffi::SQLITE_OPEN_CREATE,
                std::ptr::null(),
            );
            assert_eq!(opened, ffi::SQLITE_OK, "failed to open the template copy");
            copy_database(handle.as_raw_handle().as_ptr(), template);
        }
        Mutex::new(Handle(template))
    })
}

/// Copies every page of `from` over `to` with SQLite's online backup API.
///
/// # Safety
///
/// Both must be open handles that nothing else is using for the duration of the call.
unsafe fn copy_database(from: *mut ffi::sqlite3, to: *mut ffi::sqlite3) {
    let backup = ffi::sqlite3_backup_init(to, c"main".as_ptr(), from, c"main".as_ptr());
    assert!(!backup.is_null(), "failed to start the database copy");
    let stepped = ffi::sqlite3_backup_step(backup, -1);
    let finished = ffi::sqlite3_backup_finish(backup);
    assert_eq!(stepped, ffi::SQLITE_DONE, "failed to copy the database");
    assert_eq!(
        finished,
        ffi::SQLITE_OK,
        "failed to finish the database copy"
    );
}

/// A mock Tauri app managing a [`SessionFactory`] over `pool`, so that Tauri commands can be
/// called directly in tests.
///
/// [`tauri::State`] is a newtype over a borrow with no public constructor: it is only ever built
/// by Tauri's own argument resolution, so the only way to hand a command its state is to stand up
/// an app that manages it. Keep the returned app alive for as long as the `State` it lends out:
///
/// ```ignore
/// let pool = helpers::test_pool().await;
/// let app = helpers::command_host(&pool);
/// set_block_reasons(app.state(), "task".into(), task_id, vec!["stuck".into()])
///     .await
///     .unwrap();
/// ```
///
/// This is how a command that opens a transactional session gets tested at all. Mirroring the
/// command's body in a test instead cannot catch a missing `commit()`, which is the one mistake
/// the session types do not prevent.
pub fn command_host(pool: &SqlitePool) -> tauri::App<tauri::test::MockRuntime> {
    use tauri::Manager;

    let app = tauri::test::mock_app();
    app.manage(SessionFactory::new(pool.clone()));
    // Every host manages the stacks, not only the tests that drive undo: `close_gesture` records
    // onto them, so a host without them would fail to resolve state for a command that half the
    // journal tests already call.
    app.manage(UndoStacks::new());
    // The agent capacity lock, off, which `load_mindmap` reads to derive its block.
    app.manage(arlesh_lib::capacity::AgentCapacity::in_memory());
    // And every host has a window, because a command that announces a board change takes the
    // window that issued it — that is how the other windows are told and this one is not.
    // `mock_app` builds none of its own.
    tauri::WebviewWindowBuilder::new(&app, TEST_WINDOW, tauri::WebviewUrl::default())
        .build()
        .expect("the mock runtime could not build a window");
    app
}

/// The label of the window [`command_host`] builds.
pub const TEST_WINDOW: &str = "main";

/// The window a command that takes one is called with.
pub fn window(
    app: &tauri::App<tauri::test::MockRuntime>,
) -> tauri::WebviewWindow<tauri::test::MockRuntime> {
    use tauri::Manager;

    app.get_webview_window(TEST_WINDOW)
        .expect("command_host builds a window")
}

/// A [`SessionFactory`] over `pool`, for tests that drive a session themselves rather than through
/// a command — seeding a fixture, or standing in for a caller that fails part-way and rolls back.
///
/// The one-connection caution above applies unchanged: commit or drop the session before reading
/// the pool.
pub fn session_factory(pool: &SqlitePool) -> SessionFactory {
    SessionFactory::new(pool.clone())
}

/// Makes every Aspect an MCP root, so the MCP can read the whole board — private nodes aside.
///
/// The MCP sees nothing until the user names a root, so a test about what a tool *returns* has to
/// open the board first. Every node hangs under an Aspect and the Aspects are seeded by the
/// initial migration, so rooting them once at the start covers whatever the test creates later.
///
/// Written straight to the table with no Gesture open, so it is on no undo stack; a test that
/// dumps the journal should call this before it starts reading.
pub async fn open_board_to_mcp(pool: &SqlitePool) {
    sqlx::query(
        "INSERT INTO mcp_roots (node_kind, node_id) \
         SELECT 'domain', id FROM domains WHERE parent_id IS NULL \
         ON CONFLICT (node_kind, node_id) DO NOTHING",
    )
    .execute(pool)
    .await
    .expect("failed to root the Aspects for the MCP");
}

/// An MCP handler over `pool` with every Aspect already an MCP root — see
/// [`open_board_to_mcp`].
pub async fn mcp_over_whole_board(pool: &SqlitePool) -> arlesh_lib::mcp::ArleshMcp {
    open_board_to_mcp(pool).await;
    arlesh_lib::mcp::ArleshMcp::new(session_factory(pool))
}

/// Marks a Task Agentic, which is what lets the MCP write it inside a root.
///
/// Straight to the column, with no Gesture open, for the same reason as [`open_board_to_mcp`] —
/// and so it converts by hand what the app's write would: the Task's status, and that of every
/// Task beneath it that inherits the flag, into the Agentic model's spelling.
pub async fn make_agentic(pool: &SqlitePool, task_id: i64) {
    sqlx::query("UPDATE tasks SET agentic = 1 WHERE id = ?")
        .bind(task_id)
        .execute(pool)
        .await
        .expect("failed to mark the task Agentic");
    sqlx::query(
        "WITH RECURSIVE below(id) AS (
             SELECT ?
             UNION ALL
             SELECT t.id FROM tasks t JOIN below b ON t.parent_type = 'task' AND t.parent_id = b.id
              WHERE t.agentic IS NULL
         )
         UPDATE tasks SET status = CASE status
             WHEN 'todo' THEN 'agentic_todo' WHEN 'done' THEN 'agentic_done'
             WHEN 'in_progress' THEN 'doing' WHEN 'started' THEN 'doing' ELSE status END
          WHERE id IN (SELECT id FROM below)",
    )
    .bind(task_id)
    .execute(pool)
    .await
    .expect("failed to convert the task's status");
}

/// Makes a Person to delegate to, and returns their id. Straight to the table, as
/// [`make_agentic`] writes its column.
pub async fn make_person(pool: &SqlitePool, name: &str) -> i64 {
    sqlx::query("INSERT INTO people (name) VALUES (?)")
        .bind(name)
        .execute(pool)
        .await
        .expect("failed to make a person")
        .last_insert_rowid()
}

/// The integer id of a row a test made by hand. Every such row is stored, so a derived id here is
/// a broken fixture and fails loudly.
pub trait StoredId {
    /// The stored primary key.
    fn sid(&self) -> i64;
}

impl StoredId for arlesh_lib::nodes::id::NodeId {
    fn sid(&self) -> i64 {
        self.stored().expect("a row made by hand is stored")
    }
}

/// Every row inserted, updated or deleted on the test pool's one connection since it opened.
///
/// The pool has a single connection, so this counts every write anything made through it — which
/// is how a test asserts that an operation is a pure read.
pub async fn total_changes(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT total_changes()")
        .fetch_one(pool)
        .await
        .expect("total_changes")
}
