//! What a gesture on a Task or a Commitment writes: the status cycle, `Alt+Enter`, the Agentic
//! key and the verdict cycle.
//!
//! The frontend sends what the user did; these decide what it means, and the writer applies it.
//! Every view offers the same gestures on the same rows, so they are decided once, here — two views
//! cycling a status differently would be a bug nobody would think to look for.

use serde::{Deserialize, Serialize};

use crate::tasks::model::{AgenticStatus, Status, TaskArchival, TaskStatus, Verdict};

/// A status gesture on a Task.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum StatusStep {
    /// A click on its status glyph, or `Enter`: one step of the cycle.
    Advance,
    /// `Alt+Enter`: pause or resume an ordinary Task; hand an Agentic one back to its agent.
    Alt,
}

/// Why a status gesture writes nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum StatusRefusal {
    /// The Task consists of its sub-items: it has no status of its own to write.
    Compound,
    /// `Alt+Enter` on an Agentic Task that is not Doing: Started is not an Agentic status, and
    /// only Doing work can be handed back.
    AltEnterAgenticNotDoing,
    /// The press would set the Task Done while a counted sub-item is not: a Task cannot be
    /// finished over open work. Complete or archive what is left.
    OpenSubItems,
    /// `Alt+Enter` would pause the Task below what its sub-items make it read: it reads at least
    /// Started, or In Progress, from them, so the lower status would change nothing. The click and
    /// `Enter` cycle never asks: it skips to the floor.
    BelowSubItems,
}

/// What a Task's sub-items say about a status press on it: the part of its subtree the status
/// gestures depend on. The backend reads it off the board, whole subtree counted by Compound's
/// rule; a caller that cannot read it passes the default, which constrains nothing, and the
/// backend still decides.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct SubItems {
    /// What the sub-items make the Task read at least: To Do, Started or In Progress. Never Done.
    pub floor: TaskStatus,
    /// How many counted sub-items are not Done: Backlogged ones, pending waits and Unresolved
    /// Commitments included. A Task cannot be set Done while any is.
    pub open: usize,
}

impl Default for SubItems {
    fn default() -> Self {
        Self {
            floor: TaskStatus::Todo,
            open: 0,
        }
    }
}

/// The status one step of the click/`Enter` cycle moves a Task to, in the model it holds.
///
/// - **Ordinary**: To Do → In Progress → Done → To Do. A **Started** Task — begun and paused —
///   goes to In Progress, as To Do does: `Enter` resumes it.
/// - **Agentic**: To Do → Doing → Done → To Do. **Review** goes to Doing — the user takes up what
///   the agent asked about — and so does **On Agent**: the user takes it over.
pub fn next_status(current: Status) -> Status {
    match current {
        Status::Ordinary(TaskStatus::InProgress) => Status::Ordinary(TaskStatus::Done),
        Status::Ordinary(TaskStatus::Done) => Status::Ordinary(TaskStatus::Todo),
        Status::Ordinary(TaskStatus::Todo | TaskStatus::Started) => {
            Status::Ordinary(TaskStatus::InProgress)
        }
        Status::Agentic(AgenticStatus::Doing) => Status::Agentic(AgenticStatus::Done),
        Status::Agentic(AgenticStatus::Done) => Status::Agentic(AgenticStatus::Todo),
        Status::Agentic(AgenticStatus::Todo | AgenticStatus::Review | AgenticStatus::OnAgent) => {
            Status::Agentic(AgenticStatus::Doing)
        }
    }
}

/// The step `Alt+Enter` takes, in the model the Task holds.
///
/// - **Ordinary**: **Started** from To Do, In Progress or Done, and back to In Progress from
///   Started — so on work under way it pauses and resumes.
/// - **Agentic**: it **hands the Task back** to the agent — Doing → On Agent, which reads Review
///   again while the agent's question is still open. On any other status it is refused.
pub fn alt_step(current: Status) -> Result<Status, StatusRefusal> {
    match current {
        Status::Agentic(AgenticStatus::Doing) => Ok(Status::Agentic(AgenticStatus::OnAgent)),
        Status::Agentic(_) => Err(StatusRefusal::AltEnterAgenticNotDoing),
        Status::Ordinary(TaskStatus::Started) => Ok(Status::Ordinary(TaskStatus::InProgress)),
        Status::Ordinary(_) => Ok(Status::Ordinary(TaskStatus::Started)),
    }
}

/// The cycle never offers a status below the floor the sub-items derive: a step that lands under
/// it lands on the floor itself, so Done goes to Started, not To Do, over a Done sub-item.
fn lifted_to_floor(next: Status, floor: TaskStatus) -> Status {
    match next {
        Status::Ordinary(status) if status.rank() < floor.rank() => Status::Ordinary(floor),
        other => other,
    }
}

