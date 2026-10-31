use std::sync::atomic::{AtomicUsize, Ordering};

use super::*;

fn counting() -> (StatusNotify, Arc<AtomicUsize>) {
    let count = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&count);
    let notify: StatusNotify = Arc::new(move |_| {
        counted.fetch_add(1, Ordering::SeqCst);
    });
    (notify, count)
}

/// A backend pointed at a port nothing listens on, so every call fails to connect at once.
fn nowhere() -> (HttpBackend, Arc<AtomicUsize>) {
    let (notify, count) = counting();
    let backend = HttpBackend::new(Connection::new("http://127.0.0.1:9/", "token"), notify)
        .expect("a client builds");
    (backend, count)
}

#[test]
fn a_trailing_slash_is_dropped_from_the_url() {
    assert_eq!(
        Connection::new("https://box:4750/", "t").url,
        "https://box:4750"
    );
}

#[test]
fn the_side_to_update_is_the_one_behind() {
    assert_eq!(compatibility(API_VERSION), None);
    assert_eq!(
        compatibility(API_VERSION + 1),
        Some(ReadOnlyReason::UpdateApp)
    );
    assert_eq!(
        compatibility(API_VERSION - 1),
        Some(ReadOnlyReason::UpdateServer)
    );
}

#[test]
fn a_query_value_is_its_json_without_quotes() {
    assert_eq!(text(&"task"), "task");
    assert_eq!(text(&42), "42");
    assert_eq!(text(&true), "true");
}

#[test]
fn a_refused_write_names_its_reason() {
    let error = read_only_error(ReadOnlyReason::UpdateServer);

    assert_eq!(error.kind(), WireErrorKind::NotPermitted);
    assert_eq!(error.details(), Some(&json!({ "reason": "update_server" })));
}

#[test]
fn a_new_backend_is_writable_until_told_otherwise() {
    let (backend, _) = nowhere();

    assert_eq!(backend.status().read_only, None);
    assert!(backend.status().reachable);
}

#[tokio::test]
async fn an_unreachable_server_makes_the_board_read_only_and_says_so_once() {
    let (backend, notified) = nowhere();

    let read = backend
        .read::<serde_json::Value>(Call::new(Method::GET, "/board".to_owned()))
        .await;
    let again = backend
        .read::<serde_json::Value>(Call::new(Method::GET, "/board".to_owned()))
        .await;

    assert!(read.as_ref().is_err_and(is_unreachable));
    assert!(again.is_err());
    assert_eq!(
        backend.status().read_only,
        Some(ReadOnlyReason::ServerUnreachable)
    );
    assert_eq!(
        notified.load(Ordering::SeqCst),
        1,
        "told once, on the change"
    );
}

#[tokio::test]
async fn a_write_while_unreachable_is_refused_without_a_call() {
    let (backend, _) = nowhere();
    backend.set_reachable(false);

    let refused = backend
        .write::<serde_json::Value>(Call::new(Method::POST, "/tasks".to_owned()))
        .await;

    assert!(refused.is_err_and(|error| is_unreachable(&error)));
}

#[tokio::test]
async fn a_write_to_a_newer_server_is_refused_naming_the_app() {
    let (backend, _) = nowhere();
    backend.update(|link| link.server_api_version = Some(API_VERSION + 1));

    let refused = backend
        .write::<serde_json::Value>(Call::new(Method::POST, "/tasks".to_owned()))
        .await;

    assert_eq!(
        refused.expect_err("refused").details(),
        Some(&json!({ "reason": "update_app" }))
    );
}

#[tokio::test]
async fn the_last_board_is_served_while_the_server_is_away() {
    let (backend, _) = nowhere();
    let board = MindmapLoad::default();
    backend.update(|link| link.board = Some(board.clone()));

    let served = backend
        .load_board(Call::new(Method::GET, "/board".to_owned()))
        .await;

    assert!(served.is_ok());
}

#[tokio::test]
async fn the_knowledge_base_is_refused_in_client_mode() {
    use crate::backend::knowledge_base::KnowledgeBasePort;
    let (backend, _) = nowhere();

    let refused = backend.list_people().await.expect_err("refused");

    assert_eq!(
        refused.details(),
        Some(&json!({ "reason": "not_in_client_mode" }))
    );
}

#[tokio::test]
async fn gestures_pair_up_on_the_device() {
    use crate::backend::undo::UndoPort;
    let (backend, _) = nowhere();

    backend.open_gesture().await.expect("open");
    backend.open_gesture().await.expect("join");
    backend.close_gesture().await.expect("close the inner");
    backend.close_gesture().await.expect("close the outer");

    assert!(backend.close_gesture().await.is_err(), "nothing is open");
}

#[tokio::test]
async fn a_gesture_operation_is_a_write_and_refused_while_the_server_is_away() {
    use crate::backend::node_gestures::NodeGesturesPort;
    use crate::nodes::gestures::GestureName;
    let (backend, _) = nowhere();
    backend.set_reachable(false);

    let refused = backend
        .run_gesture(GestureName::SaveTask, Vec::new())
        .await
        .expect_err("refused");

    assert!(is_unreachable(&refused));
}

#[test]
fn a_gesture_names_its_own_route() {
    use crate::nodes::gestures::GestureName;

    assert_eq!(segment(&GestureName::SaveFlowItem), "save-flow-item");
}
