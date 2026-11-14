//! What is observed on a board, and what a device is told of it.

use super::*;
use crate::mindmap::model::NodeFacts;
use crate::{
    nodes::origin::{CheckOrigin, Origin},
    tasks::{
        lifecycle::Archival,
        model::{TaskArchival, TaskStatus},
        waits::WaitKind,
    },
};

fn task(id: i64, status: Status, origin: Origin) -> Task {
    Task {
        id: id.into(),
        title: format!("task {id}"),
        parent_type: "project".to_string(),
        parent_id: 1.into(),
        status,
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
        origin,
    }
}

fn todo(id: i64) -> Task {
    task(id, Status::Ordinary(TaskStatus::Todo), Origin::Manual)
}

fn check(id: i64) -> Task {
    let origin = Origin::Check(CheckOrigin {
        wait_kind: WaitKind::Stored,
        wait_id: 9.into(),
        due_at: chrono::NaiveDate::from_ymd_opt(2026, 11, 4)
            .and_then(|day| day.and_hms_opt(9, 0, 0))
            .unwrap_or_default(),
    });
    task(id, Status::Ordinary(TaskStatus::Todo), origin)
}

fn lifecycle(id: i64, overdue: bool, archival: Archival) -> ItemLifecycle {
    let archival = serde_json::to_value(archival).unwrap();
    serde_json::from_value(serde_json::json!({
        "node_type": "task",
        "node_id": id,
        "timing": "active",
        "overdue": overdue,
        "archival": archival,
        "archival_conflict": false,
    }))
    .unwrap()
}

fn asking(wait: i64) -> NodeFacts {
    NodeFacts {
        open_question: Some(wait.into()),
        ..NodeFacts::default()
    }
}

fn keys(observed: &Observed) -> Vec<&str> {
    observed
        .facts
        .iter()
        .map(|fact| fact.key.as_str())
        .collect()
}

#[test]
fn a_board_with_nothing_to_tell_observes_nothing() {
    let load = MindmapLoad {
        tasks: vec![todo(1)],
        lifecycles: vec![lifecycle(1, false, Archival::Live)],
        ..MindmapLoad::default()
    };
    assert!(observe(&load, false).facts.is_empty());
}

#[test]
fn a_question_an_overdue_task_and_a_generated_one_are_each_a_fact() {
    let mut load = MindmapLoad {
        tasks: vec![todo(1), todo(2), check(3)],
        lifecycles: vec![
            lifecycle(1, false, Archival::Live),
            lifecycle(2, true, Archival::Live),
            lifecycle(3, false, Archival::Live),
        ],
        ..MindmapLoad::default()
    };
    load.facts.insert("task-1".to_string(), asking(7));

    let observed = observe(&load, false);

    assert_eq!(keys(&observed), ["generated:3", "overdue:2", "question:7"]);
    let question = &observed.facts[2];
    assert_eq!(question.channel, Channel::AgentQuestion);
    assert_eq!(question.task.as_deref(), Some("task-1"));
    assert_eq!(question.title.as_deref(), Some("task 1"));
}

#[test]
fn a_generated_task_that_is_done_or_archived_is_not_news() {
    let done = task(1, Status::Ordinary(TaskStatus::Done), check(0).origin);
    let load = MindmapLoad {
        tasks: vec![done, check(2)],
        lifecycles: vec![
            lifecycle(1, false, Archival::Live),
            lifecycle(2, false, Archival::Archived),
        ],
        ..MindmapLoad::default()
    };
    assert!(observe(&load, false).facts.is_empty());
}

fn observed(facts: &[(&str, Channel)], locked: bool) -> Observed {
    Observed {
        facts: facts
            .iter()
            .map(|(key, channel)| PushEvent {
                key: (*key).to_string(),
                value: String::new(),
                channel: *channel,
                task: Some("task-1".to_string()),
                title: None,
            })
            .collect(),
        capacity_locked: locked,
    }
}

fn told(keys: &[&str]) -> Vec<SentEntry> {
    keys.iter()
        .map(|key| SentEntry {
            key: (*key).to_string(),
            value: String::new(),
        })
        .collect()
}

#[test]
fn a_fact_is_sent_once_and_forgotten_when_it_stops_holding() {
    let now = observed(&[("question:1", Channel::AgentQuestion)], false);

    let first = plan(&now, &[]);
    assert_eq!(first.send.len(), 1);
    assert!(first.forget.is_empty());

    let again = plan(&now, &told(&["question:1"]));
    assert!(again.send.is_empty(), "already told");

    let answered = plan(&observed(&[], false), &told(&["question:1"]));
    assert!(answered.send.is_empty());
    assert_eq!(answered.forget, ["question:1"]);
}

#[test]
fn the_lock_is_news_when_it_changes_and_not_before() {
    let locked = observed(&[], true);
    let clear = observed(&[], false);
    let entry = |value: &str| {
        vec![SentEntry {
            key: CAPACITY_KEY.to_string(),
            value: value.to_string(),
        }]
    };

    let set = plan(&locked, &[]);
    assert_eq!(set.send.len(), 1);
    assert_eq!(set.send[0].channel, Channel::CapacityLocked);
    assert_eq!(set.send[0].value, "locked");

    assert!(plan(&locked, &entry("locked")).send.is_empty());
    assert!(plan(&clear, &[]).send.is_empty(), "never told, and clear");

    let cleared = plan(&clear, &entry("locked"));
    assert_eq!(cleared.send[0].channel, Channel::CapacityCleared);
    assert!(
        cleared.forget.is_empty(),
        "the lock's record is replaced, not forgotten"
    );
}

#[test]
fn a_device_that_starts_now_is_told_nothing_of_what_already_holds() {
    let board = observed(&[("overdue:4", Channel::TaskOverdue)], true);
    let entries = baseline(&board);
    assert!(plan(&board, &entries).send.is_empty());
}
