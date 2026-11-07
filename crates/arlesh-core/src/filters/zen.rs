//! What the Zen View draws: its grid of Task cards and its two strips, read out of the List View's
//! rows.
//!
//! The focus exemption — the selected card kept on screen whatever the filter says — is a
//! render-time overlay on the view's own selection, not a rule, and stays with the frontend. Mirrors
//! `src/utils/zen-contents.ts`; `conformance/zen-contents.json` holds the two together.

use std::collections::HashSet;

use super::{
    list::{self, OwnedRow},
    model::{BoardFilter, ListPills, Pill, Preset, RowKind},
};

/// The preset the Zen View's grid and Commitments strip read: what is being worked on now.
pub const ZEN_PRESET: Preset = Preset::Do;

/// What a tab asks of the Zen View besides the shared filter.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ZenOptions {
    /// Whether the Commitments strip is shown.
    pub commitments: bool,
    /// Whether the Expectations strip is shown.
    pub expectations: bool,
    /// The tab's **Agentic** pill — the one List View pill the Zen View reads.
    pub agentic: Vec<Pill>,
    /// The app-wide *Show Started tasks on the grid* setting, read in place of Do's own.
    pub shows_started: bool,
    /// The app-wide *Show compound tasks on the grid* setting. Off, a Compound Task's card is not
    /// drawn; its sub-items still are, by their own status.
    pub shows_compound: bool,
}

/// What the Zen View draws, each part in the order it is drawn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZenContents<'a> {
    /// The grid's cards.
    pub tasks: Vec<&'a OwnedRow>,
    /// The Commitments strip; empty while hidden.
    pub commitments: Vec<&'a OwnedRow>,
    /// The Expectations strip; empty while hidden.
    pub expectations: Vec<&'a OwnedRow>,
}

/// The List View's own rows, unfiltered, which the Zen View is read out of.
#[derive(Debug, Clone, Copy)]
pub struct ZenSource<'a> {
    /// The Task rows, in board order.
    pub tasks: &'a [OwnedRow],
    /// The Commitment rows.
    pub commitments: &'a [OwnedRow],
    /// The Expectation rows.
    pub expectations: &'a [OwnedRow],
}

/// `filter` as the Zen View asks it under `preset`: every row kind, no List View option, and of
/// the List View's pills the Agentic one alone — the one the Zen View's Filter menu offers. A pill
/// this view's menu cannot show must not narrow it.
fn under(filter: &BoardFilter, preset: Preset, agentic: &[Pill]) -> BoardFilter {
    BoardFilter {
        preset,
        unblock: false,
        expectations: false,
        kinds: RowKind::ALL.to_vec(),
        pills: ListPills {
            agentic: agentic.to_vec(),
            ..ListPills::default()
        },
        ..filter.clone()
    }
}

/// Whether a Task row is a **Review** card: an Agentic Task whose agent has a question open.
fn is_review(row: &OwnedRow) -> bool {
    row.node.agentic && row.node.status_str() == "review"
}

/// Whether a Task row reads In Progress (Doing, for an Agentic one).
fn is_in_progress(row: &OwnedRow) -> bool {
    matches!(row.node.status_str(), "in_progress" | "doing")
}

/// The grid less every card that reads In Progress **only from its sub-items** while an In Progress
/// item beneath it is drawn on the grid too: the card that is being worked on shows anyway, and its
/// parent says nothing more. A parent set In Progress by hand stays, and so does one whose
/// In Progress sub-item the grid does not draw (private, delegated, filtered out) — work never
/// leaves the grid that way.
fn without_derived_parents(grid: Vec<&OwnedRow>) -> Vec<&OwnedRow> {
    let drawn_below: HashSet<&str> = grid
        .iter()
        .filter(|row| is_in_progress(row))
        .flat_map(|row| row.ancestors.iter().map(|ancestor| ancestor.id.as_str()))
        .collect();
    grid.iter()
        .copied()
        .filter(|row| !(row.node.derived_in_progress && drawn_below.contains(row.node.id.as_str())))
        .collect()
}

/// The Zen View's contents, from the List View's rows.
///
/// - **The grid** is the Task rows under **Do**, in board order, with **Review** cards first —
///   each one an agent idle until the user answers — less every **delegated** Task, which someone
///   else holds, and less every **Compound** one unless `shows_compound`. Whether a **Started**
///   Task counts is `shows_started`, not the Do preset's own setting; a **Review** one shows only
///   while the filter's [`BoardFilter::show_review`] asks for it. A card that reads In Progress
///   only from its sub-items is dropped while an In Progress item beneath it is drawn
///   ([`without_derived_parents`]).
/// - **The Commitments strip** is what the List View shows under Do: the unresolved ones.
/// - **The Expectations strip** is what **Start** shows — Do shows no wait at all — less every
///   wait an agent raised: a question is drawn on its Review card, and a wait on something else is
///   the agent's own business.
///
/// Everything else in `filter` applies unchanged. A hidden strip is empty.
pub fn contents<'a>(
    source: ZenSource<'a>,
    filter: &BoardFilter,
    options: &ZenOptions,
) -> ZenContents<'a> {
    let under_do = BoardFilter {
        do_shows_started: options.shows_started,
        ..under(filter, ZEN_PRESET, &options.agentic)
    };
    let grid: Vec<&OwnedRow> = source
        .tasks
        .iter()
        .filter(|row| list::passes_row(row.as_row(), &under_do))
        .filter(|row| options.shows_compound || !row.node.compound)
        .filter(|row| !row.node.delegated)
        .filter(|row| filter.show_review || !is_review(row))
        .collect();
    let grid = without_derived_parents(grid);
    let (mut tasks, rest): (Vec<_>, Vec<_>) = grid.into_iter().partition(|row| is_review(row));
    tasks.extend(rest);

    let commitments = if options.commitments {
        source
            .commitments
            .iter()
            .filter(|row| list::passes_commitment_row(row.as_row(), &under_do))
            .collect()
    } else {
        Vec::new()
    };
    let under_start = under(filter, Preset::Start, &options.agentic);
    let expectations = if options.expectations {
        source
            .expectations
            .iter()
            .filter(|row| list::passes_expectation_row(row.as_row(), &under_start))
            .filter(|row| !row.node.agent_waiting)
            .collect()
    } else {
        Vec::new()
    };
    ZenContents {
        tasks,
        commitments,
        expectations,
    }
}

#[cfg(test)]
mod tests;
