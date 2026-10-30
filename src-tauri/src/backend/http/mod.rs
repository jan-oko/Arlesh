//! [`HttpBackend`]: the [`Backend`](super::Backend) port served by `arlesh-server` over HTTP —
//! Client mode (see `docs/spec/client-mode.md`).
//!
//! Every method is one REST call, as `conformance/client-mode.json` lists it. What this module adds
//! around the calls is what makes a remote board usable:
//!
//! - **Reachability.** A call that cannot reach the server marks it unreachable. The board last
//!   loaded is then served from memory, read-only, and every write is refused with
//!   `details.reason = "server_unreachable"`; nothing is queued. The next call that gets through,
//!   or the change stream reconnecting ([`events`]), marks it reachable again.
//! - **The version handshake.** `/health` answers the server's `api_version`. While it differs
//!   from [`API_VERSION`], every write is refused, naming the side to update.
//! - **Errors.** The server's error body is the core's own [`WireError`], read back as one, so the
//!   frontend handles a refusal from the server exactly as it handles one from the local core.
//!
//! Status changes reach the windows through [`StatusNotify`], which the shell wires to an event.

use std::sync::{Arc, Mutex};

use chrono::NaiveDateTime;
use reqwest::Method;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::json;

use crate::{
    error::{WireError, WireErrorKind},
    mindmap::model::MindmapLoad,
};

mod access;
mod block_reasons;
mod capacity;
mod commitments;
mod domains;
pub mod events;
mod expectations;
mod flows;
mod gestures;
mod infos;
mod knowledge_base;
mod mindmap;
mod node_gestures;
mod tasks;
mod undo;

/// The HTTP API version this app speaks: the integer `/health` answers. Pinned to the server's by
/// `conformance/client-mode.json`.
pub const API_VERSION: u32 = 1;

/// How long a call waits for the server before it counts as unreachable.
const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// Why writes are refused right now, when they are.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadOnlyReason {
    /// The server cannot be reached; the board shown is the last one loaded.
    ServerUnreachable,
    /// The server speaks a newer API than this app: update the app.
    UpdateApp,
    /// The server speaks an older API than this app: update the server.
    UpdateServer,
}

/// What the windows show about the server: the top bar's mode and reachability, and the banner.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ServerStatus {
    /// The server's URL.
    pub url: String,
    /// Whether the last call reached it.
    pub reachable: bool,
    /// When the board was last loaded from it.
    pub last_sync: Option<NaiveDateTime>,
    /// Why writes are refused, or `None` when they are allowed.
    pub read_only: Option<ReadOnlyReason>,
    /// The server's API version, once its `/health` has answered.
    pub server_api_version: Option<u32>,
}

/// Told the new [`ServerStatus`] whenever it changes.
pub type StatusNotify = Arc<dyn Fn(&ServerStatus) + Send + Sync>;

/// What `/health` answers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Health {
    /// The server's API version.
    pub api_version: u32,
    /// The `arlesh` package's version.
    pub version: String,
    /// The commit the server was built from.
    pub commit: String,
}

/// Where the server is and how to reach it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Connection {
    /// The server's base URL, without a trailing slash.
    pub url: String,
    /// The bearer token from `arlesh-server token add <device>`.
    pub token: String,
}

impl Connection {
    /// A connection to `url` with `token`; a trailing slash on the URL is dropped.
    pub fn new(url: impl Into<String>, token: impl Into<String>) -> Self {
        Self {
            url: url.into().trim_end_matches('/').to_owned(),
            token: token.into(),
        }
    }
}

/// What the backend knows about the server between calls.
struct Link {
    reachable: bool,
    last_sync: Option<NaiveDateTime>,
    server_api_version: Option<u32>,
    board: Option<MindmapLoad>,
}

/// The Backend port over `arlesh-server`.
pub struct HttpBackend {
    connection: Connection,
    http: reqwest::Client,
    link: Mutex<Link>,
    notify: StatusNotify,
    /// Gestures this device has open: the nesting depth the frontend's opens and closes keep.
    gestures: Mutex<u32>,
}

