//! The Plan View's rules: which Tasks a planning pass offers, which it already holds, which bound a
//! move would break, the scope one rung up, and where work taken out lands.
//!
//! The bounds are the writer's own: [`breaks_own_scope`] and [`breaks_parent_plan`] are what
//! `check_containment` refuses a Plan by, so the view's refusal and the writer's cannot disagree
//! about which bound a doomed move breaks. Mirrors `src/utils/plan-triage.ts`,
//! `src/utils/plan-take-out.ts` and `parentRefs` in `src/utils/plan-scope.ts`;
//! `conformance/plan-triage.json` holds the two together.

use serde::Serialize;

use crate::{
    scopes::{
        key::ScopeKey,
        model::ScopeKind,
        resolve::{interval_contains, Bounds},
    },
    tasks::model::TimeScope,
};

/// Which containment bound a Plan move would break. Named, not phrased — the view words it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanRefusal {
    /// The Plan would leave the Task's own Time Scope.
    OwnTimeScope,
    /// The Plan would leave its nearest planned ancestor's Plan.
    ParentPlan,
}

/// Whether a Plan of `plan` leaves the Task's **own** Time Scope `own`. An inherited window bounds
/// the window a Task may take, not the Plan it may hold; and an **Overdue** Task, whose window has
/// passed, may be rescheduled out of it.
pub fn breaks_own_scope(own: Option<Bounds>, overdue: bool, plan: Bounds) -> bool {
    own.is_some_and(|own| !overdue && !interval_contains(own, plan))
}

/// Whether a Plan of `plan` leaves the nearest planned ancestor's Plan `ancestor` — Overdue or not.
pub fn breaks_parent_plan(ancestor: Option<Bounds>, plan: Bounds) -> bool {
    ancestor.is_some_and(|ancestor| !interval_contains(ancestor, plan))
}

/// Which bound planning a Task into `target` would break, read in the writer's order, or `None`.
pub fn refusal(
    own: Option<Bounds>,
    overdue: bool,
    ancestor_plan: Option<Bounds>,
    target: Bounds,
) -> Option<PlanRefusal> {
    if breaks_own_scope(own, overdue, target) {
        return Some(PlanRefusal::OwnTimeScope);
    }
    breaks_parent_plan(ancestor_plan, target).then_some(PlanRefusal::ParentPlan)
}

/// The scope one rung above `scope`, by the cell holding its **first day** — so a week at a month's
/// edge has one parent, the month it starts in. A Season, the top of the ladder, and an Exact range
/// have none.
pub fn parent_of(scope: &ScopeKey) -> Option<ScopeKey> {
    let (kind, date) = match *scope {
        ScopeKey::PartOfDay { date, .. } => return Some(ScopeKey::day(date)),
        ScopeKey::Day { date } => (ScopeKind::Week, date),
        ScopeKey::Week { date } => (ScopeKind::Month, date),
        ScopeKey::Month { date } => (ScopeKind::Season, date),
        ScopeKey::Season { .. } | ScopeKey::Exact { .. } => return None,
    };
    ScopeKey::containing(kind, date).ok()
}

/// Where work taken out of the scope being filled lands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TakeOut<S> {
    /// Planned to this scope.
    Plan(S),
    /// Its Plan cleared.
    Clear,
}

/// Where work taken out of `filled` lands: one rung up, to the scope whose work the candidates
/// side shows. Split by subscope, the work sat in a part, so it goes to the scope itself; not split,
/// to the parent; and with no parent — a Season — its Plan is cleared.
pub fn take_out<S>(split: bool, filled: S, parent: Option<S>) -> TakeOut<S> {
    if split {
        return TakeOut::Plan(filled);
    }
    parent.map_or(TakeOut::Clear, TakeOut::Plan)
}

/// What a planning pass reads off one ancestor of a row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanAncestor {
    /// Whether it is a wait, which cuts the Plan chain.
    pub is_wait: bool,
    /// Its own Time Scope.
    pub time_scope: Option<TimeScope>,
    /// Its own Plan.
    pub plan: Option<TimeScope>,
}

/// What a planning pass reads off one Task row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanRow {
    /// The row's id.
    pub id: String,
    /// Whether it draws a row a Plan can be written to; a drawing does not.
    pub stored: bool,
    /// Its own Time Scope.
    pub time_scope: Option<TimeScope>,
    /// Its own Plan.
    pub plan: Option<TimeScope>,
    /// Whether it is flagged Overdue.
    pub overdue: bool,
    /// Every ancestor, outermost first.
    pub ancestors: Vec<PlanAncestor>,
}

impl PlanRow {
    /// The Time Scope it reads: its own, or the nearest scoped ancestor's; `None` is Unscoped,
    /// which the model reads as always relevant.
    pub fn effective_time_scope(&self) -> Option<&TimeScope> {
        self.time_scope.as_ref().or_else(|| {
            self.ancestors
                .iter()
                .rev()
                .find_map(|ancestor| ancestor.time_scope.as_ref())
        })
    }

    /// The nearest planned ancestor's Plan — a wait cuts the chain.
    pub fn ancestor_plan(&self) -> Option<&TimeScope> {
        for ancestor in self.ancestors.iter().rev() {
            if ancestor.is_wait {
                return None;
            }
            if ancestor.plan.is_some() {
                return ancestor.plan.as_ref();
            }
        }
        None
    }

    /// Which bound planning this row into `target` would break, or `None`.
    pub fn refusal(&self, target: Bounds) -> Option<PlanRefusal> {
        refusal(
            self.time_scope.as_ref().map(TimeScope::window),
            self.overdue,
            self.ancestor_plan().map(TimeScope::window),
            target,
        )
    }
}

/// One planning pass's three heaps, in row order.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Panes<'a> {
    /// Unplanned rows whose effective Time Scope reaches into the scope — every Unscoped one too.
    pub unplanned: Vec<&'a PlanRow>,
    /// Rows planned into the scope: their Plan lies inside it.
    pub planned: Vec<&'a PlanRow>,
    /// Rows planned to the scope's parent itself — one rung up, waiting to be placed here.
    pub parent_planned: Vec<&'a PlanRow>,
}

/// Splits `rows` for the scope `target` (window `window`), whose parent is `parent` — `None` for
/// a Season. A row planned anywhere else is in none of the heaps.
pub fn triage<'a>(rows: &'a [PlanRow], window: Bounds, parent: Option<&ScopeKey>) -> Panes<'a> {
    let mut panes = Panes::default();
    for row in rows.iter().filter(|row| row.stored) {
        if let Some(plan) = &row.plan {
            if plan.start_id == plan.end_id && parent == Some(&plan.start_id) {
                panes.parent_planned.push(row);
            } else if interval_contains(window, plan.window()) {
                panes.planned.push(row);
            }
            continue;
        }
        let relevant = row
            .effective_time_scope()
            .is_none_or(|scope| overlaps(scope.window(), window));
        if relevant {
            panes.unplanned.push(row);
        }
    }
    panes
}

/// Whether two half-open windows share an instant: adjacent scopes do not.
fn overlaps(a: Bounds, b: Bounds) -> bool {
    a.0 < b.1 && b.0 < a.1
}

#[cfg(test)]
mod tests;
