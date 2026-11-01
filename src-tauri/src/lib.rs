#![deny(clippy::all)]
#![deny(missing_docs)]
//! Arlesh — task management and knowledge-base desktop app.

pub mod backend;
pub mod client_mode;
pub mod commands;
pub mod icon;
pub mod tray;
pub mod windows;

// The domain lives in `arlesh-core`. Its modules are re-exported here under the paths they had
// before the workspace split, so `crate::tasks` in a command and `arlesh_lib::tasks` in an
// integration test still name the same thing.
pub use arlesh_core::{
    access, block_reasons, board, capacity, database, domains, duplicate, error, filters, flows,
    infos, knowledge_base, mcp, mindmap, nodes, scopes, tasks, undo, wire,
};

use tauri::Manager;
use tracing_subscriber::EnvFilter;

/// Application entry point registered with Tauri.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
    // One handler for every window, rather than one attached per window at creation: a torn-off
    // window is a window like any other, and a handler wired up at creation time is one a future
    // path that creates a window could forget. A phone has one window and nothing to hide into.
    #[cfg(desktop)]
    let builder = builder.on_window_event(commands::tray::on_window_event);
    // A phone suspends the app when it leaves the foreground: the server's change stream is
    // dropped then and opened again, with `/health` checked, when the app returns.
    #[cfg(mobile)]
    let builder = builder.on_window_event(commands::client_mode::on_lifecycle);
    builder
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("could not resolve app data dir");
            std::fs::create_dir_all(&app_dir).expect("could not create app data dir");

            // Standalone or Client: which backend every command calls through on this device.
            let saved = client_mode::settings::read(&app_dir);
            let startup = client_mode::settings::startup(
                saved,
                app_dir.join("arlesh.db").exists(),
                cfg!(feature = "standalone"),
            );
            let server = match &startup.mode {
                client_mode::settings::Mode::Standalone => {
                    setup_standalone(app, &app_dir)?;
                    None
                }
                client_mode::settings::Mode::Client { url, token_in_file } => {
                    Some(setup_client(app, &app_dir, url, *token_in_file)?)
                }
            };
            app.manage(commands::client_mode::ClientModeState::new(
                app_dir.clone(),
                startup,
                server,
            ));

            #[cfg(desktop)]
            setup_desktop_shell(app, &app_dir)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::tray::set_close_to_tray,
            commands::tray::quit_app,
            commands::client_mode::mode_status,
            commands::client_mode::keychain_available,
            commands::client_mode::test_server,
            commands::client_mode::connect_to_server,
            commands::client_mode::use_standalone,
            commands::devices::device_name,
            commands::devices::pair_start,
            commands::devices::pair_poll,
            commands::devices::list_devices,
            commands::devices::waiting_device,
            commands::devices::approve_device,
            commands::devices::revoke_device,
            commands::undo::open_gesture,
            commands::undo::close_gesture,
            commands::undo::abort_gesture,
            commands::undo::undo,
            commands::undo::redo,
            commands::undo::undo_status,
            commands::access::mcp_access_catalogue,
            commands::access::list_mcp_access,
            commands::access::add_mcp_root,
            commands::access::remove_mcp_root,
            commands::mcp_endpoint::mcp_endpoint_status,
            commands::mcp_endpoint::restart_mcp_endpoint,
            commands::mcp_endpoint::set_mcp_port,
            commands::capacity::agent_capacity,
            commands::capacity::set_agent_capacity,
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
            commands::tasks::dependency_candidates,
            commands::gestures::step_task_status,
            commands::gestures::toggle_task_agentic,
            commands::gestures::press_commitment_verdict,
            commands::tasks::scope_containment_conflicts,
            commands::tasks::plan_containment_conflicts,
            commands::tasks::update_task_settling_plans,
            commands::tasks::reparent_scope_conflicts,
            commands::tasks::delete_task,
            commands::tasks::duplicate_task,
            commands::tasks::add_task_dependency,
            commands::tasks::remove_task_dependency,
            commands::tasks::list_task_dependencies,
            commands::tasks::task_done_at,
            commands::tasks::set_task_done_at,
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
            commands::expectations::create_expectation,
            commands::expectations::list_expectations,
            commands::expectations::update_expectation,
            commands::expectations::complete_expectation_check,
            commands::expectations::update_spawned_wait,
            commands::expectations::complete_spawned_wait_check,
            commands::expectations::reopen_expectation_check,
            commands::expectations::reopen_spawned_wait_check,
            commands::expectations::delete_expectation,
            commands::expectations::add_tag_to_expectation,
            commands::expectations::remove_tag_from_expectation,
            commands::scopes::scope_containing,
            commands::scopes::part_scope,
            commands::scopes::exact_scope,
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
            commands::flows::create_flow_commitment,
            commands::flows::create_flow_expectation,
            commands::flows::update_flow_commitment,
            commands::flows::update_flow_expectation,
            commands::flows::list_flow_goals,
            commands::flows::list_flow_tasks,
            commands::flows::list_all_flow_goals,
            commands::flows::list_all_flow_tasks,
            commands::flows::update_flow_goal,
            commands::flows::update_flow_task,
            commands::flows::delete_flow_item,
            commands::flows::start_flow,
            commands::flows::scope_valid_flow_targets,
            commands::flows::flow_origins,
            commands::flows::list_flow_instance_nodes,
            commands::flows::set_flow_recurrence,
            commands::flows::get_flow_recurrence,
            commands::flows::delete_flow_recurrence,
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
            commands::node_gestures::delete_nodes,
            commands::node_gestures::run_gesture,
            commands::windows::open_board_window,
            commands::windows::board_windows,
            commands::windows::focus_board_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Standalone mode: the local database, held while the app runs, served in-process by
