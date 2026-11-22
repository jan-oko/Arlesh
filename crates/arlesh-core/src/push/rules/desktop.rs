//! What the desktop app tells its user, and when: the push rules run on the change events the app
//! already receives, in both modes (`docs/spec/notifications.md`, *On the desktop*).
//!
//! A phone is told by the server, which derives the board and keeps a record of what each device
//! was told. The desktop has no server to do that in Client mode, and in Standalone it is its own
//! server, so it follows the publisher's change events instead: [`DesktopNotifier`] holds a
//! [`BoardView`] kept true by those events, and each event is the same two steps the server's
//! look is, [`observed`](BoardView::observed) and [`plan`], against a record of its own.
//!
//! Pure, and told everything: the event, the switches, the time of nothing. Delivery is the
//! shell's.

use std::collections::HashSet;

use serde_json::Value;

use crate::board::ChangeOrigin;

use super::{
    super::model::{Channel, PushEvent, SentEntry},
    baseline, plan, told as told_entries,
    view::{BoardView, ViewError},
};

/// Which events this device shows: one switch per [`Channel`], all on until the user switches one
/// off.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Switches {
    off: HashSet<Channel>,
}

impl Switches {
    /// Switches with exactly `off` switched off.
    pub fn with_off(off: impl IntoIterator<Item = Channel>) -> Self {
        Self {
            off: off.into_iter().collect(),
        }
    }

    /// Whether `channel` is shown.
    pub fn is_on(&self, channel: Channel) -> bool {
        !self.off.contains(&channel)
    }
}

/// One change event, as the notifier reads it.
#[derive(Debug, Clone, Copy)]
pub struct Change<'a> {
    /// The run of the host the event belongs to.
    pub epoch: &'a str,
    /// The publication the event brings the board to; `None` for an older host's event.
    pub seq: Option<u64>,
    /// The changed entries, when they were sent.
    pub changes: Option<&'a Value>,
    /// Whether the host says to load the whole board instead.
    pub reload: bool,
    /// Who caused the publication's changes; `None` for a host that does not say, which is told as
    /// anyone but the user.
    pub origin: Option<ChangeOrigin>,
}

/// What a change event asks of the caller.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Intake {
    /// Show these notifications.
    Show(Vec<PushEvent>),
    /// The event cannot be followed (a gap, a new run, no changes): load the whole board and
    /// [`DesktopNotifier::load`] it.
    Resync,
}

#[derive(Debug, Clone)]
struct Followed {
    view: BoardView,
    epoch: String,
    seq: u64,
}

/// Follows a host's change events and says what to show. See the module's documentation.
#[derive(Debug, Clone, Default)]
pub struct DesktopNotifier {
    followed: Option<Followed>,
    told: Option<Vec<SentEntry>>,
}

impl DesktopNotifier {
    /// A notifier that has seen nothing: the first board it is given counts as already told.
    pub fn new() -> Self {
        Self::default()
    }

    /// Takes in a whole board (`GET /board/current` as JSON) at publication `seq` of `epoch`.
    ///
    /// The first board ever taken in counts as already told, so starting the app tells of nothing
    /// that was true before. A later one (after a gap, or a new run of the server) is read like any
    /// event: what is new on it is told.
    pub fn load(
        &mut self,
        board: &Value,
        epoch: &str,
        seq: u64,
        switches: &Switches,
    ) -> Result<Vec<PushEvent>, ViewError> {
        let view = BoardView::from_json(board)?;
        self.followed = Some(Followed {
            view,
            epoch: epoch.to_owned(),
            seq,
        });
        let first = self.told.is_none();
        if first {
            let observed = self.observed();
            self.told = Some(baseline(&observed));
            return Ok(Vec::new());
        }
        Ok(self.tell(None, switches))
    }

    /// Follows one change event.
    pub fn follow(&mut self, change: &Change<'_>, switches: &Switches) -> Intake {
        let (Some(seq), Some(changes), false) = (change.seq, change.changes, change.reload) else {
            return Intake::Resync;
        };
        let Some(followed) = self.followed.as_mut() else {
            return Intake::Resync;
        };
        if followed.epoch != change.epoch || seq > followed.seq + 1 {
            return Intake::Resync;
        }
        if seq <= followed.seq {
            return Intake::Show(Vec::new());
        }
        if followed.view.apply(changes).is_err() {
            return Intake::Resync;
        }
        followed.seq = seq;
        Intake::Show(self.tell(change.origin, switches))
    }

    fn observed(&self) -> super::super::model::Observed {
        self.followed
            .as_ref()
            .map(|followed| followed.view.observed(followed.view.capacity_locked()))
            .unwrap_or_default()
    }

    /// What is new on the board now: recorded as told whether or not it is shown, so a switch
    /// turned on later does not bring back what it missed.
    ///
    /// Nothing is shown of the user's own change: whatever it made true is recorded as told, so it
    /// is not owed later either.
    fn tell(&mut self, origin: Option<ChangeOrigin>, switches: &Switches) -> Vec<PushEvent> {
        let silent = origin.is_some_and(|origin| !origin.notifies());
        let observed = self.observed();
        let told = self.told.get_or_insert_with(Vec::new);
        let plan = plan(&observed, told);
        told.retain(|entry| !plan.forget.contains(&entry.key));
        for entry in told_entries(&plan.send) {
            told.retain(|each| each.key != entry.key);
            told.push(entry);
        }
        plan.send
            .into_iter()
            .filter(|event| !silent && switches.is_on(event.channel))
            .collect()
    }
}

#[cfg(test)]
mod tests;
