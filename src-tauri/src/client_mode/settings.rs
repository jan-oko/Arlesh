//! The mode setting: `mode.json` in the app's data directory.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// The file in the app's data directory that holds the mode.
pub const MODE_FILE: &str = "mode.json";

/// How the app reaches the board on this device.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum Mode {
    /// The local database file, as the app has always run.
    Standalone,
    /// A client of the `arlesh-server` at `url`.
    Client {
        /// The server's base URL.
        url: String,
        /// Whether the user agreed to keep the token in a file, because no keychain was available.
        #[serde(default)]
        token_in_file: bool,
    },
}

/// What the saved setting, or its absence, means at startup.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Startup {
    /// The mode to run in.
    pub mode: Mode,
    /// Whether to ask the first-run question: there is no setting and no board on this device
    /// yet. Meanwhile the app runs Standalone, which is what *This device only* would choose.
    pub first_run: bool,
}

/// How to start, given the saved mode (if any) and whether a local database already exists.
///
/// A device that already has a database and no setting is an install from before Client mode
/// existed: it is Standalone, and nobody is asked.
pub fn startup(saved: Option<Mode>, database_exists: bool) -> Startup {
    match saved {
        Some(mode) => Startup {
            mode,
            first_run: false,
        },
        None => Startup {
            mode: Mode::Standalone,
            first_run: !database_exists,
        },
    }
}

/// The setting saved in `app_dir`, or `None` when there is none or it cannot be read.
pub fn read(app_dir: &Path) -> Option<Mode> {
    let text = std::fs::read_to_string(path(app_dir)).ok()?;
    match serde_json::from_str(&text) {
        Ok(mode) => Some(mode),
        Err(error) => {
            tracing::warn!(error = %error, "could not read the mode setting");
            None
        }
    }
}

/// Saves `mode` in `app_dir`.
pub fn write(app_dir: &Path, mode: &Mode) -> std::io::Result<()> {
    let text = serde_json::to_string_pretty(mode).map_err(std::io::Error::other)?;
    std::fs::write(path(app_dir), text)
}

fn path(app_dir: &Path) -> PathBuf {
    app_dir.join(MODE_FILE)
}

#[cfg(test)]
mod tests;
