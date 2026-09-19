use super::*;
use crate::tasks::model::Dependency;

#[test]
fn dependency_parts_task_variant() {
    let (ty, id) = dependency_parts(&Dependency::Task { id: 42 });
    assert_eq!(ty, "task");
    assert_eq!(id, 42);
}

#[test]
fn dependency_parts_goal_variant() {
    let (ty, id) = dependency_parts(&Dependency::Goal { id: 99 });
    assert_eq!(ty, "goal");
    assert_eq!(id, 99);
}

fn stored_task() -> Task {
    Task {
        id: 1,
        title: "Stored".to_string(),
        parent_type: "project".to_string(),
        parent_id: 7,
        status: TaskStatus::Todo.as_str().to_string(),
        delegate_to: Some(3),
        time_scope: Some(TimeScope { start_id: 10, end_id: 11, duration: None }),
        on_scope_exit: Some(OnScopeExit::Keep),
        plan: Some(TimeScope { start_id: 12, end_id: 12, duration: None }),
        archival: TaskArchival::Live,
        tag_ids: vec![],
        position: 100,
        is_private: false,
        // Tracked in `bd`. `TaskWrite` has no counterpart field, so the merge below cannot
        // carry it either way — which is the write-path constraint, stated in the type.
        beads_id: Some("Arlesh-5fs".to_string()),
    }
}

/// The same row, set aside — and so, by the invariant, unplanned.
fn backlogged_task() -> Task {
    Task { plan: None, archival: TaskArchival::Backlog, ..stored_task() }
}

#[test]
fn merging_leaves_a_backlogged_task_in_the_backlog_when_nothing_says_otherwise() {
    let write = TaskWrite::merge(backlogged_task(), UpdateTaskRequest {
        title: Some("Renamed".to_string()),
        ..Default::default()
    });
    assert_eq!(write.archival, TaskArchival::Backlog);
}

#[test]
fn setting_a_plan_on_a_backlogged_task_takes_it_out_of_the_backlog() {
    // The unambiguous gesture: nobody schedules a week for work they mean to leave aside. The
    // caller raises a toast, which is what keeps this from being a silent change.
    let plan = TimeScope { start_id: 20, end_id: 20, duration: None };
    let write = TaskWrite::merge(backlogged_task(), UpdateTaskRequest {
        plan: Some(Some(plan.clone())),
        ..Default::default()
    });
    assert_eq!(write.archival, TaskArchival::Live);
    assert_eq!(write.plan, Some(plan));
}

#[test]
fn an_explicit_backlog_is_never_overridden_by_the_plan_rule() {
    // Asking for both is a contradiction, and `update_task` refuses it — but the merge must
    // report what was asked for rather than quietly resolving it one way.
    let plan = TimeScope { start_id: 20, end_id: 20, duration: None };
    let write = TaskWrite::merge(backlogged_task(), UpdateTaskRequest {
        plan: Some(Some(plan)),
        archival: Some(TaskArchival::Backlog),
        ..Default::default()
    });
    assert_eq!(write.archival, TaskArchival::Backlog);
    assert!(write.plan.is_some());
}

#[test]
fn a_live_task_that_keeps_its_plan_is_untouched_by_the_backlog_rule() {
    let write = TaskWrite::merge(stored_task(), UpdateTaskRequest::default());
    assert_eq!(write.archival, TaskArchival::Live);
    assert!(write.plan.is_some());
}

#[test]
fn the_invariant_refuses_backlog_with_a_plan_and_allows_every_other_pair() {
    let plan = Some(TimeScope { start_id: 1, end_id: 1, duration: None });
    assert!(matches!(
        reject_backlog_with_plan(TaskArchival::Backlog, &plan),
        Err(TaskError::BacklogWithPlan)
    ));
    assert!(reject_backlog_with_plan(TaskArchival::Backlog, &None).is_ok());
    assert!(reject_backlog_with_plan(TaskArchival::Live, &plan).is_ok());
    assert!(reject_backlog_with_plan(TaskArchival::Live, &None).is_ok());
}

#[test]
fn an_empty_update_request_writes_the_stored_row_back_unchanged() {
    let write = TaskWrite::merge(stored_task(), UpdateTaskRequest::default());
    assert!(write.reparent.is_none());
    assert_eq!(write.parent_type, "project");
    assert_eq!(write.parent_id, 7);
    assert_eq!(write.title, "Stored");
    assert_eq!(write.delegate_to, Some(3));
    assert_eq!(write.position, 100);
    assert!(!write.is_private);
}

#[test]
fn clearing_the_time_scope_clears_it_rather_than_keeping_the_stored_one() {
    let write = TaskWrite::merge(
        stored_task(),
        UpdateTaskRequest { time_scope: Some(None), ..Default::default() },
    );
    assert_eq!(write.time_scope, None);
}

#[test]
fn a_reparent_needs_both_halves_and_becomes_the_validated_parent() {
    let half = TaskWrite::merge(
        stored_task(),
        UpdateTaskRequest { parent_type: Some("goal".into()), ..Default::default() },
    );
    assert!(half.reparent.is_none(), "a parent type without an id is not a move");
    assert_eq!(half.parent_type, "project");

    let full = TaskWrite::merge(
        stored_task(),
        UpdateTaskRequest {
            parent_type: Some("goal".into()),
            parent_id: Some(42),
            ..Default::default()
        },
    );
    assert_eq!(full.reparent, Some(("goal".to_string(), 42)));
    assert_eq!(full.parent_type, "goal");
    assert_eq!(full.parent_id, 42);
}

#[test]
fn a_goal_update_merges_its_request_over_the_stored_row() {
    let stored = Goal {
        id: 2,
        title: "Stored".to_string(),
        parent_type: "project".to_string(),
        parent_id: 7,
        status: GoalStatus::Active.as_str().to_string(),
        time_scope: None,
        on_scope_exit: None,
        tag_ids: vec![],
        position: 5,
        is_private: true,
        // As in `stored_task`: `GoalWrite` has no `beads_id`, so an update cannot reach it.
        beads_id: Some("Arlesh-5fs".to_string()),
    };
    let write = GoalWrite::merge(
        stored,
        UpdateGoalRequest {
            status: Some(GoalStatus::Achieved),
            position: Some(9),
            ..Default::default()
        },
    );
    assert_eq!(write.title, "Stored");
    assert_eq!(write.status, GoalStatus::Achieved.as_str());
    assert_eq!(write.position, 9);
    assert!(write.is_private);
}
