#![deny(clippy::all)]
#![deny(missing_docs)]
//! Arlesh — task management and knowledge-base desktop app.

const EMBEDDED_ICON: &[u8] = include_bytes!("../icons/128x128.png");

pub mod commands;
pub mod database;
pub mod domains;
pub mod error;
pub mod flows;
pub mod infos;
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

            if let Some(window) = app.get_webview_window("main") {
                let icon = match app.default_window_icon().cloned() {
                    Some(icon) => icon,
                    None => {
                        let mut decoder = png::Decoder::new(EMBEDDED_ICON);
                        decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::ALPHA);
                        let mut reader = decoder.read_info()
                            .map_err(|e| anyhow::anyhow!("icon decode error: {e}"))?;
                        let mut buf = vec![0u8; reader.output_buffer_size()];
                        let info = reader.next_frame(&mut buf)
                            .map_err(|e| anyhow::anyhow!("icon frame error: {e}"))?;
                        let rgba = buf[..info.buffer_size()].to_vec();
                        tauri::image::Image::new_owned(rgba, info.width, info.height)
                    }
                };
                window.set_icon(icon)?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::infos::create_info,
            commands::infos::list_infos,
            commands::infos::update_info,
            commands::infos::delete_info,
            commands::domains::create_domain,
            commands::domains::get_domain,
            commands::domains::list_domains,
            commands::domains::update_domain,
            commands::domains::delete_domain,
            commands::tasks::create_task,
            commands::tasks::get_task,
            commands::tasks::list_tasks,
            commands::tasks::update_task,
            commands::tasks::scope_containment_conflicts,
            commands::tasks::reparent_scope_conflicts,
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
            commands::tasks::derive_scope_lifecycles,
            commands::scopes::get_or_create_scope,
            commands::scopes::get_or_create_part_scope,
            commands::scopes::get_or_create_exact_scope,
            commands::scopes::get_scope,
            commands::scopes::resolve_scope,
            commands::knowledge_base::create_person,
            commands::knowledge_base::get_person,
            commands::knowledge_base::list_people,
            commands::knowledge_base::update_person,
            commands::knowledge_base::delete_person,
            commands::knowledge_base::create_event,
            commands::knowledge_base::list_events,
            commands::knowledge_base::create_thread,
            commands::knowledge_base::list_threads,
            commands::flows::create_flow,
            commands::flows::get_flow,
            commands::flows::list_flows,
            commands::flows::update_flow,
            commands::flows::delete_flow,
            commands::flows::create_flow_goal,
            commands::flows::create_flow_task,
            commands::flows::list_flow_goals,
            commands::flows::list_flow_tasks,
            commands::flows::list_all_flow_goals,
            commands::flows::list_all_flow_tasks,
            commands::flows::update_flow_goal,
            commands::flows::update_flow_task,
            commands::flows::delete_flow_item,
            commands::flows::convert_flow_item,
            commands::flows::start_flow,
            commands::flows::scope_valid_flow_targets,
            commands::flows::flow_origins,
            commands::flows::set_flow_recurrence,
            commands::flows::get_flow_recurrence,
            commands::flows::delete_flow_recurrence,
            commands::flows::generate_habit_iterations,
            commands::flows::list_habit_item_statuses,
            commands::flows::set_habit_item_status,
            commands::flows::habit_completion_count,
            commands::flows::clear_habit_modifications,
            commands::flows::fork_flow,
            commands::flows::convert_to_flow,
            commands::flows::set_flow_item_cycles,
            commands::flows::list_all_flow_cycles,
            commands::flows::add_flow_dependency,
            commands::flows::remove_flow_dependency,
            commands::flows::list_all_flow_dependencies,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
