//! The List View's answer: one flat row, judged against the filter and its own ancestor chain.
//!
//! The Mindmap gets subtree gating from pruning — drop a node and its descendants go with it. A
//! flat list has no tree to prune, so each rule that gates a subtree is asked of the row's
//! ancestors explicitly here. Everything else is the same predicate the Mindmap uses, from
//! [`rules`](super::rules).

use std::borrow::Cow;

use super::{
    model::{BoardFilter, NodeFacts, NodeKind, Preset},
    rules,
};

/// One flattened row: the node, and every ancestor from the outermost in.
#[derive(Debug, Clone, Copy)]
pub struct Row<'a> {
    /// What the filter reads off the row's own node.
    pub node: &'a NodeFacts,
    /// Every ancestor, outermost first and immediate parent last.
    pub ancestors: &'a [NodeFacts],
}

impl<'a> Row<'a> {
    /// A row with its chain.
    pub fn new(node: &'a NodeFacts, ancestors: &'a [NodeFacts]) -> Self {
        Self { node, ancestors }
    }

    /// Whether any ancestor is marked private — outside Private Mode the subtree hides as a unit
    /// even when the row itself is not flagged.
    fn has_private_ancestor(&self) -> bool {
        self.ancestors.iter().any(|a| a.is_private)
    }

    /// Whether any ancestor gates the whole subtree beneath it under this filter.
    fn has_gating_ancestor(&self, filter: &BoardFilter) -> bool {
        self.ancestors.iter().any(|ancestor| {
            rules::is_shelved_project(ancestor, filter)
                || rules::is_hidden_backlog(ancestor, filter)
                || rules::is_unopened_occurrence(ancestor, filter)
        })
    }
}

/// Whether one Task row survives the filter.
///
/// Under [`BoardFilter::unblock`] the preset does not answer at all: the row predicate is
/// `blocked` and nothing else, and the hard-hide runs under the neutralised filter from
/// [`unblock_filter`]. Everything that is not a preset rule — tags, the Info/Flow/Private
/// toggles, the Archived and Backlog pills — still applies.
pub fn passes_row(row: Row<'_>, filter: &BoardFilter) -> bool {
    // The Expectations option shows waits and nothing else.
    if filter.expectations && !filter.unblock {
        return false;
    }
    let effective: Cow<'_, BoardFilter> = if filter.unblock {
        Cow::Owned(unblock_filter(filter))
    } else {
        Cow::Borrowed(filter)
    };
    if rules::type_hard_hidden(row.node, &effective) {
        return false;
    }
    if !filter.private_mode && row.has_private_ancestor() {
        return false;
    }
    if filter.unblock {
        if !rules::is_blocked(row.node) {
            return false;
        }
    } else if !passes_row_preset(row, filter) {
        return false;
    }
    rules::passes_tags(row.node, filter)
}

/// The filter as Unblock reads it: the same tags, Info/Flow/Private toggles and Archived/Backlog
/// pills, with the status preset neutralised to [`Preset::All`].
///
/// Unblock is not a sixth preset combined with the one already set — the List View's dropdown holds
/// a single value, and picking Unblock *is* the whole question ("what is blocking me?"). The preset
/// left in the filter belongs to the Mindmap, which keeps it, and it must not answer here:
/// [`rules::type_hard_hidden`] under [`Preset::Start`] drops a blocked node together with its
/// subtree, which is precisely the set Unblock exists to show, so reading it left Unblock-over-Start
/// an empty list. Mirrors `unblockSharedFilter` in `src/utils/list-filter.ts`.
fn unblock_filter(filter: &BoardFilter) -> BoardFilter {
    BoardFilter {
        preset: Preset::All,
        ..filter.clone()
    }
}

/// The status preset, asked of a flat row.
///
/// The preset's own verdict is [`rules::passes_status`], unchanged — the same call the Mindmap
/// makes. What a list has to add is the three subtree gates it cannot get from pruning: a shelved
/// Project, a backlogged Task or an unopened Habit occurrence above the row, and, under Start, a
/// blocked ancestor. A row's ancestors also carry the Backlog preset's "and everything beneath
/// it", which the tree walk would otherwise have accumulated on the way down.
fn passes_row_preset(row: Row<'_>, filter: &BoardFilter) -> bool {
    if row.has_gating_ancestor(filter) {
        return false;
    }
    if filter.preset == Preset::Start
        && (rules::is_blocked(row.node) || row.ancestors.iter().any(rules::is_blocked))
    {
        return false;
    }
    let under_backlog = row.ancestors.iter().any(|ancestor| ancestor.backlogged);
    rules::passes_status(row.node, filter, rules::UNSET_STATUS, under_backlog)
}