impl HttpBackend {
    /// A backend calling the server `connection` names, telling `notify` of each status change.
    /// It assumes the server reachable until a call says otherwise.
    pub fn new(connection: Connection, notify: StatusNotify) -> Result<Self, WireError> {
        // reqwest is built without a TLS provider of its own (see Cargo.toml); `ring` is it. A
        // provider already installed — by an earlier backend — is not an error.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let http = reqwest::Client::builder()
            .connect_timeout(TIMEOUT)
            .build()
            .map_err(|error| {
                WireError::internal(format!("could not build the HTTP client: {error}"))
            })?;
        Ok(Self {
            connection,
            http,
            link: Mutex::new(Link {
                reachable: true,
                last_sync: None,
                server_api_version: None,
                board: None,
            }),
            notify,
            gestures: Mutex::new(0),
        })
    }

    /// The server's URL and token.
    pub fn connection(&self) -> &Connection {
        &self.connection
    }

    /// The status as it stands.
    pub fn status(&self) -> ServerStatus {
        let link = self.lock();
        status_of(&self.connection, &link)
    }

    /// Asks `/health` which API the server speaks, and records it. A server that cannot be reached
    /// is recorded as unreachable.
    pub async fn check_health(&self) -> Result<Health, WireError> {
        let health: Health = self
            .send(Call::new(Method::GET, "/health".to_owned()))
            .await?;
        self.update(|link| link.server_api_version = Some(health.api_version));
        Ok(health)
    }

    /// Records that the server answered (or did not), telling the windows when that changes.
    pub fn set_reachable(&self, reachable: bool) {
        self.update(|link| link.reachable = reachable);
    }

    /// Runs `call` as a read.
    async fn read<T: DeserializeOwned>(&self, call: Call) -> Result<T, WireError> {
        self.send(call).await
    }

    /// Runs `call` as a write: refused at once, writing nothing, while the board is read-only.
    async fn write<T: DeserializeOwned>(&self, call: Call) -> Result<T, WireError> {
        if let Some(reason) = self.status().read_only {
            return Err(read_only_error(reason));
        }
        self.send(call).await
    }

    /// Loads the board, remembering it; when the server cannot be reached, answers the board last
    /// loaded instead, which the windows show read-only.
    async fn load_board(&self, call: Call) -> Result<MindmapLoad, WireError> {
        match self.send::<MindmapLoad>(call).await {
            Ok(board) => {
                let now = device_now();
                self.update(|link| {
                    link.board = Some(board.clone());
                    link.last_sync = Some(now);
                });
                Ok(board)
            }
            Err(error) if is_unreachable(&error) => {
                let cached = self.lock().board.clone();
                cached.ok_or(error)
            }
            Err(error) => Err(error),
        }
    }

