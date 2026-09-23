#![deny(clippy::all)]
#![deny(missing_docs)]
//! Arlesh — task management and knowledge-base desktop app.

pub mod block_reasons;
pub mod board;
pub mod commands;
pub mod database;
pub mod domains;
pub mod duplicate;
pub mod error;
pub mod filters;
pub mod flows;
pub mod icon;
pub mod infos;
pub mod knowledge_base;
pub mod mcp;
pub mod mindmap;
pub mod scopes;
pub mod tasks;
pub mod tray;
pub mod undo;
pub mod windows;
pub mod wire;

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
        // One handler for every window, rather than one attached per window at creation: a torn-off
        // window is a window like any other, and a handler wired up at creation time is one a future
        // path that creates a window could forget.
        .on_window_event(commands::tray::on_window_event)
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

            // The factory is the sole owner of the pool: every command resolves
            // `State<SessionFactory>` and reaches the database only through a session it hands
            // out. Nothing managed here can acquire a connection behind a session's back.
            let factory = database::session::SessionFactory::new(pool);

            // The Undo Stack is session-scoped, so the journal starts every run empty and the
            // ambient context starts every run clear. A `suppressed` flag or a half-open Gesture
            // left behind by a crash mid-undo would otherwise silently stop the triggers
            // recording for the whole of this session.
            tauri::async_runtime::block_on(undo::reset_journal(&factory))?;

            // The MCP endpoint shares the factory rather than the pool, so an agent's reads go
            // through the same session layer the commands do. It also gets a way to say the board
            // changed, so an agent setting a `beads_id` refreshes the windows that are open rather
            // than leaving them showing the old value. `serve` swallows a bind failure: an occupied
            // port must not take the windows down with it.
            tauri::async_runtime::spawn(mcp::serve(
                factory.clone(),
                commands::board::announcer(app.handle()),
            ));

            app.manage(factory);

            // The Undo and Redo Stacks: one pair for the whole app, in memory beside the factory.
            // Constructing them here is the whole of "session-scoped" — a restart is an empty
            // history, and nothing has to clear them.
            app.manage(undo::stacks::UndoStacks::new());

            // The window session is read before any window exists and reopened before the event
            // loop runs, so that by the time one window's frontend executes a line of JavaScript
            // every window of the session is already there. `tauri.conf.json` marks its window
            // `"create": false` for exactly this: every window, including the first, is built here
            // from that config under the label its tabs are stored beside.
            app.manage(commands::windows::SessionStore::open(&app_dir));
            // The numbers the windows wear, seeded as they are rebuilt. Managed before `restore`
            // so a restored window's saved number is the one it keeps.
            app.manage(commands::windows::Ordinals::default());
            commands::windows::restore(app.handle())?;

            // The tray goes up last, so that everything its Quit has to release cleanly — the
            // factory, the journal, the MCP listener — is already in place before the user can
            // ask for it. Closing the last window hides it to this tray by default, which is what
            // keeps the MCP endpoint answering while no window is open.
            commands::tray::install(app.handle());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::tray::set_close_to_tray,
            commands::tray::quit_app,
            commands::undo::open_gesture,
            commands::undo::close_gesture,
            commands::undo::abort_gesture,
            commands::undo::undo,
            commands::undo::redo,
            commands::undo::undo_status,
            commands::beads::clear_beads_id,
            commands::block_reasons::list_all_block_reasons,
            commands::block_reasons::set_block_reasons,
            commands::infos::create_info,
            commands::infos::list_infos,
            commands::infos::update_info,
            commands::infos::delete_info,
            commands::infos::duplicate_info,
            commands::domains::create_domain,
            commands::domains::get_domain,
            commands::domains::list_domains,
            commands::domains::update_domain,
            commands::domains::delete_domain,
            commands::domains::duplicate_domain,
            commands::tasks::create_task,
            commands::tasks::get_task,
            commands::tasks::list_tasks,
            commands::tasks::update_task,
            commands::tasks::scope_containment_conflicts,
            commands::tasks::reparent_scope_conflicts,
            commands::tasks::delete_task,
            commands::tasks::duplicate_task,
            commands::tasks::add_task_dependency,
            commands::tasks::remove_task_dependency,
            commands::tasks::list_task_dependencies,
            commands::tasks::list_all_task_dependencies,
            commands::tasks::create_goal,
            commands::tasks::get_goal,
            commands::tasks::list_goals,
            commands::tasks::update_goal,
            commands::tasks::delete_goal,
            commands::tasks::duplicate_goal,
            commands::tasks::add_tag_to_task,
            commands::tasks::remove_tag_from_task,
            commands::tasks::add_tag_to_goal,
            commands::tasks::remove_tag_from_goal,
            commands::tasks::derive_scope_lifecycles,
            commands::commitments::create_commitment,
            commands::commitments::get_commitment,
            commands::commitments::list_commitments,
            commands::commitments::update_commitment,
            commands::commitments::delete_commitment,
            commands::commitments::add_tag_to_commitment,
            commands::commitments::remove_tag_from_commitment,
            commands::retype::retype_node,
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
            commands::flows::list_flow_instance_nodes,
            commands::flows::set_flow_recurrence,
            commands::flows::get_flow_recurrence,
            commands::flows::delete_flow_recurrence,
            commands::flows::generate_habit_iterations,
            commands::flows::list_habit_item_statuses,
            commands::flows::set_habit_item_status,
            commands::flows::create_habit_instance_child,
            commands::flows::list_habit_instance_children,
            commands::flows::set_habit_iteration_done,
            commands::flows::habit_completion_count,
            commands::flows::clear_habit_modifications,
            commands::flows::fork_flow,
            commands::flows::duplicate_flow,
            commands::flows::duplicate_flow_item,
            commands::flows::convert_to_flow,
            commands::flows::set_flow_item_cycles,
            commands::flows::list_all_flow_cycles,
            commands::flows::add_flow_dependency,
            commands::flows::remove_flow_dependency,
            commands::flows::list_all_flow_dependencies,
            commands::mindmap::load_mindmap,
            commands::windows::open_board_window,
            commands::windows::board_windows,
            commands::windows::focus_board_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
