//! What phone push notifications are made of: the five kinds of event, and what the server
//! records about each device. See `docs/spec/notifications.md`.

use serde::{Deserialize, Serialize};

/// The key under which the lock state last notified is recorded.
pub const CAPACITY_KEY: &str = "capacity";

/// The kind of event a notification tells of. Each is one Android notification channel, named by
/// [`Channel::as_str`], so the user can switch each off in the system settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Channel {
    /// An agent asked a question: a Task went to Review.
    AgentQuestion,
    /// A Task became Overdue.
    TaskOverdue,
    /// A task was generated: a Habit occurrence, a wait's check task.
    TaskGenerated,
    /// The agent capacity lock was set.
    CapacityLocked,
    /// The agent capacity lock was cleared.
    CapacityCleared,
}

impl Channel {
    /// The channel's id on the wire and on the phone.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AgentQuestion => "agent_question",
            Self::TaskOverdue => "task_overdue",
            Self::TaskGenerated => "task_generated",
            Self::CapacityLocked => "capacity_locked",
            Self::CapacityCleared => "capacity_cleared",
        }
    }
}

/// One notification to send: a fact that became true, and what to say of it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, schemars::JsonSchema)]
pub struct PushEvent {
    /// The fact's key, which is also the notification's tag on the phone.
    pub key: String,
    /// What to record under the key once it is sent: empty, or the lock state.
    pub value: String,
    /// The channel it goes out on.
    pub channel: Channel,
    /// The Task it is about, keyed as the board keys it (`task-12`); what a tap opens.
    pub task: Option<String>,
    /// The Task's title.
    pub title: Option<String>,
}

/// What is true of the board now that a notification could tell of.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Observed {
    /// The facts that hold: open questions, Overdue Tasks, generated Tasks.
    pub facts: Vec<PushEvent>,
    /// Whether the agent capacity lock is set.
    pub capacity_locked: bool,
}

/// A fact recorded as notified.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct SentEntry {
    /// The fact's key.
    pub key: String,
    /// What was recorded with it.
    pub value: String,
}

/// What one device needs now.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Plan {
    /// Facts newly true, or a lock change, that the device was not told of.
    pub send: Vec<PushEvent>,
    /// Recorded facts that no longer hold, to forget, so that holding again is news.
    pub forget: Vec<String>,
}

/// A registered device.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, schemars::JsonSchema)]
pub struct PushDevice {
    /// The device's client name.
    pub client: String,
    /// Its FCM registration token.
    pub fcm_token: String,
}

/// A device and what it is to be sent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, schemars::JsonSchema)]
pub struct DevicePlan {
    /// The device.
    pub device: PushDevice,
    /// What it is to be sent, in order.
    pub events: Vec<PushEvent>,
}
