//! The window session: which windows were open, and where they were.
//!
//! Every Arlesh window is the same thing — a tab strip with one or more tabs — so there is no
//! second-class kind of window to reason about and nothing here is about "the main one". What this
//! module owns is the part of that which survives a restart: a list of windows, each with a label
//! and the rectangle it last occupied.
//!
//! The **tabs** in those windows are not here. They are the frontend's, written to that window's
//! own `localStorage` key under its label, because a tab is a thing the frontend understands and
//! the backend would only be a courier for. What the backend has to own is the list itself: it is
//! the only layer that can tell a window that was really closed from one that was hidden to the
//! tray or taken down by a quit, and getting that distinction wrong either resurrects a window the
//! user closed or loses one they did not.
//!
//! This module is the decision and nothing else — the pure shape, the placement rule and the
//! save rule, all testable without a windowing system. [`crate::commands::windows`] is Tauri's
//! side: it creates the windows, reads their geometry and writes the file.

use std::path::Path;

use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests;

/// The label of the window Arlesh opens on a first run, and the key its tabs are stored under.
///
/// Every other window's label is minted by the frontend when a tab is torn off, so this is the one
/// name in the system that is a constant — which is also what lets a session written before
/// windows existed be read as this window's.
pub const BOOTSTRAP_LABEL: &str = "main";

/// How much of a restored window must be on a display, in physical pixels, for its saved position
/// to be used.
///
/// A window may legitimately hang off the edge of a screen, so "is the whole rectangle on a
/// display" would move windows that were exactly where the user left them. What must not happen is
/// a window reopening on a monitor that is no longer connected, with nothing of it on screen and
/// no way to reach it. Sixty-four pixels in both axes is enough of a window to grab.
pub const MIN_VISIBLE: u32 = 64;

/// A rectangle in physical pixels, as the windowing system reports one.
///
/// Physical rather than logical throughout: monitor bounds and window positions are both reported
/// that way, and a session saved on one scale factor and restored on another would otherwise be
/// compared against the wrong numbers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowRect {
    /// Distance from the left of the virtual desktop.
    pub x: i32,
    /// Distance from the top of the virtual desktop.
    pub y: i32,
    /// Width, which is never zero for a window that was on screen.
    pub width: u32,
    /// Height, which is never zero for a window that was on screen.
    pub height: u32,
}

impl WindowRect {
    /// The rectangle's right edge, saturating rather than wrapping on an absurd width.
    fn right(&self) -> i64 {
        i64::from(self.x) + i64::from(self.width)
    }

    /// The rectangle's bottom edge.
    fn bottom(&self) -> i64 {
        i64::from(self.y) + i64::from(self.height)
    }

    /// How many pixels of this rectangle and `other` overlap horizontally, and vertically.
    fn overlap(&self, other: &Self) -> (i64, i64) {
        let horizontal =
            self.right().min(other.right()) - i64::from(self.x).max(i64::from(other.x));
        let vertical =
            self.bottom().min(other.bottom()) - i64::from(self.y).max(i64::from(other.y));
        (horizontal.max(0), vertical.max(0))
    }

    /// Whether enough of this rectangle lies on `display` to be worth reopening there.
    ///
    /// "Enough" is [`MIN_VISIBLE`] in both axes, or the whole of the window in an axis where it is
    /// smaller than that — a 40-pixel-tall window is not required to show 64 pixels of itself.
    fn is_reachable_on(&self, display: &Self) -> bool {
        let (horizontal, vertical) = self.overlap(display);
        horizontal >= i64::from(MIN_VISIBLE.min(self.width))
            && vertical >= i64::from(MIN_VISIBLE.min(self.height))
    }
}

/// One window in the saved session: what it is called, and where it was.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowRecord {
    /// The window's Tauri label, which is also the key its tab strip is stored under.
    pub label: String,
    /// Where it was, or `None` for a window whose geometry could not be read.
    #[serde(default)]
    pub rect: Option<WindowRect>,
}

