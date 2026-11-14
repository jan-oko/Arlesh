//! **Review**: an On Agent Task whose agent has a question open for the user — derived on every
//! board load, never stored (see `docs/spec/resources.md`, "Agentic statuses").
//!
//! An agent leaves its responsibility only by raising a question (`arlesh_waits.ask`): while one
//! is pending beneath the Task it reads Review, and once the question is released — answered — it
//! reads On Agent again. A wait that is not a question (CI, say) changes nothing, nor does a
//! question under a Task the user is on (Doing): Review is the agent's hand-back, not the user's.

use std::collections::HashSet;

use crate::nodes::id::NodeId;

use crate::tasks::model::{
    AgenticStatus, Expectation, ExpectationArchival, ExpectationStatus, ReviewDetails, ReviewLink,
    Status, Task,
};

/// The longest title a review takes, in characters.
pub const MAX_TITLE: usize = 200;
/// The longest summary a review takes, in characters.
pub const MAX_SUMMARY: usize = 10_000;
/// The longest link label, in characters.
pub const MAX_LABEL: usize = 100;
/// The longest link URL, in characters.
pub const MAX_URL: usize = 2_000;
/// The longest hand test, in characters.
pub const MAX_HAND_TEST: usize = 1_000;
/// The most links a review carries.
pub const MAX_LINKS: usize = 20;
/// The most hand tests a review carries.
pub const MAX_HAND_TESTS: usize = 30;

/// Why a review, or the release of an agentic wait, is refused. Each message says what to change.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ReviewRefusal {
    /// The title is empty or only whitespace.
    #[error("a review needs a title: say what is up for review")]
    BlankTitle,
    /// The summary is empty or only whitespace.
    #[error("a review needs a summary: say what changed")]
    BlankSummary,
    /// A field is over its length cap.
    #[error("the review's {field} is too long: at most {max} characters")]
    TooLong {
        /// Which field.
        field: &'static str,
        /// Its cap.
        max: usize,
    },
    /// More links or hand tests than a review takes.
    #[error("a review takes at most {max} {what}")]
    TooMany {
        /// What there are too many of.
        what: &'static str,
        /// The cap.
        max: usize,
    },
    /// A link has no label or no URL.
    #[error("every link needs a label and a URL: give both, or leave the link out")]
    BlankLink,
    /// A link's URL is not an http or https address.
    #[error("a link's URL must be an http or https address, not {0:?}")]
    BadUrl(String),
    /// A review was given to a wait that is not agentic.
    #[error("a review exists only on an agentic wait")]
    NotAgentic,
    /// The Task is not held by an agent, so it has nothing to hand back.
    #[error(
        "the task is not held by an agent: claim it first (arlesh_tasks.set_status todo -> \
         on_agent), then raise the review"
    )]
    TaskNotHeld,
    /// The wait was already answered; an answer is never overwritten.
    #[error(
        "this wait is already released; its answer stands. Raise a new wait or review instead"
    )]
    AlreadyReleased,
}

/// Whether `url` is an http or https address: the scheme, `://`, then a host with no whitespace or
/// control characters anywhere.
fn is_web_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    let rest = lower
        .strip_prefix("https://")
        .or_else(|| lower.strip_prefix("http://"));
    rest.is_some_and(|rest| !rest.is_empty())
        && !url.chars().any(|c| c.is_whitespace() || c.is_control())
}

fn capped(text: &str, field: &'static str, max: usize) -> Result<(), ReviewRefusal> {
    if text.chars().count() > max {
        return Err(ReviewRefusal::TooLong { field, max });
    }
    Ok(())
}

