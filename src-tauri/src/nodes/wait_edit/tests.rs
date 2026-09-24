use chrono::NaiveDate;

use super::*;
use crate::{
    nodes::{id::NodeId, origin::Origin},
    scopes::key::ScopeKey,
    tasks::model::{TaskAgentic, TimeScope},
};

fn day(d: u32) -> TimeScope {
    TimeScope::single(ScopeKey::day(NaiveDate::from_ymd_opt(2026, 9, d).unwrap()))
}

fn check() -> Task {
    Task {
        id: NodeId::Stored(0),
        title: "Reply from Dana".into(),
        parent_type: "expectation".into(),
        parent_id: NodeId::Stored(5),
        status: "todo".into(),
        delegate_to: None,
        agentic: None,
        asynchronous: false,
        async_template: None,
        time_scope: Some(day(20)),
        on_scope_exit: None,
        plan: None,
        archival: TaskArchival::Live,
        tag_ids: vec![],
        position: 0,
        is_private: false,
        beads_id: None,
        origin: Origin::Manual,
    }
}

#[test]
fn a_full_editor_save_repeating_parent_and_day_passes() {
    let request = UpdateTaskRequest {
        parent_type: Some("expectation".into()),
        parent_id: Some(NodeId::Stored(5)),
        time_scope: Some(Some(day(20))),
        agentic: Some(TaskAgentic::Yes),
        delegate_to: Some(None),
        ..Default::default()
    };
    assert!(refuse_changes(&check(), &request).is_ok());
}

#[test]
fn moving_redating_delegating_or_spawning_is_refused() {
    let refused = |request: UpdateTaskRequest| refuse_changes(&check(), &request).is_err();
    assert!(refused(UpdateTaskRequest {
        parent_type: Some("project".into()),
        parent_id: Some(NodeId::Stored(1)),
        ..Default::default()
    }));
    assert!(refused(UpdateTaskRequest {
        time_scope: Some(Some(day(21))),
        ..Default::default()
    }));
    assert!(refused(UpdateTaskRequest {
        delegate_to: Some(Some(crate::tasks::model::Delegate::Agent)),
        ..Default::default()
    }));
    assert!(refused(UpdateTaskRequest {
        asynchronous: Some(true),
        ..Default::default()
    }));
}
