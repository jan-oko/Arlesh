use std::sync::Mutex as StdMutex;

use super::*;

/// A fresh directory of this test's own, with the lock's path inside it.
fn lock_path(test: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("arlesh-capacity-{}-{test}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir.join(CAPACITY_FILE)
}

fn silent() -> Notify {
    Arc::new(|_| {})
}

#[tokio::test]
async fn with_no_file_the_lock_is_off() {
    let capacity = AgentCapacity::open(lock_path("no-file"), silent());
    assert!(!capacity.get().await.at_capacity);
}

#[tokio::test]
async fn a_set_lock_survives_a_reopen() {
    let path = lock_path("reopen");
    let capacity = AgentCapacity::open(path.clone(), silent());

    capacity.set(true).await.unwrap();

    assert!(capacity.get().await.at_capacity);
    let reopened = AgentCapacity::open(path, silent());
    assert!(
        reopened.get().await.at_capacity,
        "the lock is read back from the file"
    );
}

#[tokio::test]
async fn clearing_the_lock_is_saved_too() {
    let path = lock_path("clear");
    let capacity = AgentCapacity::open(path.clone(), silent());
    capacity.set(true).await.unwrap();

    capacity.set(false).await.unwrap();

    assert!(!AgentCapacity::open(path, silent()).get().await.at_capacity);
}

#[tokio::test]
async fn an_unreadable_file_reads_as_off() {
    let path = lock_path("garbage");
    std::fs::write(&path, "not json").unwrap();

    assert!(!AgentCapacity::open(path, silent()).get().await.at_capacity);
}

#[tokio::test]
async fn every_set_tells_the_windows_the_new_state() {
    let heard: Arc<StdMutex<Vec<bool>>> = Arc::default();
    let sink = heard.clone();
    let capacity = AgentCapacity::open(
        lock_path("notify"),
        Arc::new(move |state: CapacityState| sink.lock().unwrap().push(state.at_capacity)),
    );

    capacity.set(true).await.unwrap();
    capacity.set(true).await.unwrap();
    capacity.set(false).await.unwrap();

    assert_eq!(*heard.lock().unwrap(), vec![true, true, false]);
}

#[tokio::test]
async fn a_save_that_fails_keeps_the_old_value_and_tells_nobody() {
    let heard: Arc<StdMutex<Vec<bool>>> = Arc::default();
    let sink = heard.clone();
    // A path whose parent is a file cannot be written.
    let blocker = lock_path("unwritable");
    std::fs::write(&blocker, "").unwrap();
    let capacity = AgentCapacity::open(
        blocker.join("inside"),
        Arc::new(move |state: CapacityState| sink.lock().unwrap().push(state.at_capacity)),
    );

    assert!(capacity.set(true).await.is_err());

    assert!(!capacity.get().await.at_capacity);
    assert!(heard.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_in_memory_lock_starts_off_and_holds_what_is_set() {
    let capacity = AgentCapacity::in_memory();
    assert!(!capacity.get().await.at_capacity);

    capacity.set(true).await.unwrap();

    assert!(capacity.get().await.at_capacity);
}

#[test]
fn the_state_is_spelled_at_capacity_on_the_wire() {
    let json = serde_json::to_value(CapacityState { at_capacity: true }).unwrap();
    assert_eq!(json, serde_json::json!({ "at_capacity": true }));
}
