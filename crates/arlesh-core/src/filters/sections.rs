//! The List View's lifted sections: which rows move to the top of the list, and when each
//! section is drawn.
//!
//! A section is a partition, not a sort: a row is **moved** into it, never duplicated, and every
//! part keeps the pre-order its rows arrived in. Path headers and the markers that bracket a section
//! are drawing, and stay with the frontend. Mirrors `src/utils/list-sections.ts`;
//! `conformance/list-sections.json` holds the two together.

use std::collections::HashSet;

use super::{
    list::OwnedRow,
    model::{BoardFilter, NodeKind, Preset},
};

/// One of the List View's lifted sections, in the order they are drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Section {
    /// Agentic Tasks whose agent has a question open: each idles an agent, so it leads.
    Review,
    /// Late work: every Overdue row.
    Overdue,
    /// Work that starts a wait: every Asynchronous Task.
    Asynchronous,
}

impl Section {
    /// Every section, in the order they claim rows and are drawn.
    pub const ALL: [Self; 3] = [Self::Review, Self::Overdue, Self::Asynchronous];

    /// Whether `row` belongs to this section by its own right, rather than by hanging under a row
    /// that does.
    ///
    /// Only a Task reads Review or is Asynchronous. A Task or a wait is claimed by its own Overdue
    /// flag; a Commitment is never Overdue, so it rides up only under an Overdue row.
    pub fn claims(self, row: &OwnedRow) -> bool {
        let node = &row.node;
        match self {
            Self::Review => {
                node.kind == NodeKind::Task && node.agentic && node.status_str() == "review"
            }
            Self::Overdue => node.overdue,
            Self::Asynchronous => node.kind == NodeKind::Task && node.asynchronous,
        }
    }
}

/// Which sections to draw. The caller decides from the filter and the settings (see
/// [`shows_review`] and [`shows_overdue`]); the partition only follows.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Sections {
    /// The Review section.
    pub review: bool,
    /// The Overdue section.
    pub overdue: bool,
    /// The Asynchronous section — opt-in, off by default.
    pub asynchronous: bool,
}

impl Sections {
    /// Whether `section` is drawn.
    pub fn draws(self, section: Section) -> bool {
        match section {
            Section::Review => self.review,
            Section::Overdue => self.overdue,
            Section::Asynchronous => self.asynchronous,
        }
    }
}

/// The rows, partitioned: each drawn section that holds anything, in order, and what is left below.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Partition<'a> {
    /// The sections that hold a row, each with its rows in pre-order. A section with nothing in it
    /// is left out, so it draws no heading.
    pub sections: Vec<(Section, Vec<&'a OwnedRow>)>,
    /// The ordinary list: every row no section took, in pre-order.
    pub rest: Vec<&'a OwnedRow>,
}

/// Partitions `rows` — in pre-order, already filtered — into the drawn sections and the rest.
///
/// A row is lifted when its section claims it, or when any ancestor of it has been lifted into that
/// section, so a subtree moves whole. The ancestor chain is consulted rather than the parent, so a
/// row still follows its lifted ancestor when the rows between them were filtered out. Sections claim
/// in order, and what one has taken is not offered to the next: a row both Overdue and Asynchronous
/// goes to Overdue.
pub fn partition(rows: &[OwnedRow], sections: Sections) -> Partition<'_> {
    let mut remaining: Vec<&OwnedRow> = rows.iter().collect();
    let mut drawn = Vec::new();
    for section in Section::ALL {
        if !sections.draws(section) {
            continue;
        }
        let (lifted, rest) = split(remaining, section);
        remaining = rest;
        if !lifted.is_empty() {
            drawn.push((section, lifted));
        }
    }
    Partition {
        sections: drawn,
        rest: remaining,
    }
}

/// The rows `section` lifts, and the rest, each in the order they arrived.
fn split(rows: Vec<&OwnedRow>, section: Section) -> (Vec<&OwnedRow>, Vec<&OwnedRow>) {
    let mut lifted_ids: HashSet<&str> = HashSet::new();
    let mut lifted = Vec::new();
    let mut rest = Vec::new();
    for row in rows {
        let rides_up = section.claims(row)
            || row
                .ancestors
                .iter()
                .any(|ancestor| lifted_ids.contains(ancestor.id.as_str()));
        if rides_up {
            lifted_ids.insert(row.node.id.as_str());
            lifted.push(row);
        } else {
            rest.push(row);
        }
    }
    (lifted, rest)
}

/// Whether the list's own question is the preset's, rather than the Unblock or Expectations
/// option's, which replace it.
fn reads_the_preset(filter: &BoardFilter) -> bool {
    !filter.unblock && !filter.expectations
}

/// Whether the List View draws its **Review** section: whenever it reads **Start** or **Do** — the
/// two that show Review — and not under the Unblock or Expectations option. No setting switches it.
pub fn shows_review(filter: &BoardFilter) -> bool {
    matches!(filter.preset, Preset::Start | Preset::Do) && reads_the_preset(filter)
}

/// Whether the List View draws its **Overdue** section: while its setting (`enabled`, on by
/// default) is on, and only under **Start**, the preset that asks what to begin now — and not under
/// the Unblock or Expectations option.
pub fn shows_overdue(enabled: bool, filter: &BoardFilter) -> bool {
    enabled && filter.preset == Preset::Start && reads_the_preset(filter)
}

#[cfg(test)]
mod tests;
