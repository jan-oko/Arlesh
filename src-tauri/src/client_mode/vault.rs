//! Where a Client's token is kept: the OS keychain, through the `keyring` crate, or — only when
//! there is no keychain and the user agreed — a file in the app's data directory that only its
//! owner can read (mode 0600).

use std::path::{Path, PathBuf};

/// The keychain service the token is filed under; the account is the server's URL.
const SERVICE: &str = "arlesh";

/// The fallback file in the app's data directory.
pub const TOKEN_FILE: &str = "server-token";

/// A token could not be kept or read back.
#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    /// The keychain refused or is not there.
    #[error("the keychain could not be used: {0}")]
    Keychain(#[from] keyring::Error),
    /// The fallback file could not be written or read.
    #[error("the token file could not be used: {0}")]
    File(#[from] std::io::Error),
}

/// Whether a keychain is there to keep a token in: probed by reading an entry that need not
/// exist, since "no entry" is an answer and "no keychain" is an error.
pub fn keychain_available() -> bool {
    match keyring::Entry::new(SERVICE, "probe").and_then(|entry| entry.get_password()) {
        Ok(_) | Err(keyring::Error::NoEntry) => true,
        Err(error) => {
            tracing::warn!(error = %error, "no keychain available");
            false
        }
    }
}

/// Keeps `token` for the server at `url`: in the keychain, or in the file when `in_file`.
pub fn store(app_dir: &Path, url: &str, token: &str, in_file: bool) -> Result<(), VaultError> {
    if in_file {
        return write_private(&file(app_dir), token).map_err(VaultError::from);
    }
    keyring::Entry::new(SERVICE, url)?.set_password(token)?;
    Ok(())
}

/// The token kept for the server at `url`, or `None` when there is none.
pub fn load(app_dir: &Path, url: &str, in_file: bool) -> Result<Option<String>, VaultError> {
    if in_file {
        return match std::fs::read_to_string(file(app_dir)) {
            Ok(token) => Ok(Some(token.trim().to_owned())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        };
    }
    match keyring::Entry::new(SERVICE, url)?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn file(app_dir: &Path) -> PathBuf {
    app_dir.join(TOKEN_FILE)
}

/// Writes `text` to `path` readable and writable by its owner only.
fn write_private(path: &Path, text: &str) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut handle = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)?;
        handle.write_all(text.as_bytes())
    }
    #[cfg(not(unix))]
    {
        // Windows keeps a file in the user's profile private to them by its ACL.
        std::fs::write(path, text)
    }
}

#[cfg(test)]
mod tests;
