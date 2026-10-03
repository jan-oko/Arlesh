//! The List View's own pills: which values a row answers each dimension with, and how a group of
//! pills judges them.
//!
//! A pill group combines as a tag filter does — `(∪Any) ∧ (∩All) ∧ ¬(∪Exclude)` — and a dimension
//! with no pill narrows nothing. What differs per dimension is only the values a row offers it:
//! its ancestors' ids, its dependency targets, a status, the Scope tokens, or the yes/no flags.
//! Mirrors `src/utils/list-filter.ts`, and `conformance/preset-filters.json` holds the two together.

use crate::tasks::model::Verdict;

use super::{
    model::{ListPills, NodeFacts, NodeKind, Pill, TagMode},
    rules,
};

/// Whether `values` pass the pill group `pills`: some Any pill's value is among them, if there is
/// an Any pill at all; every All pill's is; and no Exclude pill's is.
pub fn matches_group<'a>(pills: impl IntoIterator<Item = &'a Pill>, values: &[&str]) -> bool {
    let mut any_seen = false;
    let mut any_met = false;
    for pill in pills {
        let present = values.contains(&pill.value.as_str());
        match pill.mode {
            TagMode::Any => {
                any_seen = true;
                any_met |= present;
            }
            TagMode::All if !present => return false,
            TagMode::Exclude if present => return false,
            TagMode::All | TagMode::Exclude => {}
        }
    }
    !any_seen || any_met
}

/// A node's **Scope** tokens: one for where its own window stands, and one for whether it has a
/// Plan — two independent axes, so `unscoped` and `planned` can both apply.
///
/// The window token predates effective Archival and keeps its own reading: the Overdue flag wins,
/// since it is judged against the due rather than the window; an unscoped node reads `unscoped`;
/// a scoped one with a Timing reads `lapsed` only when its lapse settled it as Missed, and
/// `active` otherwise — a Completed one included. A scoped node with no Timing gives no window
/// token.
pub fn scope_state_tokens(node: &NodeFacts) -> Vec<&'static str> {
    let mut tokens = Vec::with_capacity(2);
    if node.overdue {
        tokens.push("overdue");
    } else if node.time_scope.is_none() {
        tokens.push("unscoped");
    } else if node.timing.is_some() {
        tokens.push(if node.missed { "lapsed" } else { "active" });
    }
    tokens.push(if node.planned { "planned" } else { "unplanned" });
    tokens
}

/// What a row reads off its chain: its own node, and every ancestor outermost first.
#[derive(Debug, Clone, Copy)]
pub struct RowChain<'a> {
    /// The row's own node.
    pub node: &'a NodeFacts,
    /// Every ancestor, outermost first and immediate parent last.
    pub ancestors: &'a [NodeFacts],
}

impl<'a> RowChain<'a> {
    /// The ids an **Under** pill matches: every ancestor's, at any depth and of any kind.
    fn ancestor_ids(&self) -> Vec<&'a str> {
        self.ancestors
            .iter()
            .map(|ancestor| ancestor.id.as_str())
            .collect()
    }

    /// The status of the nearest ancestor of `kind`, if there is one and it has a status.
    fn nearest_status(&self, kind: NodeKind) -> Vec<&'a str> {
        self.ancestors
            .iter()
            .rev()
            .find(|ancestor| ancestor.kind == kind)
            .and_then(|ancestor| ancestor.status.as_deref())
            .into_iter()
            .collect()
    }

    /// Whether the row is private: its node is marked so, or sits under one that is.
    fn is_private(&self) -> bool {
        self.node.is_private || self.ancestors.iter().any(|ancestor| ancestor.is_private)
    }

    /// The `private` flag token, if the row is private.
    fn private_token(&self) -> Vec<&'static str> {
        if self.is_private() {
            vec!["private"]
        } else {
            Vec::new()
        }
    }

    /// Whether the row passes the Under, Scope and Private pills — the three every kind answers.
    fn passes_common(&self, pills: &ListPills) -> bool {
        matches_group(&pills.antecedent, &self.ancestor_ids())
            && matches_group(&pills.scope_state, &scope_state_tokens(self.node))
    }
}

/// Whether a Task row passes every pill.
///
/// The four yes/no dimensions — Blocked, Agentic, Asynchronous, Private — are **one** group, so
/// an Any among them is an Any across them. Agentic reads the Task's status model, which follows
/// whether it reads as Agentic, its own flag or inherited.
pub fn task_passes(row: RowChain<'_>, pills: &ListPills) -> bool {
    let node = row.node;
    let dependencies: Vec<&str> = node.dependencies.iter().map(String::as_str).collect();
    let flags: Vec<&str> = [
        (rules::is_blocked(node), "blocked"),
        (node.agentic, "agentic"),
        (node.asynchronous, "asynchronous"),
        (row.is_private(), "private"),
    ]
    .into_iter()
    .filter_map(|(on, token)| on.then_some(token))
    .collect();
    let flag_pills = pills
        .blocked
        .iter()
        .chain(&pills.agentic)
        .chain(&pills.asynchronous)
        .chain(&pills.private);
    row.passes_common(pills)
        && matches_group(&pills.dependency, &dependencies)
        && matches_group(&pills.task_status, &[node.status_str()])
        && matches_group(&pills.goal_status, &row.nearest_status(NodeKind::Goal))
        && matches_group(
            &pills.project_status,
            &row.nearest_status(NodeKind::Project),
        )
        && matches_group(flag_pills, &flags)
}

/// Whether a Commitment row passes the pills it can answer: Under, Scope, Private and Verdict.
/// A Task-only dimension does not apply to it, rather than failing it.
pub fn commitment_passes(row: RowChain<'_>, pills: &ListPills) -> bool {
    let verdict = verdict_token(row.node.verdict.unwrap_or_default());
    row.passes_common(pills)
        && matches_group(&pills.private, &row.private_token())
        && matches_group(&pills.verdict, &[verdict])
}

/// Whether an Expectation row passes the pills it can answer: Under, Scope and Private.
pub fn expectation_passes(row: RowChain<'_>, pills: &ListPills) -> bool {
    row.passes_common(pills) && matches_group(&pills.private, &row.private_token())
}

/// A verdict as a pill spells it.
fn verdict_token(verdict: Verdict) -> &'static str {
    match verdict {
        Verdict::Unresolved => "unresolved",
        Verdict::Kept => "kept",
        Verdict::Broken => "broken",
    }
}

#[cfg(test)]
mod tests;
