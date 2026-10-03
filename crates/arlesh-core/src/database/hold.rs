//! The app's hold on its database: a lock file beside it, held while the desktop app runs.
//!
//! The desktop app is not the only writer any more — the Python bindings can open the same file.
//! SQLite keeps two writers from corrupting it, but not from confusing each other: the app's
//! windows would show a board a script has since changed, and its Undo Stack would hold Gestures
//! whose rows have moved underneath them. So the app marks the database as **held** while it runs,
//! and another writer that finds it held is refused unless it insists (`force`). Reading is never
//! refused.
//!
//! The mark is an operating-system file lock on `<database>.lock`, not the file's existence. A
//! lock dies with its process, so a crash never leaves a stale mark behind that would refuse every
//! writer until someone deleted it by hand; the file itself is left in place and means nothing on
//! its own.
//!
//! This is advisory and checked once, at open. A writer that opened while the app was closed is
//! not stopped by the app starting later — the guard is about not surprising the person at the
//! desktop, not about a lock SQLite does not need.

use std::fs::{File, OpenOptions, TryLockError};
use std::io;
use std::path::{Path, PathBuf};

/// The lock file's path for the database at `database`: the same name with `.lock` appended.
pub fn lock_path(database: &Path) -> PathBuf {
    let mut name = database.as_os_str().to_owned();
    name.push(".lock");
    PathBuf::from(name)
}

/// The desktop app's hold on its database, released when dropped (or when the process ends).
#[derive(Debug)]
pub struct AppHold {
    /// The open lock file. Holding it open is what holds the lock.
    _file: File,
}

/// Why the app could not take its hold.
#[derive(Debug, thiserror::Error)]
pub enum HoldError {
    /// Another process already holds the database — a second app on the same data directory.
    #[error("another process already holds {0}")]
    Taken(PathBuf),
    /// The lock file could not be opened or locked.
    #[error("could not lock {path}: {source}")]
    Io {
        /// The lock file.
        path: PathBuf,
        /// What the operating system said.
        source: io::Error,
    },
}

impl AppHold {
    /// Takes the hold on the database at `database`, creating its lock file if needed.
    ///
    /// Never waits: a hold another process has is [`HoldError::Taken`] at once.
    pub fn acquire(database: &Path) -> Result<Self, HoldError> {
        let path = lock_path(database);
        let file = open_lock_file(&path)?;
        match file.try_lock() {
            Ok(()) => Ok(Self { _file: file }),
            Err(TryLockError::WouldBlock) => Err(HoldError::Taken(path)),
            Err(TryLockError::Error(source)) => Err(HoldError::Io { path, source }),
        }
    }
}

/// Whether some process — the desktop app — holds the database at `database` right now.
///
/// No lock file means nobody has ever held it. The probe takes a shared lock and drops it at
/// once, so two probes never refuse each other, and a probe never blocks the app from taking its
/// hold for longer than the probe itself.
pub fn is_held(database: &Path) -> Result<bool, HoldError> {
    let path = lock_path(database);
    if !path.exists() {
        return Ok(false);
    }
    let file = File::open(&path).map_err(|source| HoldError::Io {
        path: path.clone(),
        source,
    })?;
    match file.try_lock_shared() {
        Ok(()) => Ok(false),
        Err(TryLockError::WouldBlock) => Ok(true),
        Err(TryLockError::Error(source)) => Err(HoldError::Io { path, source }),
    }
}

/// Opens (creating if needed) the lock file at `path`, for locking. It is never written.
fn open_lock_file(path: &Path) -> Result<File, HoldError> {
    OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(path)
        .map_err(|source| HoldError::Io {
            path: path.to_path_buf(),
            source,
        })
}

#[cfg(test)]
mod tests;
