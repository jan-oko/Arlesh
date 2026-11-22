use super::*;

fn directory(name: &str) -> PathBuf {
    let directory =
        std::env::temp_dir().join(format!("arlesh-cache-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&directory);
    directory
}

#[test]
fn a_stored_board_loads_back_and_a_new_one_replaces_it() {
    let directory = directory("roundtrip");
    let cache = FileCache::for_server(&directory, "https://a.example");
    assert_eq!(cache.load(), None, "nothing is cached at first");

    cache.store("{\"one\":1}").expect("stored");
    cache.store("{\"two\":2}").expect("replaced");

    assert_eq!(cache.load().as_deref(), Some("{\"two\":2}"));
    let _ = std::fs::remove_dir_all(&directory);
}

#[test]
fn each_server_has_its_own_file() {
    let directory = directory("servers");
    let first = FileCache::for_server(&directory, "https://a.example");
    let second = FileCache::for_server(&directory, "https://b.example");

    first.store("a").expect("stored");

    assert_eq!(second.load(), None);
    let _ = std::fs::remove_dir_all(&directory);
}
