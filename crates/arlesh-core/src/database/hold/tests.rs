use super::*;

/// A database path in a directory of its own, so tests never see each other's lock files.
fn scratch_database(name: &str) -> PathBuf {
    let directory = std::env::temp_dir().join(format!(
        "arlesh-hold-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&directory).unwrap();
    directory.join("arlesh.db")
}

#[test]
fn the_lock_file_sits_beside_the_database() {
    assert_eq!(
        lock_path(Path::new("/data/arlesh.db")),
        PathBuf::from("/data/arlesh.db.lock")
    );
}

#[test]
fn a_database_nobody_ever_held_is_not_held() {
    let database = scratch_database("never");
    assert!(!is_held(&database).unwrap());
}

#[test]
fn a_database_is_held_while_the_hold_lives_and_free_once_it_drops() {
    let database = scratch_database("lives");
    let hold = AppHold::acquire(&database).unwrap();
    assert!(is_held(&database).unwrap());
    drop(hold);
    assert!(!is_held(&database).unwrap());
    // The file outlives the hold and means nothing on its own.
    assert!(lock_path(&database).exists());
}

#[test]
fn a_second_hold_on_a_held_database_is_refused() {
    let database = scratch_database("second");
    let _first = AppHold::acquire(&database).unwrap();
    assert!(matches!(
        AppHold::acquire(&database),
        Err(HoldError::Taken(path)) if path == lock_path(&database)
    ));
}

#[test]
fn a_hold_in_a_missing_directory_is_an_io_error() {
    let database = scratch_database("missing")
        .join("nowhere")
        .join("arlesh.db");
    assert!(matches!(
        AppHold::acquire(&database),
        Err(HoldError::Io { .. })
    ));
}
