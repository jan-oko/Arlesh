//! A box build's pre-bound connection: the server URL and token `npm run box` hands a branch's
//! Android build so it starts already connected, without the PIN flow. See
//! `docs/spec/client-mode.md` ("Trying it: branch instances").
//!
//! The hand-over is a file, `box-provision.json`, in the app's data directory. Only
//! `MainActivity` writes it, and only when the running applicationId starts with
//! `com.atai.arlesh.box.`, from the `arlesh_box_url` and `arlesh_box_token` intent extras, so the
//! release app never has one. The startup reads it before it reads the mode, stores the token
//! as *Connect and Restart* does, saves the Client mode and deletes the file: the first run
//! already comes up connected, and no restart is needed.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use super::{
    settings::{self, Mode},
    vault,
};

/// The file `MainActivity` leaves in the app's data directory.
pub const PROVISION_FILE: &str = "box-provision.json";

/// What the file holds, checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Provision {
    /// The server's base URL, without a trailing slash.
    pub url: String,
    /// The device's token.
    pub token: String,
}

/// A provision that cannot be used.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ProvisionError {
    /// The file is not the JSON object `MainActivity` writes.
    #[error("the provision is not valid JSON: {0}")]
    Malformed(String),
    /// The URL is not an `http://` or `https://` address with a host.
    #[error("the provisioned URL is not an http(s) address")]
    BadUrl,
    /// The token is empty.
    #[error("the provisioned token is empty")]
    EmptyToken,
}

#[derive(Deserialize)]
struct Raw {
    url: String,
    token: String,
}

/// Reads and checks the text of a provision file.
pub fn parse(text: &str) -> Result<Provision, ProvisionError> {
    let raw: Raw =
        serde_json::from_str(text).map_err(|error| ProvisionError::Malformed(error.to_string()))?;
    let url = raw.url.trim().trim_end_matches('/');
    let host = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))
        .unwrap_or("");
    if host.is_empty() || host.starts_with('/') || host.chars().any(char::is_whitespace) {
        return Err(ProvisionError::BadUrl);
    }
    let token = raw.token.trim();
    if token.is_empty() {
        return Err(ProvisionError::EmptyToken);
    }
    Ok(Provision {
        url: url.to_owned(),
        token: token.to_owned(),
    })
}

fn path(app_dir: &Path) -> PathBuf {
    app_dir.join(PROVISION_FILE)
}

/// Applies a provision left in `app_dir`, if there is one: keeps its token, saves Client mode
/// against its URL and deletes the file, used or not (a bad one is not retried). Nothing is
/// logged of the token. Does nothing when there is no file.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub fn apply(app_dir: &Path) {
    let file = path(app_dir);
    let Ok(text) = std::fs::read_to_string(&file) else {
        return;
    };
    if let Err(error) = std::fs::remove_file(&file) {
        tracing::warn!(error = %error, "could not delete the box provision");
    }
    let provision = match parse(&text) {
        Ok(provision) => provision,
        Err(error) => {
            tracing::warn!(error = %error, "ignoring the box provision");
            return;
        }
    };
    if let Err(error) = vault::store(app_dir, &provision.url, &provision.token, true) {
        tracing::warn!(error = %error, "could not keep the provisioned token");
        return;
    }
    let mode = Mode::Client {
        url: provision.url,
        token_in_file: true,
    };
    if let Err(error) = settings::write(app_dir, &mode) {
        tracing::warn!(error = %error, "could not save the provisioned mode");
    }
}

#[cfg(test)]
mod tests;
