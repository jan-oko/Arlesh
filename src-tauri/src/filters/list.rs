//! The List View's answer: one flat row, judged against the filter and its own ancestor chain.
//!
//! The Mindmap gets subtree gating from pruning — drop a node and its descendants go with it. A
//! flat list has no tree to prune, so each rule that gates a subtree is asked of the row's
//! ancestors explicitly here. Everything else is the same predicate the Mindmap uses, from
//! [`rules`](super::rules).

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
/// # Divergence from the specification
///
/// `docs/spec/list-view.md` says Unblock "shows every blocked task". It does not replace the
/// status preset — picking it leaves the shared preset alone — and this reproduces that: when
/// [`BoardFilter::unblock`] is set, the preset's own row predicate is skipped but
/// [`rules::type_hard_hidden`] still runs under `preset`. Under `Preset::Start` that hard-hides
/// every blocked node, so `preset = start, unblock = true` shows **nothing** where the
/// specification promises every blocked task. The frontend behaves exactly this way today, which
/// is why it is reproduced rather than corrected here; splitting the preset out as a field of its
/// own is what makes it visible at all.
pub fn passes_row(row: Row<'_>, filter: &BoardFilter) -> bool {
    if rules::type_hard_hidden(row.node, filter) {
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
/// # Divergences from the specification
///
/// Two, both reproduced from the shipped frontend rather than adopted as rules:
///
/// - The band walks its ancestors for a shelved Project and a backlogged Task, but **not** for an
///   unopened Habit occurrence, which `docs/spec/habits.md` says is hidden "together with its own
///   subtree". A Commitment under one therefore stays in the band while the Mindmap and the task
///   rows both drop it.
/// - `docs/spec/mindmap-view.md` says the Archived pill has no effect under Do. The
///   [`rules::with_archived_override`] below runs under every preset, so `Include` force-shows an
///   archived Commitment there.
pub fn passes_commitment_row(row: Row<'_>, filter: &BoardFilter) -> bool {
    if filter.unblock || filter.preset == Preset::Backlog {
        return false;
    }
    if rules::type_hard_hidden(row.node, filter) {
        return false;
    }
    if !filter.private_mode && row.has_private_ancestor() {
        return false;
    }
    if row.ancestors.iter().any(|ancestor| {
        rules::is_shelved_project(ancestor, filter) || rules::is_hidden_backlog(ancestor, filter)
    }) {
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
