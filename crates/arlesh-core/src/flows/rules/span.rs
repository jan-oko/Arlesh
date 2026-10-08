//! How far a Habit reaches as a node: its effective Time Scope and effective Plan, which hold it
//! inside its target (`docs/spec/habits.md`, *Plan inheritance*). Derived for the containment
//! check only, never shown.

use crate::flows::{
    error::FlowError,
    model::{Flow, FlowRecurrence},
    rules::schedule::{flow_window_spec, resolve_root_plan, window_at},
};
use crate::tasks::rules::plan_inheritance::{HabitSpan, Span};

/// The span of the Habit `flow` recurring by `recurrence`.
///
/// - Its **Time Scope** runs from its first iteration's window to the end of the window its end
///   falls in — on without end when it has none. An Unscoped Habit has none at all.
/// - Its **Plan** runs from its first iteration root's Plan to its last's, when the Habit plans
///   its root (a root Cycle Plan). With none, its occurrences carry no Plan of their own and
///   inherit as any node does, so it has no span to hold.
pub fn habit_span(flow: &Flow, recurrence: &FlowRecurrence) -> Result<HabitSpan, FlowError> {
    let Some(spec) = flow_window_spec(flow)? else {
        return Ok(HabitSpan::default());
    };
    let (first, start, _, _) = window_at(&spec, recurrence.start_scope_id.start_date())?;
    let last = recurrence
        .end_scope_id
        .map(|end| {
            window_at(&spec, end.end_date())
                .map(|(scope, _, until, _)| (scope, until.max(end.bounds().1)))
        })
        .transpose()?;
    let time_scope = Span {
        start,
        end: last.map(|(_, until)| until),
    };
    let Some(first_plan) = resolve_root_plan(flow, Some(first.start_date()))? else {
        return Ok(HabitSpan {
            time_scope: Some(time_scope),
            plan: None,
        });
    };
    let last_plan = match last {
        Some((scope, _)) => resolve_root_plan(flow, Some(scope.start_date()))?,
        None => None,
    };
    Ok(HabitSpan {
        time_scope: Some(time_scope),
        plan: Some(Span {
            start: first_plan.window().0,
            end: last_plan.map(|plan| plan.window().1),
        }),
    })
}

#[cfg(test)]
mod tests;
