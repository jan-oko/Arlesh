//! The List View's pills, ported from `src/utils/list-filter.test.ts` as their specification.

use super::*;
use crate::{
    scopes::key::test_key,
    tasks::{lifecycle::Timing, model::TimeScope},
};

fn pill(value: &str, mode: TagMode) -> Pill {
    Pill {
        value: value.to_string(),
        mode,
    }
}

fn node(id: &str, kind: NodeKind) -> NodeFacts {
    NodeFacts::new(id, kind)
}

fn scoped() -> Option<TimeScope> {
    Some(TimeScope {
        start_id: test_key(1),
        end_id: test_key(1),
        duration: None,
    })
}

/// A row with nothing above it.
fn chain(node: &NodeFacts) -> RowChain<'_> {
    RowChain {
        node,
        ancestors: &[],
    }
}

fn passes(row: &NodeFacts, ancestors: &[NodeFacts], pills: &ListPills) -> bool {
    task_passes(
        RowChain {
            node: row,
            ancestors,
        },
        pills,
    )
}

#[test]
fn a_group_with_no_pill_passes_anything() {
    assert!(matches_group(&[], &["x"]));
}

#[test]
fn any_matches_when_the_row_has_one_of_the_values() {
    let pills = [pill("a", TagMode::Any), pill("b", TagMode::Any)];
    assert!(matches_group(&pills, &["b"]));
    assert!(!matches_group(&pills, &["c"]));
}

#[test]
fn all_matches_only_when_the_row_has_every_value() {
    let pills = [pill("a", TagMode::All), pill("b", TagMode::All)];
    assert!(matches_group(&pills, &["a", "b"]));
    assert!(!matches_group(&pills, &["a"]));
}

#[test]
fn exclude_fails_when_the_row_has_the_value() {
    let pills = [pill("a", TagMode::Exclude)];
    assert!(!matches_group(&pills, &["a"]));
    assert!(matches_group(&pills, &["b"]));
}

#[test]
fn the_three_modes_combine_as_any_and_all_and_not_exclude() {
    let pills = [
        pill("a", TagMode::Any),
        pill("b", TagMode::All),
        pill("c", TagMode::Exclude),
    ];
    assert!(matches_group(&pills, &["a", "b"]));
    assert!(!matches_group(&pills, &["a", "b", "c"]));
    assert!(!matches_group(&pills, &["b"]), "fails the Any clause");
}

#[test]
fn a_bare_node_reads_unscoped_and_unplanned() {
    assert_eq!(
        scope_state_tokens(&node("t", NodeKind::Task)),
        ["unscoped", "unplanned"]
    );
}

#[test]
fn the_overdue_flag_wins_over_the_window() {
    let mut task = node("t", NodeKind::Task);
    task.time_scope = scoped();
    task.timing = Some(Timing::Lapsed);
    task.overdue = true;
    assert_eq!(scope_state_tokens(&task), ["overdue", "unplanned"]);

    let mut unscoped = node("u", NodeKind::Task);
    unscoped.timing = Some(Timing::Active);
    unscoped.overdue = true;
    assert_eq!(
        scope_state_tokens(&unscoped),
        ["overdue", "unplanned"],
        "an unscoped task past a due of its own"
    );
}

#[test]
fn only_a_missed_lapse_reads_lapsed_and_a_completed_one_still_reads_active() {
    let mut task = node("t", NodeKind::Task);
    task.time_scope = scoped();
    task.timing = Some(Timing::Lapsed);
    task.archived = true;
    assert_eq!(scope_state_tokens(&task), ["active", "unplanned"]);
    task.missed = true;
    assert_eq!(scope_state_tokens(&task), ["lapsed", "unplanned"]);
}

#[test]
fn a_plan_reads_planned_whatever_the_window_says() {
    let mut task = node("t", NodeKind::Task);
    task.planned = true;
    assert_eq!(scope_state_tokens(&task), ["unscoped", "planned"]);
}

