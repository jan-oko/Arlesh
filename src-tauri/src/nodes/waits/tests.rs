use chrono::NaiveDate;

use super::*;
use crate::tasks::model::Delegate;

fn delegated(id: NodeId) -> Task {
    Task {
        id,
        title: "Ask Dana".into(),
        parent_type: "project".into(),
        parent_id: 1.into(),
        status: "todo".into(),
        delegate_to: Some(Delegate::Agent),
        agentic: None,
        asynchronous: false,
        async_template: None,
        time_scope: None,
        on_scope_exit: None,
        plan: None,
        archival: TaskArchival::Live,
        tag_ids: vec![],
        position: 0,
        is_private: true,
        beads_id: None,
        origin: Origin::Manual,
    }
}

#[test]
fn a_delegated_tasks_wait_is_a_pending_expectation_beneath_it() {
    let wait = delegation_wait(&delegated(NodeId::Stored(7)));
    assert_eq!(
        wait.id,
        DerivedKey::DelegationWait(NodeId::Stored(7)).node_id()
    );
    assert_eq!(wait.parent_type, "task");
    assert_eq!(wait.parent_id, NodeId::Stored(7));
    assert_eq!(wait.status, ExpectationStatus::Pending);
    assert!(wait.is_private, "it is as private as its Task");
    assert_eq!(
        wait.origin,
        Origin::DelegationWait(WaitOrigin {
            task_id: NodeId::Stored(7)
        })
    );
    assert_eq!(
        registry::recall(wait.id.derived().unwrap()),
        Some(DerivedKey::DelegationWait(NodeId::Stored(7)))
    );
}

fn check_key() -> CheckKey {
    CheckKey {
        wait: WaitRef::Stored(5),
        due_at: NaiveDate::from_ymd_opt(2026, 9, 20)
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap(),
    }
}

fn state(overlay: TaskOverlay) -> CheckState {
    CheckState {
        overlays: HashMap::from([(check_key().node_key(), overlay)]),
        tags: HashMap::from([(check_key().node_key(), vec![(3, true), (4, false)])]),
        reasons: HashMap::from([(check_key().node_key(), vec!["phone is off".to_string()])]),
    }
}

fn draw(done: bool) -> CheckDraw<'static> {
    CheckDraw {
        key: check_key(),
        wait_title: "Reply from Dana",
        wait_row: NodeId::Stored(5),
        due: TimeScope::single(crate::scopes::key::ScopeKey::day(
            NaiveDate::from_ymd_opt(2026, 9, 20).unwrap(),
        )),
        done,
        is_private: false,
    }
}

#[test]
fn an_open_check_task_is_a_task_under_its_wait_reading_its_overlay() {
    let mut rows = WaitRows::default();
    rows.push_check(
        &state(TaskOverlay {
            status: Some("in_progress".into()),
            block_reasons_set: true,
            ..TaskOverlay::default()
        }),
        draw(false),
    );
    let task = &rows.tasks[0];
    assert_eq!(task.id, DerivedKey::Check(check_key()).node_id());
    assert_eq!(task.title, "Reply from Dana");
    assert_eq!(
        (task.parent_type.as_str(), &task.parent_id),
        ("expectation", &NodeId::Stored(5))
    );
    assert_eq!(task.status, "in_progress");
    assert_eq!(task.tag_ids, vec![3]);
    assert!(task.time_scope.is_some());
    assert_eq!(rows.block_reasons.len(), 1);
    assert_eq!(rows.block_reasons[0].owner_id, task.id);
}

#[test]
fn a_made_check_is_a_done_task_whatever_its_overlay_said_while_open() {
    let mut rows = WaitRows::default();
    rows.push_check(
        &state(TaskOverlay {
            status: Some("in_progress".into()),
            title: Some("Call Dana".into()),
            ..TaskOverlay::default()
        }),
        draw(true),
    );
    assert_eq!(rows.tasks[0].status, "done");
    assert_eq!(rows.tasks[0].title, "Call Dana");
    assert!(
        rows.block_reasons.is_empty(),
        "its reasons are its own only once set"
    );
}
