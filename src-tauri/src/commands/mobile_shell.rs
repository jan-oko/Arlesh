//! The shell commands a phone answers: one window, no tray, no tabs to tear off.
//!
//! The frontend asks the same questions on every platform; here the answers are the single
//! window's, so nothing on the page has to branch on the platform. The desktop's versions are
//! `commands::windows` and `commands::tray`, and this module answers to both names.

use tauri::{AppHandle, Runtime};

use crate::error::WireError;

/// The one window every phone run has.
const MAIN_WINDOW: &str = "main";

/// There is no tray to hide into, so the preference has nothing to act on.
#[tauri::command]
pub fn set_close_to_tray(_enabled: bool) {}

/// Exits the app. Nothing on a phone asks for it (system back exits at the root), but the
/// command exists on every platform.
#[tauri::command]
pub fn quit_app<R: Runtime>(app: AppHandle<R>) {
    app.exit(0);
}

/// A phone has a single window, so a tab cannot be torn off into another.
#[tauri::command]
pub async fn open_board_window(_label: String) -> Result<(), WireError> {
    Err(WireError::not_permitted(
        "this device has one window; tabs cannot be torn off",
    ))
}

/// The labels of every open window: only the main one.
#[tauri::command]
pub async fn board_windows() -> Result<Vec<String>, WireError> {
    Ok(vec![MAIN_WINDOW.to_owned()])
}

/// The one window is always in front, so there is nothing to bring up.
#[tauri::command]
pub async fn focus_board_window(_label: String) -> Result<(), WireError> {
    Ok(())
}