#[test]
fn goal_status_reads_the_nearest_goal_not_the_task() {
    let mut outer = node("goal-1", NodeKind::Goal);
    outer.status = Some("achieved".to_string());
    let mut inner = node("goal-2", NodeKind::Goal);
    inner.status = Some("active".to_string());
    let mut task = node("task-1", NodeKind::Task);
    task.status = Some("todo".to_string());
    let pills = ListPills {
        goal_status: vec![pill("active", TagMode::Any)],
        ..ListPills::default()
    };
    assert!(passes(&task, &[outer.clone(), inner], &pills));
    assert!(!passes(
        &task,
        &[outer],
        &ListPills {
            goal_status: vec![pill("active", TagMode::Any)],
            ..ListPills::default()
        }
    ));
    assert!(
        !passes(&task, &[], &pills),
        "a task with no goal matches no goal status"
    );
}

#[test]
fn under_matches_any_ancestor_at_any_depth() {
    let aspect = node("domain-1", NodeKind::Aspect);
    let project = node("domain-2", NodeKind::Project);
    let task = node("task-1", NodeKind::Task);
    let under = |mode| ListPills {
        antecedent: vec![pill("domain-1", mode)],
        ..ListPills::default()
    };
    let chain = [aspect, project];
    assert!(passes(&task, &chain, &under(TagMode::Any)));
    assert!(!passes(&task, &chain, &under(TagMode::Exclude)));
    assert!(
        !passes(&task, &[], &under(TagMode::Any)),
        "no ancestor matches no Under pill"
    );
}

#[test]
fn depends_on_reads_every_dependency_met_or_not() {
    let mut task = node("task-1", NodeKind::Task);
    task.dependencies = vec!["task-2".to_string()];
    let pills = ListPills {
        dependency: vec![pill("task-2", TagMode::Exclude)],
        ..ListPills::default()
    };
    assert!(!passes(&task, &[], &pills));
    assert!(passes(&node("task-3", NodeKind::Task), &[], &pills));
}

#[test]
fn the_yes_no_flags_are_one_group() {
    let mut agentic = node("task-1", NodeKind::Task);
    agentic.agentic = true;
    let mut asynchronous = node("task-2", NodeKind::Task);
    asynchronous.asynchronous = true;
    let mut both = node("task-3", NodeKind::Task);
    both.agentic = true;
    both.asynchronous = true;
    let neither = node("task-4", NodeKind::Task);
    let flags = |mode| ListPills {
        agentic: vec![pill("agentic", mode)],
        asynchronous: vec![pill("asynchronous", mode)],
        ..ListPills::default()
    };
    let kept = |pills: &ListPills| -> Vec<&str> {
        [&agentic, &asynchronous, &both, &neither]
            .into_iter()
            .filter(|row| passes(row, &[], pills))
            .map(|row| row.id.as_str())
            .collect()
    };
    assert_eq!(
        kept(&flags(TagMode::Any)),
        ["task-1", "task-2", "task-3"],
        "Any across both is either"
    );
    assert_eq!(
        kept(&flags(TagMode::All)),
        ["task-3"],
        "All across both is both"
    );
}

#[test]
fn private_reads_the_row_or_anything_above_it() {
    let mut marked = node("domain-1", NodeKind::Project);
    marked.is_private = true;
    let task = node("task-1", NodeKind::Task);
    let pills = ListPills {
        private: vec![pill("private", TagMode::Any)],
        ..ListPills::default()
    };
    assert!(passes(&task, &[marked], &pills));
    assert!(!passes(&task, &[], &pills));
}

#[test]
fn a_commitment_answers_its_verdict_and_ignores_the_task_only_dimensions() {
    let mut kept = node("commitment-1", NodeKind::Commitment);
    kept.verdict = Some(Verdict::Kept);
    let unrecorded = node("commitment-2", NodeKind::Commitment);
    let verdict = ListPills {
        verdict: vec![pill("unresolved", TagMode::Any)],
        ..ListPills::default()
    };
    assert!(!commitment_passes(chain(&kept), &verdict));
    assert!(commitment_passes(chain(&unrecorded), &verdict));
    let task_only = ListPills {
        task_status: vec![pill("in_progress", TagMode::Any)],
        blocked: vec![pill("blocked", TagMode::Any)],
        ..ListPills::default()
    };
    assert!(commitment_passes(chain(&kept), &task_only));
    assert!(expectation_passes(
        chain(&node("expectation-1", NodeKind::Expectation)),
        &task_only
    ));
}
