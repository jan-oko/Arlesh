#![deny(clippy::all)]
#![deny(missing_docs)]
//! Arlesh — task management and knowledge-base desktop app.

pub mod commands;
pub mod database;
pub mod domains;
pub mod error;
pub mod knowledge_base;
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

            let database_url = format!("sqlite://{}/arlesh.db?mode=rwc", app_dir.display());

            let pool = tauri::async_runtime::block_on(async {
                let pool = database::connect(&database_url).await.map_err(|error| {
                    tracing::error!(error = %error, "bootstrap failed: database connect");
                    error
                })?;
                database::run_migrations(&pool).await.map_err(|error| {
                    tracing::error!(error = %error, "bootstrap failed: migrations");
                    error
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
            commands::tasks::list_task_dependencies,
            commands::tasks::create_goal,
            commands::tasks::get_goal,
            commands::tasks::list_goals,
            commands::tasks::update_goal,
            commands::tasks::delete_goal,
            commands::tasks::add_tag_to_task,
            commands::tasks::remove_tag_from_task,
            commands::tasks::add_tag_to_goal,
            commands::tasks::remove_tag_from_goal,
            commands::scopes::get_or_create_scope,
            commands::scopes::get_scope,
            commands::knowledge_base::create_person,
            commands::knowledge_base::get_person,
            commands::knowledge_base::list_people,
            commands::knowledge_base::update_person,
            commands::knowledge_base::delete_person,
            commands::knowledge_base::create_event,
            commands::knowledge_base::list_events,
            commands::knowledge_base::create_thread,
            commands::knowledge_base::list_threads,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
