// Included by every integration-test binary via `mod helpers;`, and no one binary uses all of it.
#![allow(dead_code)]

use arlesh_lib::database::session::SessionFactory;
use arlesh_lib::undo::stacks::UndoStacks;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;

/// A migrated, in-memory database for one test.
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

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("migrations failed");

    pool
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
/// Straight to the column, with no Gesture open, for the same reason as [`open_board_to_mcp`].
pub async fn make_agentic(pool: &SqlitePool, task_id: i64) {
    sqlx::query("UPDATE tasks SET agentic = 1 WHERE id = ?")
        .bind(task_id)
        .execute(pool)
        .await
        .expect("failed to mark the task Agentic");
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