/// Whether one Commitment row survives the filter, for the section above the task rows.
///
/// Only the rules a Commitment can answer are applied. A Task-status or Blocked filter is not
/// *failed* by a Commitment, it simply does not apply to one, so asking to see in-progress tasks
/// does not empty the band.
///
/// Two presets empty it outright: **Unblock**, because a Commitment is never blocked, and
/// **Backlog**, because a Commitment has no Backlog state to be in.
///
/// The ancestor walk is literally the task rows' — `Row::has_gating_ancestor`, shared so the two
/// cannot drift apart. A Commitment hangs off the same tree, so a branch hidden as a whole subtree
/// (a shelved Project, a backlogged Task, an unopened Habit occurrence) takes the commitments
/// inside it with it; a band still showing one from a branch the list has dropped would be
/// describing a different board.
///
/// The Archived pill applies here under every preset, Do included: `Include` force-shows an
/// archived Commitment through [`rules::with_archived_override`], as `docs/spec/mindmap-view.md`
/// says it does.
pub fn passes_commitment_row(row: Row<'_>, filter: &BoardFilter) -> bool {
    if filter.unblock || filter.expectations || filter.preset == Preset::Backlog {
        return false;
    }
    if rules::type_hard_hidden(row.node, filter) {
        return false;
    }
    if !filter.private_mode && row.has_private_ancestor() {
        return false;
    }
    if row.has_gating_ancestor(filter) {
        return false;
    }
    if !rules::with_archived_override(
        row.node,
        filter,
        rules::passes_commitment_preset(row.node, filter),
    ) {
        return false;
    }
    rules::passes_tags(row.node, filter)
}

/// Whether one Expectation row survives the filter, in the band or among the rows.
///
/// Under **Unblock** there are none: a wait is never blocked. Under the List View's own
/// **Expectations** option the preset does not answer — as under Unblock, the hard-hide runs under
/// the neutralised filter — and the row shows exactly when it is pending and not archived.
/// Otherwise it answers [`rules::passes_expectation_preset`], with the same subtree gates the
/// task rows and the commitments answer, so a branch the list has dropped takes its waits with it.
///
/// Only Antecedent-style narrowing and tags are left to the caller's pills; a wait has no tags,
/// so the tag predicate passes it.
pub fn passes_expectation_row(row: Row<'_>, filter: &BoardFilter) -> bool {
    if filter.unblock {
        return false;
    }
    if filter.expectations {
        let neutral = unblock_filter(filter);
        return !rules::type_hard_hidden(row.node, &neutral)
            && (filter.private_mode || !row.has_private_ancestor())
            && rules::is_live_expectation(row.node)
            && rules::passes_tags(row.node, filter);
    }
    if rules::type_hard_hidden(row.node, filter) {
        return false;
    }
    if !filter.private_mode && row.has_private_ancestor() {
        return false;
    }
    if row.has_gating_ancestor(filter) {
        return false;
    }
    rules::with_archived_override(
        row.node,
        filter,
        rules::passes_expectation_preset(row.node, filter),
    ) && rules::passes_tags(row.node, filter)
}

/// One row of a flattened board, owning its chain — what [`flatten`] produces.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnedRow {
    /// The row's own node.
    pub node: NodeFacts,
    /// Every ancestor, outermost first.
    pub ancestors: Vec<NodeFacts>,
}

impl OwnedRow {
    /// Borrows this row for the predicates.
    pub fn as_row(&self) -> Row<'_> {
        Row::new(&self.node, &self.ancestors)
    }
}

/// Flattens a fact tree to one row per node of `kind`, in the order the board draws them.
///
/// `root` frames the list rather than appearing in it: it is neither a row nor an ancestor, which
/// is how the true root — and, once one has been entered, a subtree root — stays out of every
/// row's chain.
pub fn flatten(root: &super::tree::FactNode, kind: NodeKind) -> Vec<OwnedRow> {
    let mut rows = Vec::new();
    let mut chain = Vec::new();
    for child in &root.children {
        visit(child, kind, &mut chain, &mut rows);
    }
    rows
}

fn visit(
    node: &super::tree::FactNode,
    kind: NodeKind,
    chain: &mut Vec<NodeFacts>,
    rows: &mut Vec<OwnedRow>,
) {
    if node.facts.kind == kind {
        rows.push(OwnedRow {
            node: node.facts.clone(),
            ancestors: chain.clone(),
        });
    }
    chain.push(node.facts.clone());
    for child in &node.children {
        visit(child, kind, chain, rows);
    }
    chain.pop();
}

#[cfg(test)]
mod tests;
