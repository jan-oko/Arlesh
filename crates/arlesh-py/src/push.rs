//! `arlesh-server`'s push notifications (migration 0099), reached **synchronously**, as the token
//! table is (see [`crate::tokens`] for why a second copy of SQLite must not touch the file).
//!
//! The rules are the core's (`arlesh_core::push::rules`); a call here gathers what they need — the
//! derived board at `now`, the agents at capacity, the devices and what each was told — runs them
//! and writes what the caller asks. The server sends nothing from here: it asks what is owed
//! (`plan`), sends it, and records what the push service accepted (`record`).

use std::path::Path;

use arlesh_core::{
    error::{WireError, WireErrorKind},
    push::{self, model::SentEntry},
};
use chrono::NaiveDateTime;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    errors::{Failure, Raised},
    request::now,
    tokens::factory_for,
};

/// One push call: a JSON object whose `op` names it.
#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum Request {
    /// Registers a device's FCM token; answers whether the device is new.
    Register {
        client: String,
        fcm_token: String,
        now: Option<NaiveDateTime>,
    },
    /// Removes a device's registration; answers whether it had one.
    Unregister { client: String },
    /// Every registered device.
    Devices,
    /// What each device is to be sent now.
    Plan { now: Option<NaiveDateTime> },
    /// Records that a device was told these facts.
    Record {
        client: String,
        entries: Vec<SentEntry>,
        at: Option<NaiveDateTime>,
    },
}

/// Runs one push call on the database at `path`, waiting for it.
pub(crate) fn run(path: &Path, request: &str) -> Result<String, Raised> {
    let request: Request = serde_json::from_str(request).map_err(|error| {
        Failure::new(
            WireErrorKind::InvalidRequest,
            format!("unreadable push request: {error}"),
        )
    })?;
    let runtime = pyo3_async_runtimes::tokio::get_runtime();
    let answer = runtime.block_on(async {
        let factory = factory_for(path).await?;
        let mut db = factory.begin().await.map_err(WireError::from_error)?;
        let answer = dispatch(&mut db, request).await?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok::<Value, Raised>(answer)
    })?;
    Ok(answer.to_string())
}

async fn dispatch(
    db: &mut arlesh_core::database::session::Db<arlesh_core::database::session::Transactional>,
    request: Request,
) -> Result<Value, WireError> {
    Ok(match request {
        Request::Register {
            client,
            fcm_token,
            now: at,
        } => {
            let new = push::register_device(db, &client, &fcm_token, at.unwrap_or_else(now))
                .await
                .map_err(WireError::from_error)?;
            json!(new)
        }
        Request::Unregister { client } => json!(db
            .push()
            .unregister(&client)
            .await
            .map_err(WireError::from_error)?),
        Request::Devices => json!(db.push().devices().await.map_err(WireError::from_error)?),
        Request::Plan { now: at } => {
            json!(push::plan_all(db, at.unwrap_or_else(now))
                .await
                .map_err(WireError::from_error)?)
        }
        Request::Record {
            client,
            entries,
            at,
        } => {
            let stamp = at.unwrap_or_else(now).to_string();
            db.push()
                .record(&client, &entries, &stamp)
                .await
                .map_err(WireError::from_error)?;
            json!(true)
        }
    })
}
