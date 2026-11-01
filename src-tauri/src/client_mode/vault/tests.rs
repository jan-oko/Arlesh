use super::*;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("arlesh-vault-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("a scratch directory");
    dir
}

#[test]
fn a_token_in_the_file_reads_back() {
    let dir = scratch("roundtrip");

    store(&dir, "https://box", "secret", true).expect("stored");

    assert_eq!(
        load(&dir, "https://box", true).expect("read"),
        Some("secret".to_owned())
    );
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn no_file_is_no_token() {
    let dir = scratch("missing");

    assert_eq!(load(&dir, "https://box", true).expect("read"), None);
    std::fs::remove_dir_all(&dir).ok();
}

#[cfg(unix)]
#[test]
fn the_file_is_its_owners_alone() {
    use std::os::unix::fs::PermissionsExt;
    let dir = scratch("mode");

    store(&dir, "https://box", "secret", true).expect("stored");

    let mode = std::fs::metadata(dir.join(TOKEN_FILE))
        .expect("the file")
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
    std::fs::remove_dir_all(&dir).ok();
}
