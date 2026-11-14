//! Standalone's publishing: a Gesture that wrote moves the fence and reaches the sink as changed
//! nodes, and one that only read moves nothing.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use arlesh_core::{database::session::SessionFactory, mindmap::publisher::ChangeEvent};

use super::SqliteBackend;
use crate::mindmap::BoardPort;
use crate::tasks::TasksPort;
use crate::undo::UndoPort;

struct Rig {
    backend: SqliteBackend,
    heard: Arc<Mutex<Vec<ChangeEvent>>>,
    file: std::path::PathBuf,
}

impl Drop for Rig {
    fn drop(&mut self) {
        for suffix in ["", "-wal", "-shm"] {
            let mut path = self.file.clone().into_os_string();
            path.push(suffix);
            let _ = std::fs::remove_file(path);
        }
    }
}

async fn rig() -> Rig {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.as_nanos());
    let file =
        std::env::temp_dir().join(format!("arlesh-backend-{}-{nanos}.db", std::process::id()));
    let pool = arlesh_core::database::connect(&format!("sqlite://{}?mode=rwc", file.display()))
        .await
        .expect("a pool");
    arlesh_core::database::run_migrations(&pool)
        .await
        .expect("migrations");
    let heard: Arc<Mutex<Vec<ChangeEvent>>> = Arc::default();
    let sink = Arc::clone(&heard);
    let backend = SqliteBackend::new(
        SessionFactory::new(pool),
        arlesh_core::undo::stacks::UndoStacks::new(),
        Arc::new(move |event: &ChangeEvent| sink.lock().unwrap().push(event.clone())),
        &tokio::runtime::Handle::current(),
    );
    Rig {
        backend,
        heard,
        file,
    }
}

fn task(title: &str) -> arlesh_core::tasks::model::CreateTaskRequest {
    serde_json::from_value(serde_json::json!({
        "title": title, "parent_type": "domain", "parent_id": 1
    }))
    .expect("a request")
}

async fn heard_within(rig: &Rig, count: usize) -> Vec<ChangeEvent> {
    for _ in 0..200 {
        if rig.heard.lock().unwrap().len() >= count {
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    rig.heard.lock().unwrap().clone()
}

#[tokio::test]
async fn a_gesture_that_wrote_moves_the_fence_by_one_and_the_sink_hears_the_task() {
    let rig = rig().await;
    rig.backend
        .current_board()
        .await
        .expect("the first publication");
    let before = rig.backend.board_fence().await.expect("a fence");

    rig.backend.open_gesture().await.expect("open");
    rig.backend
        .create_task(task("Written"))
        .await
        .expect("a write");
    let closed = rig.backend.close_gesture().await.expect("close");
    let events = heard_within(&rig, 1).await;

    assert!(closed.wrote);
    let after = rig.backend.board_fence().await.expect("a fence");
    assert_eq!(
        (after.epoch.as_str(), after.revision),
        (before.epoch.as_str(), before.revision + 1)
    );
    assert_eq!(events.len(), 1);
    let event: serde_json::Value = serde_json::from_str(&events[0].data).expect("JSON");
    assert_eq!(event["revision"], 1);
    assert_eq!(
        event["changes"]["tasks"]["set"][0][1]["title"], "Written",
        "{event}"
    );
}

#[tokio::test]
async fn a_gesture_that_only_read_moves_nothing() {
    let rig = rig().await;
    let before = rig.backend.board_fence().await;
    rig.backend
        .current_board()
        .await
        .expect("the first publication");

    rig.backend.open_gesture().await.expect("open");
    let closed = rig.backend.close_gesture().await.expect("close");
    tokio::time::sleep(Duration::from_millis(300)).await;

    assert!(!closed.wrote);
    assert_eq!(rig.backend.board_fence().await, before);
    assert!(rig.heard.lock().unwrap().is_empty());
}

#[tokio::test]
async fn undo_of_a_write_is_a_write_the_windows_hear_of() {
    let rig = rig().await;
    rig.backend
        .current_board()
        .await
        .expect("the first publication");
    rig.backend.open_gesture().await.expect("open");
    rig.backend
        .create_task(task("Undone"))
        .await
        .expect("a write");
    rig.backend.close_gesture().await.expect("close");
    heard_within(&rig, 1).await;

    let undone = rig.backend.undo().await.expect("undo");
    let events = heard_within(&rig, 2).await;

    assert!(undone.is_some());
    let event: serde_json::Value = serde_json::from_str(&events[1].data).expect("JSON");
    assert_eq!(
        event["changes"]["tasks"]["del"].as_array().map(Vec::len),
        Some(1)
    );
}

#[tokio::test]
async fn the_current_board_is_the_publication_the_head_names() {
    let rig = rig().await;

    let current = rig.backend.current_board().await.expect("a board");
    let head = rig.backend.board_head().await.expect("a head");

    assert_eq!(current.seq, Some(head.seq));
    assert_eq!(current.hash, Some(head.hash));
    assert!(current.load.get().starts_with('{'));
}
