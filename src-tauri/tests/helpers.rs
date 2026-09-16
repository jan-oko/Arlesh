// Included by every integration-test binary via `mod helpers;`, and no one binary uses all of it.
#![allow(dead_code)]

use arlesh_lib::database::session::SessionFactory;
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
    app
}

/// A [`SessionFactory`] over `pool`, for tests that drive a session themselves rather than through
/// a command — seeding a fixture, or standing in for a caller that fails part-way and rolls back.
///
/// The one-connection caution above applies unchanged: commit or drop the session before reading
/// the pool.
pub fn session_factory(pool: &SqlitePool) -> SessionFactory {
    SessionFactory::new(pool.clone())
}
