//! Client identity: which program a write came through.
//!
//! Every writer opens the database under a client name. The desktop app is [`ClientId::desktop`];
//! a Python session through the bindings names itself, and so, later, will a phone or a web
//! client. The Undo Journal stamps every entry with the client that wrote it (migration 0092), and
//! a client's Undo Stack holds only its own Gestures, so the desktop user's Ctrl+Z never reverses
//! what a script did.
//!
//! A client is not a user and not a source. [`WriteSource`](crate::undo::model::WriteSource) says
//! *who* acted — a person or an agent — and the client says *through which program*: the MCP
//! endpoint is served by the desktop app, so an agent's write is source `mcp` from client
//! `desktop`. There is no user part yet; it arrives with multi-device.

use std::fmt;
use std::str::FromStr;

/// The longest client name accepted. Long enough for `notebook-2026-10-03`, short enough that a
/// journal full of them costs nothing.
pub const MAX_CLIENT_LENGTH: usize = 64;

/// The name of a client: one to [`MAX_CLIENT_LENGTH`] ASCII letters, digits, `.`, `_` or `-`.
///
/// Restricted so that a name is safe to show, log and compare without escaping, and so that two
/// names that look alike are alike.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ClientId(String);

/// Why a string is not a client name.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum InvalidClientId {
    /// The name was empty.
    #[error("a client name cannot be empty")]
    Empty,
    /// The name was longer than [`MAX_CLIENT_LENGTH`].
    #[error("a client name is at most {MAX_CLIENT_LENGTH} characters, and {0:?} is longer")]
    TooLong(String),
    /// The name held a character outside letters, digits, `.`, `_` and `-`.
    #[error("a client name holds only ASCII letters, digits, '.', '_' and '-', not {0:?}")]
    Character(String),
}

impl ClientId {
    /// The name the desktop app writes under.
    pub const DESKTOP: &'static str = "desktop";

    /// The desktop app's client.
    pub fn desktop() -> Self {
        Self(Self::DESKTOP.to_string())
    }

    /// Whether this is the desktop app's client.
    pub fn is_desktop(&self) -> bool {
        self.0 == Self::DESKTOP
    }

    /// The name, as stored in `undo_journal.client`.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl FromStr for ClientId {
    type Err = InvalidClientId;

    fn from_str(name: &str) -> Result<Self, Self::Err> {
        if name.is_empty() {
            return Err(InvalidClientId::Empty);
        }
        if name.chars().count() > MAX_CLIENT_LENGTH {
            return Err(InvalidClientId::TooLong(name.to_string()));
        }
        let allowed = |c: char| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-');
        if !name.chars().all(allowed) {
            return Err(InvalidClientId::Character(name.to_string()));
        }
        Ok(Self(name.to_string()))
    }
}

impl fmt::Display for ClientId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[cfg(test)]
mod tests;
