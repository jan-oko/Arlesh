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
