//! The rules of the event streams: what counts as a change to a wait, and who may ask for a stream.
//!
//! Pure functions over values. The stream in the parent module gathers the waits it can see and
//! hands them in; nothing here reads a session, a clock or a socket.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::tasks::model::ExpectationStatus;

/// One wait as an event stream and the `watch` tools tell it: ids to name it by, the Task it hangs
/// under, and the two things that decide whether anyone is woken.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WaitState {
    /// The wait's full id, the one that stays the same everywhere.
    pub wait_id: String,
    /// The wait's short id, as the board names it.
    pub short_id: String,
    /// The full id of the Task (or other node) the wait hangs under.
    pub task_id: String,
    /// The short id of that parent.
    pub task_short_id: String,
    /// Pending or released.
    pub status: ExpectationStatus,
    /// Whether the wait is archived.
    pub archived: bool,
    /// Whether it is a question for the user, rather than a wait on something else.
    pub question: bool,
}

/// What happened to a wait between two reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Change {
    /// The wait appeared.
    Created,
    /// It went from pending to released: answered, or released by the agent.
    Released,
    /// It went from released back to pending, by undo or by hand.
    Reopened,
    /// It was archived.
    Archived,
    /// It came back from the archive.
    Unarchived,
    /// It is gone: deleted, or no longer inside what the MCP can see.
    Deleted,
}

/// A change to one wait: what happened, and the wait as it stands (as it last stood, for a
/// deleted one).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WaitEvent {
    /// What happened.
    pub change: Change,
    /// The wait after the change.
    pub wait: WaitState,
}

impl WaitEvent {
    /// Whether the wait is gone.
    pub fn deleted(&self) -> bool {
        self.change == Change::Deleted
    }
}

/// The events that take `before` to `after`, both keyed by wait id.
///
/// A title or note edit changes neither status nor archival, so it is no event: an agent is never
/// woken for it. When a wait's status and archival both moved, the status event comes first.
pub fn changes(
    before: &BTreeMap<String, WaitState>,
    after: &BTreeMap<String, WaitState>,
) -> Vec<WaitEvent> {
    let mut events = Vec::new();
    for (id, now) in after {
        let Some(was) = before.get(id) else {
            events.push(WaitEvent {
                change: Change::Created,
                wait: now.clone(),
            });
            continue;
        };
        if was.status != now.status {
            let change = match now.status {
                ExpectationStatus::Released => Change::Released,
                ExpectationStatus::Pending => Change::Reopened,
            };
            events.push(WaitEvent {
                change,
                wait: now.clone(),
            });
        }
        if was.archived != now.archived {
            let change = if now.archived {
                Change::Archived
            } else {
                Change::Unarchived
            };
            events.push(WaitEvent {
                change,
                wait: now.clone(),
            });
        }
    }
    for (id, was) in before {
        if !after.contains_key(id) {
            events.push(WaitEvent {
                change: Change::Deleted,
                wait: was.clone(),
            });
        }
    }
    events
}

/// Whether a request for a stream may be served: it names a loopback host, and carries no
/// `Origin` (a browser always sends one; an agent's client never does).
///
/// The same line the MCP endpoint itself draws, so a page in the user's browser cannot read the
/// streams the endpoint serves.
pub fn admitted(host: Option<&str>, origin: Option<&str>) -> bool {
    if origin.is_some() {
        return false;
    }
    let Some(host) = host else {
        return false;
    };
    let name = match host.strip_prefix('[') {
        Some(rest) => rest.split(']').next().unwrap_or(""),
        None => host.split(':').next().unwrap_or(""),
    };
    matches!(name, "localhost" | "127.0.0.1" | "::1")
}
