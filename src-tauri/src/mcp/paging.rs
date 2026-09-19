//! Splitting a snapshot across tool results.
//!
//! A real board does not fit in one MCP tool result: 141 tasks and 162 domains came to 122,238
//! characters, well past what a client will accept. So the payload is walked in pages.
//!
//! The shape does not change. A page carries the same section names and the same item shapes the
//! whole payload always had — it simply carries fewer of them, and never splits an item across a
//! boundary, so nothing has to be reassembled from two responses.
//!
//! Sections absent from a page are **omitted**, never sent as `[]`. The two must stay
//! distinguishable: `[]` means the section was fetched and is genuinely empty, and an agent that
//! could not tell the difference would conclude a board has no tasks when it has merely not paged
//! to them yet.

use serde_json::Value;
use thiserror::Error;

/// Why a page could not be produced. Always the caller's doing — a cursor it made up, or one it
/// held across a change to the board.
#[derive(Debug, Error)]
pub enum PagingError {
    /// A cursor that is not the `section:offset` a page hands out.
    #[error("cursor \"{cursor}\" is not usable: {why}")]
    UnreadableCursor {
        /// The cursor as given.
        cursor: String,
        /// What is wrong with it.
        why: String,
    },
    /// A cursor into a section this request did not ask for.
    #[error("cursor names section \"{section}\", which this request did not ask for")]
    SectionNotRequested {
        /// The section the cursor named.
        section: &'static str,
    },
    /// A cursor further into a section than it now reaches.
    #[error(
        "cursor \"{cursor}\" is past the end of \"{section}\", which now holds {held} items; \
         the board changed between pages, so start again"
    )]
    CursorPastEnd {
        /// The cursor as given.
        cursor: String,
        /// The section it named.
        section: &'static str,
        /// How many items that section holds now.
        held: usize,
    },
}

/// How many characters of serialized items one page may carry.
///
/// Chosen well under the limit that the 122k payload broke, and deliberately not a tuning knob:
/// an agent has no way to know its own client's ceiling, so guessing at it is not a choice worth
/// offering.
pub const PAGE_BUDGET: usize = 40_000;

/// One array of [`MindmapLoad`](crate::mindmap::model::MindmapLoad), by its serialized name.
///
/// The variants are the payload's fields, in the order a page walks them. `SECTIONS` is the whole
/// set, and a test pins it against the payload's own keys so a field added there cannot silently
/// go unpaged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Section {
    /// Aspects, projects, domains and tags.
    Domains,
    /// Goals.
    Goals,
    /// Tasks.
    Tasks,
    /// Commitments — rules held over a window, with their recorded verdicts.
    Commitments,
    /// Notes.
    Infos,
    /// Flows.
    Flows,
    /// Goals belonging to a flow.
    FlowGoals,
    /// Tasks belonging to a flow.
    FlowTasks,
    /// Cycles among flow items.
    FlowCycles,
    /// Dependencies among flow items.
    FlowDependencies,
    /// Explicit block reasons.
    BlockReasons,
    /// Dependency edges between tasks.
    TaskDependencies,
    /// Nodes materialised by starting a flow.
    FlowInstanceNodes,
    /// Each item's derived Timing / Resolution / Archival state.
    Lifecycles,
    /// Each flow's habit iterations and statuses.
    Habits,
}

/// Every section, in the order pages walk them.
pub const SECTIONS: [Section; 15] = [
    Section::Domains,
    Section::Goals,
    Section::Tasks,
    Section::Commitments,
    Section::Infos,
    Section::Flows,
    Section::FlowGoals,
    Section::FlowTasks,
    Section::FlowCycles,
    Section::FlowDependencies,
    Section::BlockReasons,
    Section::TaskDependencies,
    Section::FlowInstanceNodes,
    Section::Lifecycles,
    Section::Habits,
];

