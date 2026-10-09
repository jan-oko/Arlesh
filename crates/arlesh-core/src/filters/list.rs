//! The List View's answer: one flat row, judged against the filter and its own ancestor chain.
//!
//! The Mindmap gets subtree gating from pruning — drop a node and its descendants go with it. A
//! flat list has no tree to prune, so each rule that gates a subtree is asked of the row's
//! ancestors explicitly here. Everything else is the same predicate the Mindmap uses, from
//! [`rules`](super::rules).

use std::{borrow::Cow, collections::BTreeSet};

use crate::tasks::model::TimeScope;

use super::{
    model::{BoardFilter, NodeFacts, NodeKind, Preset, RowKind},
    pills::{self, RowChain},
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

    /// The row as the pills read it.
    fn chain(&self) -> RowChain<'a> {
        RowChain {
            node: self.node,
            ancestors: self.ancestors,
        }
    }

    /// Whether any ancestor is marked private — outside Private Mode the subtree hides as a unit
    /// even when the row itself is not flagged.
    fn has_private_ancestor(&self) -> bool {
        self.ancestors.iter().any(|a| a.is_private)
    }

    /// The nearest scoped ancestor's Time Scope — what an unscoped row inherits for the Plan
    /// preset's scope narrowing (see [`rules::is_outside_plan_scope`]).
    fn inherited_time_scope(&self) -> Option<&'a TimeScope> {
        self.ancestors
            .iter()
            .rev()
            .find_map(|ancestor| ancestor.time_scope.as_ref())
    }

    /// The gate the row's blocked ancestors set over it under Start, folded down its chain as the
    /// tree walk folds it (see [`rules::BlockGate`]).
    fn block_gate(&self, filter: &BoardFilter) -> rules::BlockGate<'a> {
        self.ancestors.iter().fold(None, |gate, ancestor| {
            rules::gate_below(ancestor, &gate, filter)
        })
    }

    /// Whether any ancestor gates the whole subtree beneath it under this filter.
    fn has_gating_ancestor(&self, filter: &BoardFilter) -> bool {
        self.ancestors.iter().any(|ancestor| {
            rules::is_shelved_container(ancestor, filter)
                || rules::is_hidden_backlog(ancestor, filter)
                || rules::is_unopened_occurrence(ancestor, filter)
                || rules::is_unopened_wait(ancestor, filter)
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
    if !filter.kinds.contains(&RowKind::Task) {
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
    rules::passes_tags(row.node, filter) && pills::task_passes(row.chain(), &filter.pills)
}

/// The filter as Unblock reads it: the same tags, Info/Flow/Private toggles and Archived/Backlog
/// pills, with the status preset neutralised to [`Preset::All`].
///
/// Unblock is not a sixth preset combined with the one already set — the List View's dropdown holds
/// a single value, and picking Unblock *is* the whole question ("what is blocking me?"). The preset
/// left in the filter belongs to the Mindmap, which keeps it, and it must not answer here:
/// [`Preset::Start`] drops a blocked node together with most of its subtree, which is precisely
/// the set Unblock exists to show, so reading it left Unblock-over-Start
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
/// makes. What a list has to add is the subtree gates it cannot get from pruning: a shelved
/// Project, a backlogged Task or an unopened Habit occurrence above the row, and, under Start, a
/// blocked ancestor (unless the row is one of its child dependencies, or under one) or a wait whose window has not begun (which is what hides its check task). A row's ancestors also carry the Backlog preset's "and everything beneath
/// it", and Start's inherited Plan, which the tree walk would otherwise have accumulated on the
/// way down.
fn passes_row_preset(row: Row<'_>, filter: &BoardFilter) -> bool {
    if row.has_gating_ancestor(filter) {
        return false;
    }
    // Blocked itself, or under a blocked ancestor whose block does not let it through as a child
    // dependency.
    if rules::is_held_by_block(row.node, &row.block_gate(filter), filter) {
        return false;
    }
    if rules::is_planned_ahead(row.node, filter) {
        return false;
    }
    if rules::is_outside_plan_scope(row.node, filter, row.inherited_time_scope()) {
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
/// Two presets empty it outright: **Unblock**, which lists work to unblock, and a Commitment's only
/// block — its Habit's cooldown — is not one anybody can act on; and **Backlog**, because a
/// Commitment has no Backlog state to be in. Under **Start**, a blocked Commitment drops out.
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
    if !filter.kinds.contains(&RowKind::Commitment) {
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
    // A Commitment blocked by its Habit's cooldown drops out of Start, as on the canvas.
    if filter.preset == Preset::Start && rules::is_blocked(row.node) {
        return false;
    }
    if !rules::with_archived_override(
        row.node,
        filter,
        rules::passes_commitment_preset(row.node, filter),
    ) {
        return false;
    }
    rules::passes_tags(row.node, filter) && pills::commitment_passes(row.chain(), &filter.pills)
}

/// Whether one Expectation row survives the filter, in the band or among the rows.
///
/// Under **Unblock** there are none: a wait is never blocked. Under the List View's own
/// **Expectations** option the preset does not answer — as under Unblock, the hard-hide runs under
/// the neutralised filter — and the row shows exactly when it is pending and not archived.
/// Otherwise it answers [`rules::passes_expectation_preset`], with the same subtree gates the
/// task rows and the commitments answer, so a branch the list has dropped takes its waits with it.
///
/// Of the pills, a wait answers Under, Scope and Private (see [`pills::expectation_passes`]).
pub fn passes_expectation_row(row: Row<'_>, filter: &BoardFilter) -> bool {
    if filter.unblock {
        return false;
    }
    if filter.expectations {
        let neutral = unblock_filter(filter);
        return !rules::type_hard_hidden(row.node, &neutral)
            && (filter.private_mode || !row.has_private_ancestor())
            && rules::is_live_expectation(row.node)
            && rules::passes_tags(row.node, filter)
            && pills::expectation_passes(row.chain(), &filter.pills);
    }
    // The Expectations option is itself the kind choice, so the selector answers only outside it.
    if !filter.kinds.contains(&RowKind::Expectation) {
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
    rules::with_archived_override(
        row.node,
        filter,
        rules::passes_expectation_preset(row.node, filter),
    ) && rules::passes_tags(row.node, filter)
        && pills::expectation_passes(row.chain(), &filter.pills)
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
    flatten_forest(&root.children, kind)
}

/// Flattens a fact tree to one row per node of any of `kinds`, mixed, in the order the board
/// draws them — what the List View draws when Commitments and waits sit among the Task rows.
/// `root` frames the list, as in [`flatten`].
pub fn flatten_kinds(root: &super::tree::FactNode, kinds: &[NodeKind]) -> Vec<OwnedRow> {
    let mut rows = Vec::new();
    let mut chain = Vec::new();
    for child in &root.children {
        visit(child, kinds, &mut chain, &mut rows);
    }
    rows
}

/// Flattens a forest to one row per node of `kind`. Unlike [`flatten`], each tree's root is
/// content: a row, or an ancestor of the rows beneath it.
pub fn flatten_forest(forest: &[super::tree::FactNode], kind: NodeKind) -> Vec<OwnedRow> {
    let mut rows = Vec::new();
    let mut chain = Vec::new();
    for tree in forest {
        visit(tree, &[kind], &mut chain, &mut rows);
    }
    rows
}

/// One row kind's predicate: [`passes_row`], [`passes_commitment_row`] or
/// [`passes_expectation_row`].
type RowPredicate = fn(Row<'_>, &BoardFilter) -> bool;

/// The node ids the List View keeps from `forest` under `filter`: every Task, Commitment and
/// Expectation row that passes, and every ancestor of one, so each row arrives with the path it
/// hangs from — which is what the List View's path header names.
pub fn kept_ids_in_forest(
    forest: &[super::tree::FactNode],
    filter: &BoardFilter,
) -> BTreeSet<String> {
    let predicates: [(NodeKind, RowPredicate); 3] = [
        (NodeKind::Task, passes_row),
        (NodeKind::Commitment, passes_commitment_row),
        (NodeKind::Expectation, passes_expectation_row),
    ];
    let mut kept = BTreeSet::new();
    for (kind, passes) in predicates {
        for row in flatten_forest(forest, kind) {
            if !passes(row.as_row(), filter) {
                continue;
            }
            kept.extend(row.ancestors.into_iter().map(|ancestor| ancestor.id));
            kept.insert(row.node.id);
        }
    }
    kept
}

fn visit(
    node: &super::tree::FactNode,
    kinds: &[NodeKind],
    chain: &mut Vec<NodeFacts>,
    rows: &mut Vec<OwnedRow>,
) {
    if kinds.contains(&node.facts.kind) {
        rows.push(OwnedRow {
            node: node.facts.clone(),
            ancestors: chain.clone(),
        });
    }
    chain.push(node.facts.clone());
    for child in &node.children {
        visit(child, kinds, chain, rows);
    }
    chain.pop();
}

#[cfg(test)]
mod tests;
