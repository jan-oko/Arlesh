use super::*;
use crate::{
    nodes::origin::Origin,
    tasks::model::{TaskArchival, TaskStatus},
};

fn task(id: i64, status: Status) -> Task {
    Task {
        id: id.into(),
        title: "t".into(),
        parent_type: "domain".into(),
        parent_id: 1.into(),
        status,
        delegate_to: None,
        agentic: Some(true),
        asynchronous: false,
        compound: false,
        async_template: None,
        agentic_brief: None,
        time_scope: None,
        on_scope_exit: None,
        plan: None,
        due_scope: None,
        archival: TaskArchival::Live,
        tag_ids: vec![],
        position: 0,
        is_private: false,
        origin: Origin::Manual,
    }
}

fn wait(under: i64, question: bool) -> Expectation {
    Expectation {
        id: (100 + under).into(),
        title: "Red or blue?".into(),
        parent_type: "task".into(),
        parent_id: under.into(),
        status: ExpectationStatus::Pending,
        archival: ExpectationArchival::Live,
        position: 0,
        is_private: false,
        time_scope: None,
        tag_ids: vec![],
        check_every: None,
        check_starting: None,
        last_check_at: None,
        agentic: true,
        agentic_note: None,
        question,
        answer: None,
        origin: Default::default(),
    }
}

const ON_AGENT: Status = Status::Agentic(AgenticStatus::OnAgent);
const REVIEW: Status = Status::Agentic(AgenticStatus::Review);

#[test]
fn an_on_agent_task_with_an_open_question_reads_review() {
    let mut tasks = vec![task(1, ON_AGENT)];
    derive(&mut tasks, &[wait(1, true)]);
    assert_eq!(tasks[0].status, REVIEW);
}

#[test]
fn a_wait_that_is_not_a_question_leaves_it_on_agent() {
    let mut tasks = vec![task(1, ON_AGENT)];
    derive(&mut tasks, &[wait(1, false)]);
    assert_eq!(tasks[0].status, ON_AGENT);
}

#[test]
fn an_answered_question_leaves_it_on_agent() {
    let mut released = wait(1, true);
    released.status = ExpectationStatus::Released;
    let mut tasks = vec![task(1, ON_AGENT)];
    derive(&mut tasks, &[released]);
    assert_eq!(tasks[0].status, ON_AGENT);
}

#[test]
fn only_on_agent_reads_review() {
    let doing = Status::Agentic(AgenticStatus::Doing);
    let ordinary = Status::Ordinary(TaskStatus::InProgress);
    let mut tasks = vec![task(1, doing), task(2, ordinary)];
    derive(&mut tasks, &[wait(1, true), wait(2, true)]);
    assert_eq!(tasks[0].status, doing);
    assert_eq!(tasks[1].status, ordinary);
}

#[test]
fn a_question_under_another_task_says_nothing_about_this_one() {
    let mut tasks = vec![task(1, ON_AGENT)];
    derive(&mut tasks, &[wait(2, true)]);
    assert_eq!(tasks[0].status, ON_AGENT);
}
