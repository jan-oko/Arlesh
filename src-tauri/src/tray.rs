//! Close to tray: what a window's close button means, and the preference behind it.
//!
//! Closing the window used to end the process, and with it the MCP endpoint the app serves
//! (see [`crate::mcp`]). Hiding to the tray instead keeps that endpoint answering, so an agent can
//! read the board without a window being open for its sake.
//!
//! A close button that can only ever hide is a trap, so two things can still end the process: the
//! tray menu's Quit, and turning the preference off — after which the close button means quit
//! again. Both arrive here as [`CloseAction::Close`].
//!
//! **Only the last window is special.** With a tab torn off into a second window, closing one of
//! several windows is just that — the process is not ending, the MCP endpoint is not going down,
//! and there is nothing for the tray to hold. The preference is about what happens when the app is
//! about to have no window left, which is the only moment closing could cost anything.
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

/// What a request to close a window should actually do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseAction {
    /// Keep the process — and the MCP endpoint with it — and hide the window to the tray.
    HideToTray,
    /// Let the close through. For the last window that ends the process; for any other it does not.
    Close,
}

/// Decides what one close request means.
///
/// `quit_requested` wins over everything: once the user has asked to quit, a close arriving as part
/// of that shutdown must not be turned back into a hide, or Quit would be a button that does
/// nothing.
///
/// `is_last_window` is next, and it is why this takes three arguments rather than two. A window
/// that is not the last one closes because closing it costs nothing: the process, the endpoint and
/// the other windows all carry on, and hiding it to the tray would leave the user with an entry in
/// a menu instead of the window they asked to be rid of. Only the final close is the one the
/// preference is about.
pub fn close_action(
    close_to_tray: bool,
    quit_requested: bool,
    is_last_window: bool,
) -> CloseAction {
    if quit_requested || !is_last_window || !close_to_tray {
        return CloseAction::Close;
    }
    CloseAction::HideToTray
}

/// What a plain click on the tray icon should do to Arlesh's windows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActivateAction {
    /// Put the window back on screen and give it the keyboard.
    Show,
    /// Send the window back to the tray.
    Hide,
}

/// Decides what one tray activation means, given whether any window is on screen.
///
/// `visible` is an [`Option`] rather than a `bool` because a window can fail to answer: on the
/// platforms that hand visibility back through the windowing system it is a fallible read. `None`
/// shows the windows — the click was made by someone who wants them, and a window that appears
/// when it was already there is a far smaller surprise than one that vanishes.
///
/// It is one answer for every window rather than one per window, because the tray holds the app
/// and not a window: a click that hid one window and showed another would be a gesture with no
/// stable meaning. Any window showing means the app is on screen, so the click puts it away.
pub fn activate_action(visible: Option<bool>) -> ActivateAction {
    match visible {
        Some(true) => ActivateAction::Hide,
        Some(false) | None => ActivateAction::Show,
    }
}

/// The live close-to-tray preference, plus whether a quit is already under way and whether there
/// is a tray to close to at all.
///
/// Managed state, shared between the window close handler, the tray menu and the command the
/// frontend uses to mirror its stored setting here. The flags are atomics rather than a lock: they
/// are read on the UI thread during a close, and a close must never wait on anything.
#[derive(Debug)]
pub struct ClosePreference {
    close_to_tray: AtomicBool,
    quit_requested: AtomicBool,
    tray_available: AtomicBool,
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
            // Nothing to hide into until a tray actually goes up. A desktop with no tray host is
            // an ordinary condition, and hiding a window into a tray that never appeared is the
            // one outcome this feature must never produce.
            tray_available: AtomicBool::new(false),
        }
    }

    /// Records that the tray icon went up, which is what makes hiding to it possible.
    pub fn mark_tray_available(&self) {
        self.tray_available.store(true, Ordering::Relaxed);
    }

    /// Whether there is a tray to close to.
    pub fn tray_available(&self) -> bool {
        self.tray_available.load(Ordering::Relaxed)
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

    /// What a close request arriving now should do, for a window that is or is not the last one.
    ///
    /// With no tray the preference cannot be honoured, so it is read as off — which is exactly
    /// where Arlesh started: the close button means quit. Folding that in here rather than into
    /// [`close_action`] keeps the decision three plain questions wide, and puts "there is nowhere
    /// to hide" next to the flag that knows it.
    pub fn action(&self, is_last_window: bool) -> CloseAction {
        close_action(
            self.close_to_tray() && self.tray_available(),
            self.quit_requested(),
            is_last_window,
        )
    }
}
