//! Phone push notifications: the server's `/push` and `/devices/current/push` routes, which are not
//! the board's, so not methods of the [`Backend`](crate::Backend) port. They are listed
//! under `pairing` in `conformance/client-mode.json`. See `docs/spec/notifications.md`.

use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::json;

use arlesh_core::error::WireError;

use super::{Call, HttpBackend};

/// What `GET /push` answers: whether the server can push.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PushState {
    /// Whether the server has FCM credentials.
    pub enabled: bool,
    /// The Firebase project it sends from, when enabled.
    pub project_id: Option<String>,
}

/// What registering answers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Registered {
    /// Whether the device had no registration before.
    pub new: bool,
}

impl HttpBackend {
    /// Whether the server can push, and from which project.
    pub async fn push_state(&self) -> Result<PushState, WireError> {
        self.read(Call::new(Method::GET, "/push".to_owned())).await
    }

    /// Registers this device's FCM token with the server, replacing its last.
    pub async fn register_push(&self, fcm_token: &str) -> Result<Registered, WireError> {
        self.write(
            Call::new(Method::PUT, "/devices/current/push".to_owned())
                .json(&json!({ "fcm_token": fcm_token })),
        )
        .await
    }

    /// Drops this device's registration.
    pub async fn unregister_push(&self) -> Result<(), WireError> {
        self.write(Call::new(
            Method::DELETE,
            "/devices/current/push".to_owned(),
        ))
        .await
    }
}