/// Every window that was open when the session was last saved, in the order they were opened.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowSession {
    /// The windows to reopen. Never empty once anything has been saved.
    #[serde(default)]
    pub windows: Vec<WindowRecord>,
}

impl WindowSession {
    /// The session a first run starts from: one window, at whatever size the config asks for.
    pub fn bootstrap() -> Self {
        Self {
            windows: vec![WindowRecord {
                label: BOOTSTRAP_LABEL.to_string(),
                rect: None,
            }],
        }
    }

    /// Whether `label` is one of the windows in this session.
    pub fn holds(&self, label: &str) -> bool {
        self.windows.iter().any(|window| window.label == label)
    }
}

/// Where a restored window should be put.
///
/// Size and position are separate because they fail apart: a window whose monitor is gone still
/// wants the size the user gave it, and only its position has to be given up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Placement {
    /// The saved size, or `None` to take the configured default.
    pub size: Option<(u32, u32)>,
    /// The saved position, or `None` to let the windowing system centre it.
    pub position: Option<(i32, i32)>,
}

/// Decides where to reopen a window, given where it was and which displays are connected.
///
/// A saved position that is no longer on any display is dropped and the window is centred instead
/// — the one case where restoring faithfully is worse than not, because a window reopened on a
/// monitor that has been unplugged is a window the user cannot reach.
///
/// An **empty** `displays` is "we could not ask", not "there are no screens", and the saved
/// position is honoured: refusing to place a window because the monitor list came back empty would
/// scatter a restored session for a reason that has nothing to do with the user's setup.
pub fn placement(rect: Option<WindowRect>, displays: &[WindowRect]) -> Placement {
    let Some(rect) = rect else {
        return Placement {
            size: None,
            position: None,
        };
    };
    let size = Some((rect.width, rect.height));
    if displays.is_empty() || displays.iter().any(|display| rect.is_reachable_on(display)) {
        return Placement {
            size,
            position: Some((rect.x, rect.y)),
        };
    }
    tracing::info!(
        x = rect.x,
        y = rect.y,
        "a saved window position is on no connected display; centring it instead"
    );
    Placement {
        size,
        position: None,
    }
}

/// What to write down, given the windows that are open now and what was written down before.
///
/// **An empty session is never saved.** The windows of a quitting app are destroyed one at a time,
/// and the last of those destructions reports no open windows at all — writing that down would
/// turn "I closed Arlesh" into "Arlesh has no windows", and the next launch would come back to a
/// blank strip having thrown away a two-monitor arrangement. Keeping the previous session is right
/// for the other reading too: a run that ends with no windows open ends where it was last known to
/// be.
pub fn session_to_save(open: Vec<WindowRecord>, previous: &WindowSession) -> WindowSession {
    if open.is_empty() {
        return previous.clone();
    }
    WindowSession { windows: open }
}

/// Reads the saved session from `path`, or the bootstrap session when there is nothing usable.
///
/// A missing file is an ordinary first run. A file that will not parse is a file written by a
/// build that is not this one, or a half-written one from a crash; either way the honest answer is
/// one window, because refusing to open at all over a session file would be the worst possible
/// trade.
pub fn read_session(path: &Path) -> WindowSession {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return WindowSession::bootstrap()
        }
        Err(error) => {
            tracing::warn!(error = %error, "could not read the window session; opening one window");
            return WindowSession::bootstrap();
        }
    };
    match serde_json::from_str::<WindowSession>(&raw) {
        Ok(session) if !session.windows.is_empty() => session,
        Ok(_) => WindowSession::bootstrap(),
        Err(error) => {
            tracing::warn!(error = %error, "the saved window session did not parse; opening one window");
            WindowSession::bootstrap()
        }
    }
}

/// Writes the session to `path`, creating the directory if it is not there.
///
/// A failure costs the restore, never the session: the user is using the app, and a window layout
/// that could not be written down is not a reason to interrupt them.
pub fn write_session(path: &Path, session: &WindowSession) {
    let write = || -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(session)
            .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
        std::fs::write(path, json)
    };
    if let Err(error) = write() {
        tracing::warn!(error = %error, "could not write the window session");
    }
}
