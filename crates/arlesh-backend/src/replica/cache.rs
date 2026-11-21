//! The board last seen, kept on disk so the app can show it at once on the next start (ADR 0017,
//! decision 8).
//!
//! The file holds the device snapshot's JSON, exactly the body the server serves, so loading it is
//! the same code as fetching a board. It is written when the first board of a run arrives and when
//! the app quits normally (a suspend counts as quitting on Android), never in between.

use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};

use arlesh_core::replication::rules::hash::row_digest;

/// Where the cached board lives.
pub trait CacheStore: Send + Sync {
    /// The cached snapshot body, if there is one.
    fn load(&self) -> Option<String>;
    /// Replaces the cached snapshot body, atomically: a crash mid-write leaves the old one.
    fn store(&self, body: &str) -> std::io::Result<()>;
}

/// A cache of boards, shared.
pub type SharedCache = Arc<dyn CacheStore>;

/// The cache in a file under the app's data directory, one per server.
pub struct FileCache {
    path: PathBuf,
}

impl FileCache {
    /// The cache of the server at `url`: `<directory>/replica/<16 hex digits of the url>.json`.
    pub fn for_server(directory: &Path, url: &str) -> Self {
        let name = format!("{:016x}.json", row_digest("replica-cache", 0, url));
        Self {
            path: directory.join("replica").join(name),
        }
    }
}

impl CacheStore for FileCache {
    fn load(&self) -> Option<String> {
        std::fs::read_to_string(&self.path).ok()
    }

    fn store(&self, body: &str) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let temporary = self.path.with_extension("json.tmp");
        let mut file = std::fs::File::create(&temporary)?;
        file.write_all(body.as_bytes())?;
        file.sync_all()?;
        std::fs::rename(&temporary, &self.path)
    }
}

#[cfg(test)]
mod tests {
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
}
