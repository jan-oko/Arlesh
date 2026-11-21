//! Desktop notifications: the board events the phone is told of, shown by the system while the app
//! runs, tray included (`docs/spec/notifications.md`, *On the desktop*).
//!
//! The rules are the core's ([`arlesh_core::push::rules::desktop`]): this module is the one process
//! -wide [`Notifications`] that feeds them the change events the app already receives, in both modes,
//! and hands what they say to a [`Deliver`]. One service for the whole process is what makes
//! several windows produce one notification: the windows never see the events as a trigger, the
//! shell does, once.
//!
//! The switches are this device's own, in `notifications.json` beside the mode setting: the server
//! stores none for the phone either (Android keeps them), and a switch for the desktop must not
//! follow the board to another machine.

use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, MutexGuard,
    },
};

use arlesh_core::push::{
    model::{Channel, PushEvent},
    rules::desktop::{Change, DesktopNotifier, Intake, Switches},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::backend::revision::{BoardChange, BoardRevision, CurrentBoard};

#[cfg(test)]
mod tests;

/// The file in the app's data directory that holds the switches.
pub const SETTINGS_FILE: &str = "notifications.json";

/// What the user sees: a notification's title and its text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notice {
    /// The channel it belongs to.
    pub channel: Channel,
    /// The title: the app's name, as the phone's.
    pub title: String,
    /// What happened, and to which Task.
    pub text: String,
    /// The Task it is about, keyed as the board keys it (`task-12`), if it is about one.
    pub task: Option<String>,
}

impl Notice {
    /// The Task to show in the Review list when this notice is clicked: only an agent's question
    /// opens anything, and only when it names its Task. Every other notice does nothing on a click,
    /// as before.
    pub fn review_target(&self) -> Option<&str> {
        match self.channel {
            Channel::AgentQuestion => self.task.as_deref(),
            _ => None,
        }
    }
}

/// The words of a notification: the phone's (`push_strings.xml`), in English.
pub fn notice_for(event: &PushEvent) -> Notice {
    let title = event.title.as_deref().unwrap_or_default();
    let text = match event.channel {
        Channel::AgentQuestion => format!("An agent is waiting for your answer: {title}"),
        Channel::TaskOverdue => format!("Overdue: {title}"),
        Channel::TaskGenerated => format!("New task: {title}"),
        Channel::CapacityLocked => "Agent capacity lock set".to_owned(),
        Channel::CapacityCleared => "Agent capacity lock cleared".to_owned(),
    };
    Notice {
        channel: event.channel,
        title: "Arlesh".to_owned(),
        text,
        task: event.task.clone(),
    }
}

/// Shows a notice to the user.
pub trait Deliver: Send + Sync {
    /// Shows `notice`. A failure is the deliverer's to log: it is never the board's.
    fn show(&self, notice: &Notice);
}

/// One switch as the settings page shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Switch {
    /// The event.
    pub channel: Channel,
    /// Whether it is shown.
    pub enabled: bool,
}

#[derive(Serialize, Deserialize, Default)]
struct SettingsFile {
    #[serde(default)]
    off: Vec<Channel>,
}

/// The switches, kept in `notifications.json`.
struct SwitchStore {
    path: PathBuf,
    switches: Mutex<Switches>,
}

impl SwitchStore {
    fn open(app_dir: &Path) -> Self {
        let path = app_dir.join(SETTINGS_FILE);
        let file: SettingsFile = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| {
                serde_json::from_str(&text)
                    .map_err(|error| {
                        tracing::warn!(error = %error, "could not read the notification switches");
                    })
                    .ok()
            })
            .unwrap_or_default();
        Self {
            path,
            switches: Mutex::new(Switches::with_off(file.off)),
        }
    }

    fn current(&self) -> Switches {
        lock(&self.switches).clone()
    }

    fn set(&self, channel: Channel, enabled: bool) -> std::io::Result<()> {
        let mut switches = lock(&self.switches);
        let off: Vec<Channel> = Channel::ALL
            .into_iter()
            .filter(|each| {
                if *each == channel {
                    !enabled
                } else {
                    !switches.is_on(*each)
                }
            })
            .collect();
        let text = serde_json::to_string_pretty(&SettingsFile { off: off.clone() })
            .map_err(std::io::Error::other)?;
        std::fs::write(&self.path, text)?;
        *switches = Switches::with_off(off);
        Ok(())
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// What the shell does after an event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Followed {
    /// The event was followed, and whatever it said is shown.
    Done,
    /// The event could not be followed: load the whole board and give it to [`Notifications::load`].
    NeedsBoard,
}