/// [`backend::sqlite::SqliteBackend`], with the app's own MCP endpoint.
#[cfg(feature = "standalone")]
fn setup_standalone(
    app: &mut tauri::App,
    app_dir: &std::path::Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let database_url = format!("sqlite://{}/arlesh.db?mode=rwc", app_dir.display());

    // Mark the database as held while the app runs, so another writer — a Python session
    // through the bindings — is refused unless it insists (`arlesh_core::database::hold`).
    // A hold someone else already has is not a reason to stop: the app still runs, and
    // the other writer simply is not warned off.
    match database::hold::AppHold::acquire(&app_dir.join("arlesh.db")) {
        Ok(hold) => {
            app.manage(hold);
        }
        Err(error) => tracing::warn!(error = %error, "could not hold the database"),
    }

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
    // changed, so an agent's write refreshes the windows that are open rather than leaving
    // them showing the old value. A bind failure is recorded in its status, for the
    // settings page to show and retry: an occupied port must not take the windows down.
    // The agent capacity lock is shared by the endpoint's sessions and the settings
    // commands, and tells every window when either side changes it.
    let capacity = capacity::AgentCapacity::open(
        app_dir.join(capacity::CAPACITY_FILE),
        commands::capacity::notifier(app.handle()),
    );
    let endpoint = mcp::endpoint::McpEndpoint::new(
        factory.clone(),
        commands::board::announcer(app.handle()),
        capacity.clone(),
        app_dir.join(mcp::endpoint::SETTINGS_FILE),
        mcp::endpoint::env_port(),
    );
    app.manage(endpoint.clone());
    tauri::async_runtime::spawn(async move {
        endpoint.restart().await;
    });

    // The Backend port every command calls through, in-process over the local file. The
    // Undo and Redo Stacks are one pair for the whole app, in memory inside it.
    // Constructing them here is the whole of "session-scoped" — a restart is an empty
    // history, and nothing has to clear them.
    app.manage(backend::AppBackend::new(
        backend::sqlite::SqliteBackend::new(factory, undo::stacks::UndoStacks::new(), capacity),
    ));
    Ok(())
}

/// A build without the `standalone` feature has no local database to run on.
#[cfg(not(feature = "standalone"))]
fn setup_standalone(
    _app: &mut tauri::App,
    _app_dir: &std::path::Path,
) -> Result<(), Box<dyn std::error::Error>> {
    Err("this build has no Standalone mode: connect it to a server (mode.json)".into())
}

/// Client mode: every command calls `arlesh-server` through [`backend::http::HttpBackend`]. No
/// database is opened and no MCP endpoint is served: agents use the server's. The server's change
/// stream is followed for the life of the app, and every window hears of a change as it would of
/// a local one.
fn setup_client(
    app: &mut tauri::App,
    app_dir: &std::path::Path,
    url: &str,
    token_in_file: bool,
) -> Result<std::sync::Arc<backend::http::HttpBackend>, Box<dyn std::error::Error>> {
    let token = match client_mode::vault::load(app_dir, url, token_in_file) {
        Ok(Some(token)) => token,
        Ok(None) => {
            tracing::warn!("no token is kept for the server; every call will be refused");
            String::new()
        }
        Err(error) => {
            tracing::warn!(error = %error, "the server's token could not be read");
            String::new()
        }
    };
    let backend = std::sync::Arc::new(
        backend::http::HttpBackend::new(
            backend::http::Connection::new(url, token),
            commands::client_mode::status_notifier(app.handle()),
        )
        .map_err(|error| format!("{error:?}"))?,
    );
    app.manage(backend::AppBackend::shared(backend.clone()));
    if url.is_empty() {
        // First run of a build with no Standalone mode: no server chosen yet, so nothing to follow.
        return Ok(backend);
    }
    let follower = backend::http::events::Follower::new(
        backend.clone(),
        std::sync::Arc::new({
            let announce = commands::board::announcer(app.handle());
            move || announce(None)
        }),
    );
    follower.resume();
    app.manage(follower);
    Ok(backend)
}

/// The desktop's shell, built after the backend is up: the saved window session reopened, and the
/// tray. A phone has one window, which Tauri builds from `tauri.android.conf.json`, and neither.
#[cfg(desktop)]
fn setup_desktop_shell(
    app: &mut tauri::App,
    app_dir: &std::path::Path,
) -> Result<(), Box<dyn std::error::Error>> {
    // The window session is read before any window exists and reopened before the event
    // loop runs, so that by the time one window's frontend executes a line of JavaScript
    // every window of the session is already there. `tauri.conf.json` marks its window
    // `"create": false` for exactly this: every window, including the first, is built here
    // from that config under the label its tabs are stored beside.
    app.manage(commands::windows::SessionStore::open(app_dir));
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
}
