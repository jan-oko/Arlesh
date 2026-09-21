//! Close to tray: what the window's close button means, and the preference behind it.
//!
//! Closing the window used to end the process, and with it the MCP endpoint the app serves
//! (see [`crate::mcp`]). Hiding to the tray instead keeps that endpoint answering, so an agent can
//! read the board without a window being open for its sake.
//!
//! A close button that can only ever hide is a trap, so two things can still end the process: the
//! tray menu's Quit, and turning the preference off — after which the close button means quit
//! again. Both arrive here as [`CloseAction::Quit`].
//!
//! The other way back is a plain click on the tray icon, which toggles the window rather than
//! ending anything; [`activate_action`] is what one click means.
//!
//! This module is the decision and nothing else. The tray icon, the menu and the window event that
//! consult it live in [`crate::commands::tray`], which is Tauri's side of the same feature.

use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(test)]
mod tests;

/// Whether a fresh install closes to the tray. On, so the MCP endpoint survives a reflexive close
/// without anyone having to find the switch first.
pub const DEFAULT_CLOSE_TO_TRAY: bool = true;

/// What a request to close the main window should actually do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseAction {
    /// Keep the process — and the MCP endpoint with it — and hide the window to the tray.
    HideToTray,
    /// Let the close through, which ends the process.
    Quit,
}

/// Decides what one close request means.
///
/// `quit_requested` wins over the preference: once the user has asked to quit, a close arriving as
/// part of that shutdown must not be turned back into a hide, or Quit would be a button that does
/// nothing.
pub fn close_action(close_to_tray: bool, quit_requested: bool) -> CloseAction {
    if quit_requested || !close_to_tray {
        return CloseAction::Quit;
    }
    CloseAction::HideToTray
}

/// What a plain click on the tray icon should do to the main window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActivateAction {
    /// Put the window back on screen and give it the keyboard.
    Show,
    /// Send the window back to the tray.
    Hide,
}

/// Decides what one tray activation means, given whether the window is on screen.
///
/// `visible` is an [`Option`] rather than a `bool` because the window can fail to answer: on the
/// platforms that hand visibility back through the windowing system it is a fallible read. `None`
/// shows the window — the click was made by someone who wants it, and a window that appears when
/// it was already there is a far smaller surprise than one that vanishes.
pub fn activate_action(visible: Option<bool>) -> ActivateAction {
    match visible {
        Some(true) => ActivateAction::Hide,
        Some(false) | None => ActivateAction::Show,
    }
}

/// The live close-to-tray preference, plus whether a quit is already under way.
///
/// Managed state, shared between the window's close handler, the tray menu and the command the
/// frontend uses to mirror its stored setting here. Both flags are atomics rather than a lock: they
/// are read on the UI thread during a close, and a close must never wait on anything.
#[derive(Debug)]
pub struct ClosePreference {
    close_to_tray: AtomicBool,
    quit_requested: AtomicBool,
}

impl Default for ClosePreference {
    fn default() -> Self {
        Self::new()
    }
}

impl ClosePreference {
    /// A preference at [`DEFAULT_CLOSE_TO_TRAY`], with no quit under way.
    ///
    /// The backend starts at the same default the frontend's stored setting does, so the two agree
    /// before the frontend has had a chance to say anything — including when it never loads.
    pub fn new() -> Self {
        Self {
            close_to_tray: AtomicBool::new(DEFAULT_CLOSE_TO_TRAY),
            quit_requested: AtomicBool::new(false),
        }
    }

    /// Records the user's choice, as the frontend's persisted setting has it.
    pub fn set_close_to_tray(&self, enabled: bool) {
        self.close_to_tray.store(enabled, Ordering::Relaxed);
    }

    /// Whether closing the window currently hides it.
    pub fn close_to_tray(&self) -> bool {
        self.close_to_tray.load(Ordering::Relaxed)
    }

    /// Marks a deliberate quit, so the close it causes is allowed through.
    ///
    /// One-way: nothing clears it, because nothing happens after a quit but the exit.
    pub fn request_quit(&self) {
        self.quit_requested.store(true, Ordering::Relaxed);
    }

    /// Whether a quit has been asked for.
    pub fn quit_requested(&self) -> bool {
        self.quit_requested.load(Ordering::Relaxed)
    }

    /// What a close request arriving now should do.
    pub fn action(&self) -> CloseAction {
        close_action(self.close_to_tray(), self.quit_requested())
    }
}
