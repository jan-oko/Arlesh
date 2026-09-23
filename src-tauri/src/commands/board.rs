//! Tauri's side of the board-changed broadcast: the emit itself.
//!
//! The decision — which windows a change has to reach — is [`crate::board`], which is pure and
//! tested. This file is the one place that turns it into an event, and it is deliberately the only
//! thing in the crate that knows the event exists.

use tauri::{Emitter, Manager, Runtime};

use crate::board::{recipients, Announce, BOARD_CHANGED};

/// Tells every window but `origin` that the board has changed.
///
/// Best-effort in one direction only: a window that cannot be reached is logged and the others
/// still hear. A failure to announce must never turn into a failure of the write that caused it —
/// the board has already changed, and the worst this can cost is a window that is briefly stale.
pub fn announce<R: Runtime>(app: &tauri::AppHandle<R>, origin: Option<&str>) {
    let open: Vec<String> = app.webview_windows().into_keys().collect();
    for label in recipients(&open, origin) {
        if let Err(error) = app.emit_to(label, BOARD_CHANGED, ()) {
            tracing::warn!(error = %error, label = %label, "could not tell a window the board changed");
        }
    }
}

/// An [`Announce`] bound to `app`, for a caller that has no window of its own to exclude.
///
/// The MCP endpoint is that caller: an agent's write is not made *in* a window, so every window
/// needs telling, and the endpoint gets a closure rather than an `AppHandle` so that nothing in
/// [`crate::mcp`] has to know what a window is.
pub fn announcer<R: Runtime>(app: &tauri::AppHandle<R>) -> Announce {
    let app = app.clone();
    std::sync::Arc::new(move |origin: Option<&str>| announce(&app, origin))
}
