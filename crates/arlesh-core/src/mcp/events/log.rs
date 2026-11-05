//! The wait log: what the long-poll form of `/events/expectations` answers from.
//!
//! A stream remembers the waits it last saw and diffs each read against them. A long poll is a
//! new request each time, so the diff is kept here, beside the feed, and every poll first brings
//! it up to date. Each change is stamped with the revision it was noticed at, and a poll `after`
//! a revision gets the changes stamped past it. The log is lazy: nothing reads the waits until a
//! poll asks, so a board nobody follows costs nothing.

use std::{
    collections::{BTreeMap, VecDeque},
    sync::Arc,
};

use tokio::sync::Mutex;

use super::{
    read_waits,
    rules::{changes, WaitEvent, WaitState},
    ChangeFeed,
};
use crate::{database::session::SessionFactory, error::AppError};

/// How many changes are kept. A client further behind than this is told to read afresh.
const KEPT: usize = 1000;

/// A change to a wait and the revision it was stamped with.
pub type Stamped = (u64, WaitEvent);

/// What a poll finds in the log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reading {
    /// The revision asked for is older than the log reaches, or from a future it has not seen: the
    /// client reads the waits afresh. Carries the revision the log is current to.
    Stale(u64),
    /// The changes stamped past the revision asked for (none, if none), and the revision the log
    /// is current to: every change up to it is in this answer or an earlier one.
    Events(u64, Vec<Stamped>),
}

#[derive(Default)]
struct State {
    /// The waits as the last sync saw them; `None` before the first.
    known: Option<BTreeMap<String, WaitState>>,
    events: VecDeque<Stamped>,
    /// The revision the log is current to: the highest handed out.
    through: u64,
    /// Changes stamped at or below this are gone (or were never seen).
    floor: u64,
}

impl State {
    /// Takes in the waits as a read found them, at the revision the board had reached after it.
    ///
    /// A change is stamped past `through`, even when a write reached the feed while the read ran
    /// and the stamp would otherwise equal a revision already handed out: a client holding that
    /// revision must still hear of it.
    fn absorb(&mut self, now: BTreeMap<String, WaitState>, reached: u64) {
        let Some(known) = self.known.replace(now.clone()) else {
            self.through = self.through.max(reached);
            self.floor = self.through;
            return;
        };
        let events = changes(&known, &now);
        let stamp = if events.is_empty() {
            reached
        } else {
            reached.max(self.through + 1)
        };
        self.through = self.through.max(stamp);
        self.events
            .extend(events.into_iter().map(|event| (stamp, event)));
        while self.events.len() > KEPT {
            if let Some((dropped, _)) = self.events.pop_front() {
                self.floor = self.floor.max(dropped);
            }
        }
    }

    fn reading(&self, after: u64) -> Reading {
        if after < self.floor || after > self.through {
            return Reading::Stale(self.through);
        }
        let events = self
            .events
            .iter()
            .filter(|(stamp, _)| *stamp > after)
            .cloned()
            .collect();
        Reading::Events(self.through, events)
    }
}

/// The log of the waits one filter shows.
#[derive(Default)]
pub struct WaitLog {
    state: Mutex<State>,
}

impl WaitLog {
    /// Brings the log up to date with the board, then reads it `after` a revision.
    pub(super) async fn poll(
        &self,
        factory: &SessionFactory,
        agentic: bool,
        feed: &ChangeFeed,
        after: u64,
    ) -> Result<Reading, AppError> {
        let mut state = self.state.lock().await;
        let now = read_waits(factory, agentic).await?;
        // After the read: a write the read saw has reached the feed by now.
        state.absorb(now, feed.revision());
        Ok(state.reading(after))
    }
}

/// The two logs: every wait the MCP can see, and only the agentic ones.
#[derive(Clone, Default)]
pub struct WaitLogs {
    all: Arc<WaitLog>,
    agentic: Arc<WaitLog>,
}

impl WaitLogs {
    /// The log for a poll that asks for `agentic` waits only, or for all of them.
    pub(super) fn of(&self, agentic: bool) -> &WaitLog {
        if agentic {
            &self.agentic
        } else {
            &self.all
        }
    }
}

#[cfg(test)]
mod tests;