impl Section {
    /// The payload's field name for this section.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Domains => "domains",
            Self::Goals => "goals",
            Self::Tasks => "tasks",
            Self::Commitments => "commitments",
            Self::Infos => "infos",
            Self::Flows => "flows",
            Self::FlowGoals => "flow_goals",
            Self::FlowTasks => "flow_tasks",
            Self::FlowCycles => "flow_cycles",
            Self::FlowDependencies => "flow_dependencies",
            Self::BlockReasons => "block_reasons",
            Self::TaskDependencies => "task_dependencies",
            Self::FlowInstanceNodes => "flow_instance_nodes",
            Self::Lifecycles => "lifecycles",
            Self::Habits => "habits",
        }
    }

    /// The section a cursor names, or `None` if it names nothing.
    fn parse(name: &str) -> Option<Self> {
        SECTIONS.into_iter().find(|section| section.as_str() == name)
    }
}

/// Where a page starts: a section, and how far into it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cursor {
    /// The section to resume in.
    pub section: Section,
    /// How many of that section's items earlier pages already carried.
    pub offset: usize,
}

impl Cursor {
    /// The cursor a first page starts from.
    pub fn start(sections: &[Section]) -> Option<Self> {
        sections.first().map(|&section| Self {
            section,
            offset: 0,
        })
    }

    /// Reads the `section:offset` form a previous page handed out.
    ///
    /// Rejects rather than guesses: a cursor naming an unknown section, or carrying an unparseable
    /// offset, is a caller error and returning some other page for it would be worse than saying
    /// so.
    pub fn parse(raw: &str) -> Result<Self, PagingError> {
        let rejected = |why: String| PagingError::UnreadableCursor {
            cursor: raw.to_string(),
            why,
        };
        let (name, offset) = raw
            .split_once(':')
            .ok_or_else(|| rejected("expected the form \"section:offset\"".to_string()))?;
        let section =
            Section::parse(name).ok_or_else(|| rejected(format!("\"{name}\" is not a section")))?;
        let offset = offset
            .parse()
            .map_err(|_| rejected(format!("\"{offset}\" is not a whole number")))?;
        Ok(Self { section, offset })
    }

    /// The `section:offset` form handed to the caller.
    pub fn as_token(self) -> String {
        format!("{}:{}", self.section.as_str(), self.offset)
    }
}

/// A section's items, already serialized so their size is known.
pub struct SectionItems {
    /// Which section these belong to.
    pub section: Section,
    /// The items, in payload order.
    pub items: Vec<Value>,
}

/// What one page carries, and where the next one starts.
pub struct Page {
    /// The sections in this page, each with the items it carries.
    pub sections: Vec<(Section, Vec<Value>)>,
    /// Where to resume, or `None` when the payload is exhausted.
    pub next: Option<Cursor>,
}

/// Fills one page from `cursor`, taking whole items until the budget is spent.
///
/// Walks `available` in order. A section is entered even when empty, so the caller learns it is
/// empty rather than merely unvisited.
///
/// **An over-budget item is still emitted**, alone, rather than skipped: a page that carried
/// nothing would hand back the cursor it was given, and the caller would ask for the same page
/// forever.
pub fn take_page(
    available: &[SectionItems],
    cursor: Cursor,
    budget: usize,
) -> Result<Page, PagingError> {
    let start = available
        .iter()
        .position(|held| held.section == cursor.section)
        .ok_or(PagingError::SectionNotRequested {
            section: cursor.section.as_str(),
        })?;

    let held = available[start].items.len();
    if cursor.offset > held {
        return Err(PagingError::CursorPastEnd {
            cursor: cursor.as_token(),
            section: cursor.section.as_str(),
            held,
        });
    }

    let mut sections = Vec::new();
    let mut spent = 0usize;

    for (position, held) in available.iter().enumerate().skip(start) {
        let from = if position == start { cursor.offset } else { 0 };
        let mut taken = Vec::new();

        for (index, item) in held.items.iter().enumerate().skip(from) {
            let size = item.to_string().len();
            let nothing_taken_yet = sections.is_empty() && taken.is_empty();
            if spent + size > budget && !nothing_taken_yet {
                sections.push((held.section, taken));
                return Ok(Page {
                    sections,
                    next: Some(Cursor {
                        section: held.section,
                        offset: index,
                    }),
                });
            }
            spent += size;
            taken.push(item.clone());
        }

        sections.push((held.section, taken));
    }

    Ok(Page {
        sections,
        next: None,
    })
}

#[cfg(test)]
mod tests;