/// The one notification service of the process. See the module's documentation.
pub struct Notifications {
    notifier: Mutex<DesktopNotifier>,
    store: SwitchStore,
    deliver: Arc<dyn Deliver>,
    loading: AtomicBool,
}

fn raw_json(raw: &serde_json::value::RawValue) -> Option<Value> {
    serde_json::from_str(raw.get()).ok()
}

impl Notifications {
    /// A service showing through `deliver`, with the switches saved in `app_dir`.
    pub fn new(app_dir: &Path, deliver: Arc<dyn Deliver>) -> Self {
        Self {
            notifier: Mutex::new(DesktopNotifier::new()),
            store: SwitchStore::open(app_dir),
            deliver,
            loading: AtomicBool::new(false),
        }
    }

    /// Follows one change event, as a window is told it.
    pub fn on_change(&self, change: &BoardChange) -> Followed {
        let changes = change.changes.as_deref().and_then(raw_json);
        let event = Change {
            epoch: &change.epoch,
            seq: change.seq,
            revision: change.revision,
            changes: changes.as_ref(),
            reload: change.reload || (change.changes.is_some() && changes.is_none()),
        };
        let intake = lock(&self.notifier).follow(&event, &self.store.current());
        match intake {
            Intake::Show(events) => {
                self.show(&events);
                Followed::Done
            }
            Intake::Resync => Followed::NeedsBoard,
        }
    }

    /// Takes in the whole board: the first one counts as told, a later one tells what is new.
    pub fn load(&self, board: &CurrentBoard) {
        let (Some(json), Some(stamp)) = (raw_json(&board.load), board.revision.as_ref()) else {
            tracing::warn!("a board without a revision cannot be followed for notifications");
            return;
        };
        let seq = board.seq.unwrap_or(0);
        let shown = lock(&self.notifier).load(
            &json,
            &stamp.epoch,
            seq,
            stamp.revision,
            &self.store.current(),
        );
        match shown {
            Ok(events) => self.show(&events),
            Err(error) => {
                tracing::warn!(error = %error, "the board could not be read for notifications")
            }
        }
    }

    /// Notes that a window of this device wrote, and settled on `fence`.
    pub fn note_own_write(&self, fence: &BoardRevision) {
        lock(&self.notifier).note_own_write(&fence.epoch, fence.revision);
    }

    /// Claims the right to load the board for this service: `false` while another load runs.
    pub fn begin_load(&self) -> bool {
        !self.loading.swap(true, Ordering::AcqRel)
    }

    /// Releases what [`Self::begin_load`] claimed.
    pub fn end_load(&self) {
        self.loading.store(false, Ordering::Release);
    }

    /// Every event with whether the user has it switched on.
    pub fn switches(&self) -> Vec<Switch> {
        let switches = self.store.current();
        Channel::ALL
            .into_iter()
            .map(|channel| Switch {
                channel,
                enabled: switches.is_on(channel),
            })
            .collect()
    }

    /// Switches one event on or off, and keeps the choice.
    pub fn set_enabled(&self, channel: Channel, enabled: bool) -> std::io::Result<()> {
        self.store.set(channel, enabled)
    }

    fn show(&self, events: &[PushEvent]) {
        for event in events {
            self.deliver.show(&notice_for(event));
        }
    }
}
