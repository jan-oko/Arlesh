//! The PIN door: how an agent on the same machine gets a one-time PIN with no human at the
//! keyboard.
//!
//! `POST /agents/pin` on the desktop app's loopback port answers a PIN an agent can attach with
//! (see [`super::agents`]). It is open to a **running, signed-in client** only in this sense: it
//! exists while the app runs, it answers loopback hosts and requests with no `Origin` header (so a
//! page in a browser cannot reach it), and the PIN it issues is the same short-lived, single-use,
//! rate-limited PIN Settings → Agents shows. In Client mode the app forwards to the server it is
//! signed in to, with its own device token — so the PIN door is the app's, and an agent token can
//! never mint a PIN.
//!
//! Anything on the machine that can reach the loopback port can ask, which is the trust the local
//! MCP endpoint has always had: whoever can run a process as the user already holds the board.

use std::{future::Future, pin::Pin, sync::Arc};

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::post,
    Json, Router,
};

use crate::{agents::model::IssuedPin, error::WireError};

/// Asks for a PIN: the app's own backend, local or forwarded to the server.
pub type PinIssuer = Arc<
    dyn Fn() -> Pin<Box<dyn Future<Output = Result<IssuedPin, WireError>> + Send>> + Send + Sync,
>;

/// The route `POST /agents/pin`, answering [`IssuedPin`] as JSON.
pub fn router(issuer: PinIssuer) -> Router {
    Router::new()
        .route("/agents/pin", post(issue))
        .with_state(issuer)
}

async fn issue(
    State(issuer): State<PinIssuer>,
    headers: HeaderMap,
) -> Result<Json<IssuedPin>, (StatusCode, Json<WireError>)> {
    super::events::guard(&headers).map_err(|status| {
        (
            status,
            Json(WireError::not_permitted(
                "the PIN door answers loopback requests with no Origin only",
            )),
        )
    })?;
    match issuer().await {
        Ok(pin) => Ok(Json(pin)),
        Err(error) => {
            tracing::warn!(error = ?error.kind(), "could not issue a PIN at the door");
            Err((StatusCode::SERVICE_UNAVAILABLE, Json(error)))
        }
    }
}

#[cfg(test)]
mod tests;
