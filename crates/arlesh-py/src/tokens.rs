//! The server's bearer tokens and pending device pairings (migrations 0097 and 0098), reached **synchronously**: `arlesh-server`'s token store asks on
//! every request, from code that is not a coroutine, and its command line has no event loop.
//!
//! The tokens are in the database (migration 0097), so they go through the core — the same SQLite
//! library the server's other opens use. A second copy of SQLite in the process (Python's own
//! `sqlite3`) would not see this one's locks: POSIX locks belong to the process, so closing either
//! copy's file handle drops the other's, and the WAL is then corrupted under it.
//!
//! Each database file gets one write-open, made on first use and kept for the life of the process,
//! as the server keeps its own. It is opened past the hold check, since it is the server's own.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use arlesh_core::{
    database::session::SessionFactory,
    error::{WireError, WireErrorKind},
    server_pairing::model::PairingPin,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::Mutex;

use crate::errors::{Failure, Raised};

/// The client a token write-open writes as. It writes only the token table, which is not
/// journaled, so the name is never recorded.
const TOKEN_CLIENT: &str = "arlesh-server";

/// One token call: a JSON object whose `op` names it.
#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum Request {
    /// Records a client's token by its digest; answers whether it was recorded.
    Add {
        client: String,
        sha256: String,
        created_at: String,
    },
    /// Removes a client's token; answers whether it had one.
    Revoke { client: String },
    /// Every client holding a token.
    Issued,
    /// The client a digest belongs to, or `null`.
    ClientFor { sha256: String },
    /// Records that a client used its token; answers whether it holds one.
    Touch { client: String, seen_at: String },
    /// Records a pairing request; answers whether it was recorded.
    PairingCreate {
        id_sha256: String,
        pin: String,
        name: String,
        created_at: String,
        expires_at: String,
    },
    /// Every pairing request, oldest first.
    PairingAll,
    /// Deletes the requests that lapsed at or before `now`; answers how many.
    PairingPurge { now: String },
    /// Counts a wrong PIN against a request; answers the count, or `null` for no such request.
    PairingAttempt { id_sha256: String },
    /// Approves the pending request with a PIN under a name; answers whether there was one.
    PairingApprove { pin: String, name: String },
    /// Deletes a request; answers whether there was one.
    PairingDelete { id_sha256: String },
}

/// Runs one token call on the database at `path`, waiting for it.
pub(crate) fn run(path: &Path, request: &str) -> Result<String, Raised> {
    let request: Request = serde_json::from_str(request).map_err(|error| {
        Failure::new(
            WireErrorKind::InvalidRequest,
            format!("unreadable token request: {error}"),
        )
    })?;
    let runtime = pyo3_async_runtimes::tokio::get_runtime();
    let answer = runtime.block_on(async {
        let factory = factory_for(path).await?;
        dispatch(&factory, request).await.map_err(Raised::from)
    })?;
    Ok(answer.to_string())
}

async fn factory_for(path: &Path) -> Result<SessionFactory, Raised> {
    static OPENS: OnceLock<Mutex<HashMap<PathBuf, SessionFactory>>> = OnceLock::new();
    let key = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let mut opens = OPENS.get_or_init(Mutex::default).lock().await;
    if let Some(factory) = opens.get(&key) {
        return Ok(factory.clone());
    }
    let factory = crate::opening::open(path, Some(TOKEN_CLIENT), true).await?;
    opens.insert(key, factory.clone());
    Ok(factory)
}

async fn dispatch(factory: &SessionFactory, request: Request) -> Result<Value, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let answer = match request {
        Request::Add {
            client,
            sha256,
            created_at,
        } => json!(db
            .server_tokens()
            .add(&client, &sha256, &created_at)
            .await
            .map_err(WireError::from_error)?),
        Request::Revoke { client } => json!(db
            .server_tokens()
            .revoke(&client)
            .await
            .map_err(WireError::from_error)?),
        Request::Issued => json!(db
            .server_tokens()
            .issued()
            .await
            .map_err(WireError::from_error)?),
        Request::ClientFor { sha256 } => json!(db
            .server_tokens()
            .client_for(&sha256)
            .await
            .map_err(WireError::from_error)?),
        Request::Touch { client, seen_at } => json!(db
            .server_tokens()
            .touch(&client, &seen_at)
            .await
            .map_err(WireError::from_error)?),
        Request::PairingCreate {
            id_sha256,
            pin,
            name,
            created_at,
            expires_at,
        } => json!(db
            .pairing_pins()
            .create(&PairingPin {
                id_sha256,
                pin,
                name,
                approved_name: None,
                attempts: 0,
                created_at,
                expires_at,
            })
            .await
            .map_err(WireError::from_error)?),
        Request::PairingAll => json!(db
            .pairing_pins()
            .all()
            .await
            .map_err(WireError::from_error)?),
        Request::PairingPurge { now } => json!(db
            .pairing_pins()
            .purge_expired(&now)
            .await
            .map_err(WireError::from_error)?),
        Request::PairingAttempt { id_sha256 } => json!(db
            .pairing_pins()
            .count_attempt(&id_sha256)
            .await
            .map_err(WireError::from_error)?),
        Request::PairingApprove { pin, name } => json!(db
            .pairing_pins()
            .approve(&pin, &name)
            .await
            .map_err(WireError::from_error)?),
        Request::PairingDelete { id_sha256 } => json!(db
            .pairing_pins()
            .delete(&id_sha256)
            .await
            .map_err(WireError::from_error)?),
    };
    db.commit().await.map_err(WireError::from_error)?;
    Ok(answer)
}
