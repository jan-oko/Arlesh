#![deny(clippy::all)]
#![deny(missing_docs)]
//! Arlesh — task management and knowledge-base desktop app.

pub mod commands;
pub mod db;
pub mod domains;
pub mod error;
pub mod kb;
pub mod scopes;
pub mod tasks;

use tauri::Manager;
use tracing_subscriber::EnvFilter;

/// Application entry point registered with Tauri.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("could not resolve app data dir");
            std::fs::create_dir_all(&app_dir).expect("could not create app data dir");

            let db_url = format!("sqlite://{}/arlesh.db?mode=rwc", app_dir.display());

            let pool = tauri::async_runtime::block_on(async {
                let pool = db::connect(&db_url).await.map_err(|e| {
                    tracing::error!(error = %e, "bootstrap failed: db connect");
                    e
                })?;
                db::run_migrations(&pool).await.map_err(|e| {
                    tracing::error!(error = %e, "bootstrap failed: migrations");
                    e
                })?;
                tracing::info!("database ready");
                Ok::<_, anyhow::Error>(pool)
            })
            .expect("database setup failed");

            app.manage(pool);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::domains::create_domain,
            commands::domains::get_domain,
            commands::domains::list_domains,
            commands::domains::update_domain,
            commands::domains::delete_domain,
            commands::tasks::create_task,
            commands::tasks::get_task,
            commands::tasks::list_tasks,
            commands::tasks::update_task,
            commands::tasks::delete_task,
            commands::tasks::add_task_dependency,
            commands::tasks::remove_task_dependency,
            commands::tasks::create_goal,
            commands::tasks::get_goal,
            commands::tasks::list_goals,
            commands::tasks::update_goal,
            commands::tasks::delete_goal,
            commands::scopes::get_or_create_scope,
            commands::scopes::get_scope,
            commands::kb::create_person,
            commands::kb::get_person,
            commands::kb::list_people,
            commands::kb::update_person,
            commands::kb::delete_person,
            commands::kb::create_event,
            commands::kb::list_events,
            commands::kb::create_thread,
            commands::kb::list_threads,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
