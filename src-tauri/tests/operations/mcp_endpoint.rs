//! The MCP endpoint's listener: the status it reports, a bind failure surfaced rather than
//! swallowed, a restart, and moving it to another port without restarting the app.

use crate::helpers;

use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;

use arlesh_lib::board;
use arlesh_lib::mcp::endpoint::{
    read_port_setting, EndpointError, ListenerState, McpEndpoint, SETTINGS_FILE,
};
use arlesh_lib::mcp::DEFAULT_PORT;

/// A settings file of this test's own, in a fresh directory.
fn settings_path(test: &str) -> PathBuf {
    let dir =
        std::env::temp_dir().join(format!("arlesh-mcp-endpoint-{}-{test}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create the settings directory");
    dir.join(SETTINGS_FILE)
}

/// A port nothing is listening on just now.
fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .expect("find a free port")
        .port()
}

async fn endpoint(settings: PathBuf, env_override: Option<u16>) -> McpEndpoint {
    let pool = helpers::test_pool().await;
    McpEndpoint::new(
        helpers::session_factory(&pool),
        board::silent(),
        settings,
        env_override,
    )
}

fn accepts(port: u16) -> bool {
    TcpStream::connect(("127.0.0.1", port)).is_ok()
}

fn listening_on(port: u16) -> ListenerState {
    ListenerState::Listening {
        address: format!("127.0.0.1:{port}"),
    }
}

#[tokio::test]
async fn with_nothing_saved_the_port_is_the_default_and_nothing_is_bound_yet() {
    let endpoint = endpoint(settings_path("default"), None).await;

    let status = endpoint.status().await;

    assert_eq!(status.listener, ListenerState::Starting);
    assert_eq!(status.port, DEFAULT_PORT);
    assert_eq!(status.configured_port, DEFAULT_PORT);
    assert_eq!(status.env_override, None);
}

#[tokio::test]
async fn setting_a_port_saves_it_and_listens_there() {
    let settings = settings_path("listens");
    let endpoint = endpoint(settings.clone(), None).await;
    let port = free_port();

    let status = endpoint.set_port(port).await.expect("set the port");

    assert_eq!(status.listener, listening_on(port));
    assert_eq!(status.port, port);
    assert_eq!(status.configured_port, port);
    assert_eq!(endpoint.status().await, status, "the status is remembered");
    assert!(accepts(port), "something answers on the port");
    assert_eq!(read_port_setting(&settings), Some(port), "and it is saved");
}

#[tokio::test]
async fn changing_the_port_moves_the_listener_without_a_restart_of_the_app() {
    let settings = settings_path("moves");
    let endpoint = endpoint(settings.clone(), None).await;
    let first = free_port();
    endpoint.set_port(first).await.expect("set the first port");
    let second = free_port();

    let status = endpoint
        .set_port(second)
        .await
        .expect("set the second port");

    assert_eq!(status.listener, listening_on(second));
    assert!(accepts(second), "the new port answers");
    assert!(!accepts(first), "the old port was let go");
    let reopened = McpEndpoint::new(
        helpers::session_factory(&helpers::test_pool().await),
        board::silent(),
        settings,
        None,
    );
    assert_eq!(
        reopened.status().await.port,
        second,
        "the next start uses the saved port"
    );
}

#[tokio::test]
async fn a_port_already_taken_is_reported_with_the_reason_and_a_restart_binds_once_it_is_free() {
    let settings = settings_path("taken");
    let holder = TcpListener::bind("127.0.0.1:0").expect("take a port");
    let port = holder.local_addr().expect("the taken port").port();
    let endpoint = endpoint(settings, None).await;

    let failed = endpoint.set_port(port).await.expect("the setting is saved");

    let ListenerState::Failed { reason } = &failed.listener else {
        panic!("expected a failure, got {:?}", failed.listener);
    };
    assert!(!reason.is_empty(), "the failure says why");
    assert_eq!(failed.port, port);
    assert_eq!(
        endpoint.status().await.listener,
        failed.listener,
        "the failure stays visible"
    );

    drop(holder);
    let restarted = endpoint.restart().await;

    assert_eq!(restarted.listener, listening_on(port));
    assert!(accepts(port));
}

#[tokio::test]
async fn restarting_a_listening_endpoint_binds_the_same_port_again() {
    let endpoint = endpoint(settings_path("rebind"), None).await;
    let port = free_port();
    endpoint.set_port(port).await.expect("set the port");

    let restarted = endpoint.restart().await;

    assert_eq!(restarted.listener, listening_on(port));
    assert!(accepts(port));
}

#[tokio::test]
async fn the_environment_override_wins_over_the_setting_and_says_so() {
    let settings = settings_path("override");
    let overriding = free_port();
    let endpoint = endpoint(settings.clone(), Some(overriding)).await;
    let chosen = free_port();

    let status = endpoint.set_port(chosen).await.expect("set the port");

    assert_eq!(status.listener, listening_on(overriding));
    assert_eq!(status.port, overriding);
    assert_eq!(status.configured_port, chosen, "the setting is still saved");
    assert_eq!(status.env_override, Some(overriding));
    assert_eq!(read_port_setting(&settings), Some(chosen));
}

#[tokio::test]
async fn port_zero_is_refused_and_nothing_is_saved() {
    let settings = settings_path("zero");
    let endpoint = endpoint(settings.clone(), None).await;

    let refused = endpoint.set_port(0).await;

    assert!(matches!(refused, Err(EndpointError::InvalidPort)));
    assert_eq!(read_port_setting(&settings), None);
}

#[test]
fn an_unreadable_settings_file_reads_as_no_choice() {
    let settings = settings_path("unreadable");
    std::fs::write(&settings, "not json").expect("write the settings");

    assert_eq!(read_port_setting(&settings), None);
}