/// A review's content as it is stored: the title and summary trimmed, blank hand tests dropped,
/// every link checked. Refuses a blank title or summary, a link with a blank half or a scheme that
/// is not http or https, and anything over its cap.
pub fn normalise_review(
    title: &str,
    summary: Option<&str>,
    details: ReviewDetails,
) -> Result<(String, String, ReviewDetails), ReviewRefusal> {
    let title = title.trim();
    if title.is_empty() {
        return Err(ReviewRefusal::BlankTitle);
    }
    capped(title, "title", MAX_TITLE)?;
    let summary = summary.map(str::trim).unwrap_or_default();
    if summary.is_empty() {
        return Err(ReviewRefusal::BlankSummary);
    }
    capped(summary, "summary", MAX_SUMMARY)?;
    if details.links.len() > MAX_LINKS {
        return Err(ReviewRefusal::TooMany {
            what: "links",
            max: MAX_LINKS,
        });
    }
    let mut links = Vec::with_capacity(details.links.len());
    for link in details.links {
        let (label, url) = (link.label.trim(), link.url.trim());
        if label.is_empty() || url.is_empty() {
            return Err(ReviewRefusal::BlankLink);
        }
        capped(label, "link label", MAX_LABEL)?;
        capped(url, "link URL", MAX_URL)?;
        if !is_web_url(url) {
            return Err(ReviewRefusal::BadUrl(url.to_string()));
        }
        links.push(ReviewLink {
            label: label.to_string(),
            url: url.to_string(),
        });
    }
    let hand_tests: Vec<String> = details
        .hand_tests
        .iter()
        .map(|test| test.trim())
        .filter(|test| !test.is_empty())
        .map(str::to_string)
        .collect();
    if hand_tests.len() > MAX_HAND_TESTS {
        return Err(ReviewRefusal::TooMany {
            what: "hand tests",
            max: MAX_HAND_TESTS,
        });
    }
    for test in &hand_tests {
        capped(test, "hand test", MAX_HAND_TEST)?;
    }
    Ok((
        title.to_string(),
        summary.to_string(),
        ReviewDetails { links, hand_tests },
    ))
}

/// A review exists only on an agentic wait.
pub fn require_agentic(agentic: bool, is_review: bool) -> Result<(), ReviewRefusal> {
    if is_review && !agentic {
        return Err(ReviewRefusal::NotAgentic);
    }
    Ok(())
}

/// Whether the Task a review is raised under is held by an agent: On Agent, or already Review.
pub fn require_held(status: &Status) -> Result<(), ReviewRefusal> {
    match status {
        Status::Agentic(AgenticStatus::OnAgent | AgenticStatus::Review) => Ok(()),
        _ => Err(ReviewRefusal::TaskNotHeld),
    }
}

/// Refuses an **agent** releasing an agentic question or review that is already released: the
/// user's answer is never overwritten, and releasing twice is a mistake worth saying out loud. A
/// wait on something else (CI) is idempotent and passes.
pub fn require_open_for_agent_release(wait: &Expectation) -> Result<(), ReviewRefusal> {
    if wait.agentic && wait.question && wait.status == ExpectationStatus::Released {
        return Err(ReviewRefusal::AlreadyReleased);
    }
    Ok(())
}

/// Whether `wait` is an open agentic question — pending, live, raised by an agent as a question —
/// hanging directly under a Task.
pub fn is_open_question(wait: &Expectation) -> bool {
    wait.parent_type == "task"
        && wait.agentic
        && wait.question
        && wait.status == ExpectationStatus::Pending
        && wait.archival == ExpectationArchival::Live
}

/// Turns every On Agent Task in `tasks` with an open question beneath it, among `waits`, into
/// Review.
pub fn derive(tasks: &mut [Task], waits: &[Expectation]) {
    let asking: HashSet<&NodeId> = waits
        .iter()
        .filter(|wait| is_open_question(wait))
        .map(|wait| &wait.parent_id)
        .collect();
    for task in tasks.iter_mut() {
        if task.status == Status::Agentic(AgenticStatus::OnAgent) && asking.contains(&task.id) {
            task.status = Status::Agentic(AgenticStatus::Review);
        }
    }
}

#[cfg(test)]
mod tests;