/// What `step` writes on a Task whose status is `current`, or why it writes nothing. A Compound
/// Task has no status of its own to write, whatever the gesture. Any Task is held to its
/// `sub_items`: it is not set Done over open ones, and an ordinary one is not set below what they
/// make it read.
pub fn status_after(
    step: StatusStep,
    current: Status,
    compound: bool,
    sub_items: SubItems,
) -> Result<Status, StatusRefusal> {
    if compound {
        return Err(StatusRefusal::Compound);
    }
    let next = match step {
        StatusStep::Advance => lifted_to_floor(next_status(current), sub_items.floor),
        StatusStep::Alt => alt_step(current)?,
    };
    if next.is_done() && sub_items.open > 0 {
        return Err(StatusRefusal::OpenSubItems);
    }
    if step == StatusStep::Alt {
        if let Status::Ordinary(status) = next {
            if status.rank() < sub_items.floor.rank() {
                return Err(StatusRefusal::BelowSubItems);
            }
        }
    }
    Ok(next)
}

/// Why an editor may not offer a status on a Task.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum StatusBlock {
    /// The Task consists purely of its sub-items: no status is set by hand.
    Compound,
    /// The status is below the floor its sub-items derive, so it would change nothing.
    BelowSubItems,
    /// Done while a counted sub-item is not.
    OpenSubItems,
}

/// Why `status` cannot be chosen on a Task, or `None` when it can: the statuses the editors grey
/// out. A Compound Task takes none; any Task is refused Done over open sub-items, and an ordinary
/// one a status below the floor its sub-items derive. The cycle and the editors share it, so
/// neither offers what the other refuses.
pub fn status_block(status: Status, compound: bool, sub_items: SubItems) -> Option<StatusBlock> {
    if compound {
        return Some(StatusBlock::Compound);
    }
    if status.is_done() && sub_items.open > 0 {
        return Some(StatusBlock::OpenSubItems);
    }
    match status {
        Status::Ordinary(ordinary) if ordinary.rank() < sub_items.floor.rank() => {
            Some(StatusBlock::BelowSubItems)
        }
        _ => None,
    }
}

/// How a status write took a Task out of the Backlog, which is said out loud.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum BacklogCleared {
    /// It was set Started.
    ByStarted,
    /// It was begun some other way.
    ByStart,
}

/// Whether the write of `written` took a set-aside Task out of the Backlog, and how.
///
/// Read off the row the write left (`after`), not predicted from the request: the rule belongs to
/// the writer (see `docs/spec/resources.md`, *Backlog*), and this only names what it did.
pub fn backlog_cleared(
    before: TaskArchival,
    after: TaskArchival,
    written: Status,
) -> Option<BacklogCleared> {
    if before != TaskArchival::Backlog || after != TaskArchival::Live {
        return None;
    }
    Some(if written == Status::Ordinary(TaskStatus::Started) {
        BacklogCleared::ByStarted
    } else {
        BacklogCleared::ByStart
    })
}

/// The flag one press of the Agentic key writes: the opposite of what the Task **reads as**.
///
/// A two-state toggle over the resolved value, not a cycle through the stored three: *Inherit*
/// under a non-agentic parent and an explicit *Not agentic* look the same, so a cycle stepping
/// between them would spend a press changing nothing the eye could catch. *Inherit* is a starting
/// point the key reads through, never a destination it writes; returning to it is the editor's.
pub fn toggled_agentic(reads_agentic: bool) -> bool {
    !reads_agentic
}

/// A verdict gesture on a Commitment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum VerdictPress {
    /// The keyboard's one key through all three: Unresolved → Kept → Broken → Unresolved.
    Cycle,
    /// The Kept control: records Kept, or clears it if it already says so.
    Kept,
    /// The Broken control: records Broken, or clears it if it already says so.
    Broken,
}

/// The verdict `press` leaves a Commitment reading `current` with.
///
/// The two controls each toggle, so pressing the one a Commitment already reads clears the
/// verdict — which is how a misclick is taken back — and neither moves straight from one verdict
/// to the other. Kept leads the cycle because it is the answer given most often.
pub fn verdict_after(press: VerdictPress, current: Verdict) -> Verdict {
    let pressed = match press {
        VerdictPress::Cycle => {
            return match current {
                Verdict::Unresolved => Verdict::Kept,
                Verdict::Kept => Verdict::Broken,
                Verdict::Broken => Verdict::Unresolved,
            }
        }
        VerdictPress::Kept => Verdict::Kept,
        VerdictPress::Broken => Verdict::Broken,
    };
    if current == pressed {
        Verdict::Unresolved
    } else {
        pressed
    }
}

#[cfg(test)]
mod tests;
