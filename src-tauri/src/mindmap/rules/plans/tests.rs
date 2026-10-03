//! The board's Plans: what each Task reads, what it breaks, and where Start finds its Plan.

use super::*;
use crate::{
    scopes::{key::ScopeKey, model::ScopeKind},
    tasks::{
        lifecycle::{Archival, Timing},
        model::{Status, TaskArchival},
        rules::plan_inheritance::{EffectivePlan, Span},
    },
};
use chrono::NaiveDate;

fn date(iso: &str) -> NaiveDate {
    NaiveDate::parse_from_str(iso, "%Y-%m-%d").unwrap_or_default()
}

fn week(iso: &str) -> TimeScope {
    TimeScope::single(ScopeKey::containing(ScopeKind::Week, date(iso)).unwrap())
}

fn task_row(id: i64, parent_type: &str, parent_id: i64) -> Task {
    Task {
        id: id.into(),
        title: format!("task {id}"),
        parent_type: parent_type.to_string(),
        parent_id: parent_id.into(),
        status: Status::from_db("todo").expect("a stored status"),
        delegate_to: None,
        agentic: None,
        asynchronous: false,
        compound: false,
        async_template: None,
        agentic_brief: None,
        time_scope: None,
        on_scope_exit: None,
        plan: None,
        due_scope: None,
        archival: TaskArchival::Live,
        tag_ids: Vec::new(),
        position: id,
        is_private: false,
        origin: Default::default(),
    }
}

fn lifecycle(id: i64, overdue: bool) -> ItemLifecycle {
    ItemLifecycle {
        node_type: "task".to_string(),
        node_id: id.into(),
        timing: Timing::Active,
        resolution: None,
        overdue,
        verdict: None,
        archival: Archival::Live,
        archival_conflict: false,
        plan_timing: None,
    }
}

fn audit_of(tasks: &[Task], lifecycles: &[ItemLifecycle], habits: &[HabitEdge]) -> PlanAudit {
    audit(&PlanRows {
        domains: vec![(1, None)],
        goals: &[],
        tasks,
        commitments: &[],
        expectations: &[],
        lifecycles,
        habits,
    })
}

#[test]
fn a_subtask_reads_its_parents_plan_and_start_finds_it_ahead() {
    let mut parent = task_row(1, "domain", 1);
    parent.plan = Some(week("2026-10-11"));
    let tasks = [parent, task_row(2, "task", 1)];
    let mut lifecycles = vec![lifecycle(1, false), lifecycle(2, false)];
    let audit = audit_of(&tasks, &lifecycles, &[]);
    assert_eq!(
        audit.readings["task-2"].effective,
        EffectivePlan::Inherited {
            plan: week("2026-10-11"),
            source: "task-1".to_string()
        }
    );
    let now = date("2026-10-05").and_hms_opt(12, 0, 0).unwrap_or_default();
    stamp_plan_timing(&mut lifecycles, &audit, now);
    assert_eq!(lifecycles[1].plan_timing, Some(Timing::Pending));
}

#[test]
fn an_overdue_task_does_not_clip_the_plan_it_inherits() {
    let mut parent = task_row(1, "domain", 1);
    parent.plan = Some(week("2026-10-11"));
    let mut late = task_row(2, "task", 1);
    late.time_scope = Some(week("2026-09-27"));
    let tasks = [parent, late];
    let on_time = audit_of(&tasks, &[lifecycle(2, false)], &[]);
    assert_eq!(
        on_time.conflicts.len(),
        1,
        "its window and the Plan do not meet"
    );
    let overdue = audit_of(&tasks, &[lifecycle(2, true)], &[]);
    assert!(overdue.conflicts.is_empty());
}

#[test]
fn a_habit_outside_its_targets_window_is_named() {
    let mut target = task_row(1, "domain", 1);
    target.time_scope = Some(week("2026-10-04"));
    let habit = HabitEdge {
        flow_id: 7,
        title: "Water the plants".to_string(),
        host: "task-1".to_string(),
        span: HabitSpan {
            time_scope: Some(Span {
                start: date("2026-10-04").and_hms_opt(2, 0, 0).unwrap_or_default(),
                end: None,
            }),
            plan: None,
        },
    };
    let audit = audit_of(&[target], &[], &[habit]);
    let named: Vec<&ConflictEntry> = audit.conflicts.iter().collect();
    assert_eq!(
        refusal_message(&named),
        "a habit would reach outside its target's time scope: “Water the plants”"
    );
}

#[test]
fn moving_a_parents_plan_names_the_child_to_clamp() {
    let mut parent = task_row(1, "domain", 1);
    parent.plan = Some(week("2026-10-04"));
    let mut child = task_row(2, "task", 1);
    child.plan = Some(week("2026-10-04"));
    let audit = audit_of(&[parent, child], &[], &[]);
    let targets = clamp_targets(&audit, &NodeId::Stored(1), Some(&week("2026-10-11")));
    assert_eq!(
        targets,
        vec![PlanClampTarget {
            id: NodeId::Stored(2),
            title: "task 2".to_string(),
            clamp_to: Some(week("2026-10-11")),
        }]
    );
}

#[test]
fn a_write_reaches_its_subtree_and_the_habits_hung_there_and_nothing_above() {
    let tasks = [
        task_row(1, "domain", 1),
        task_row(2, "task", 1),
        task_row(3, "task", 2),
        task_row(4, "domain", 1),
    ];
    let habit = HabitEdge {
        flow_id: 7,
        title: "Habit".to_string(),
        host: "task-3".to_string(),
        span: HabitSpan::default(),
    };
    let audit = audit_of(&tasks, &[], &[habit]);
    let reach = audit.reach(&["task-2".to_string()]);
    for key in ["task-2", "task-3", "flow-7"] {
        assert!(reach.contains(key), "{key}");
    }
    for key in ["task-1", "task-4"] {
        assert!(!reach.contains(key), "{key}");
    }
    // A written Habit reaches what hangs under its host.
    let habit_reach = audit.reach(&["flow-7".to_string()]);
    assert!(habit_reach.contains("task-3") && !habit_reach.contains("task-2"));
}