    /// Sends `call` and reads its answer, keeping reachability up to date.
    async fn send<T: DeserializeOwned>(&self, call: Call) -> Result<T, WireError> {
        let url = format!("{}{}", self.connection.url, call.path);
        let mut request = self
            .http
            .request(call.method, url)
            .bearer_auth(&self.connection.token)
            .timeout(TIMEOUT)
            .query(&call.query);
        if let Some(body) = call.body {
            request = request.json(&body);
        }
        let response = match request.send().await {
            Ok(response) => response,
            Err(error) => {
                tracing::warn!(error = %error, "the server could not be reached");
                self.set_reachable(false);
                return Err(unreachable_error());
            }
        };
        self.set_reachable(true);
        let status = response.status();
        let bytes = response.bytes().await.map_err(|error| {
            WireError::internal(format!("could not read the server's answer: {error}"))
        })?;
        if !status.is_success() {
            return Err(
                serde_json::from_slice::<WireError>(&bytes).unwrap_or_else(|_| {
                    WireError::internal(format!("the server answered {status} with no error body"))
                }),
            );
        }
        let text: &[u8] = if bytes.is_empty() { b"null" } else { &bytes };
        serde_json::from_slice(text).map_err(|error| {
            WireError::internal(format!("could not read the server's answer: {error}"))
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Link> {
        // A poisoned lock only means a panic elsewhere mid-update; the fields are still whole.
        self.link
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn update(&self, change: impl FnOnce(&mut Link)) {
        let (before, after) = {
            let mut link = self.lock();
            let before = status_of(&self.connection, &link);
            change(&mut link);
            (before, status_of(&self.connection, &link))
        };
        if before != after {
            (self.notify)(&after);
        }
    }
}

fn status_of(connection: &Connection, link: &Link) -> ServerStatus {
    let read_only = if !link.reachable {
        Some(ReadOnlyReason::ServerUnreachable)
    } else {
        link.server_api_version.and_then(compatibility)
    };
    ServerStatus {
        url: connection.url.clone(),
        reachable: link.reachable,
        last_sync: link.last_sync,
        read_only,
        server_api_version: link.server_api_version,
    }
}

/// Whether a server speaking `server` may be written to by this app, and if not, which side to
/// update.
pub fn compatibility(server: u32) -> Option<ReadOnlyReason> {
    match server.cmp(&API_VERSION) {
        std::cmp::Ordering::Equal => None,
        std::cmp::Ordering::Greater => Some(ReadOnlyReason::UpdateApp),
        std::cmp::Ordering::Less => Some(ReadOnlyReason::UpdateServer),
    }
}

/// The refusal of a write while the board is read-only.
pub fn read_only_error(reason: ReadOnlyReason) -> WireError {
    let message = match reason {
        ReadOnlyReason::ServerUnreachable => {
            "the server cannot be reached, so the board is read-only"
        }
        ReadOnlyReason::UpdateApp => "the server is newer than this app: update the app to edit",
        ReadOnlyReason::UpdateServer => {
            "the server is older than this app: update the server to edit"
        }
    };
    WireError::new(
        WireErrorKind::NotPermitted,
        message,
        Some(json!({ "reason": reason })),
    )
}

fn unreachable_error() -> WireError {
    read_only_error(ReadOnlyReason::ServerUnreachable)
}

fn is_unreachable(error: &WireError) -> bool {
    error.details().and_then(|details| details.get("reason"))
        == Some(&json!(ReadOnlyReason::ServerUnreachable))
}

/// The refusal of an operation Client mode does not offer.
pub fn not_in_client_mode(what: &str) -> WireError {
    WireError::new(
        WireErrorKind::NotPermitted,
        format!("{what} is not available in Client mode"),
        Some(json!({ "reason": "not_in_client_mode" })),
    )
}

/// The device's wall clock, as the app reads it in Standalone mode too: a read that derives the
/// board at an instant is sent this, so a server in another time zone answers for the user's day.
fn device_now() -> NaiveDateTime {
    chrono::Local::now().naive_local()
}

/// `value` as a path segment or query value: its JSON form, a string's without its quotes.
fn text(value: &impl Serialize) -> String {
    match serde_json::to_value(value) {
        Ok(serde_json::Value::String(text)) => text,
        Ok(other) => other.to_string(),
        Err(_) => String::new(),
    }
}

/// `value` as a path segment.
fn segment(value: &impl Serialize) -> String {
    text(value)
}

/// One REST call, as it is built.
struct Call {
    method: Method,
    path: String,
    query: Vec<(&'static str, String)>,
    body: Option<serde_json::Value>,
}

impl Call {
    fn new(method: Method, path: String) -> Self {
        Self {
            method,
            path,
            query: Vec::new(),
            body: None,
        }
    }

    fn query(mut self, key: &'static str, value: &impl Serialize) -> Self {
        self.query.push((key, text(value)));
        self
    }

    fn query_opt<T: Serialize>(self, key: &'static str, value: Option<&T>) -> Self {
        match value {
            Some(value) => self.query(key, value),
            None => self,
        }
    }

    fn json(mut self, body: &impl Serialize) -> Self {
        self.body = serde_json::to_value(body).ok();
        self
    }
}

#[cfg(test)]
mod tests;
