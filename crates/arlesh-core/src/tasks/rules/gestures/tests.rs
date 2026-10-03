//! The gestures, ported from `src/utils/task-status-cycle.test.ts`, `agentic.test.ts` and
//! `api/commitments.test.ts` as their specification.

use super::*;

fn ordinary(status: TaskStatus) -> Status {
    Status::Ordinary(status)
}

fn agentic(status: AgenticStatus) -> Status {
    Status::Agentic(status)
}

#[test]
fn enter_cycles_an_ordinary_task_through_to_do_in_progress_and_done() {
    assert_eq!(
        next_status(ordinary(TaskStatus::Todo)),
        ordinary(TaskStatus::InProgress)
    );
    assert_eq!(
        next_status(ordinary(TaskStatus::InProgress)),
        ordinary(TaskStatus::Done)
    );
    assert_eq!(
        next_status(ordinary(TaskStatus::Done)),
        ordinary(TaskStatus::Todo)
    );
    assert_eq!(
        next_status(ordinary(TaskStatus::Started)),
        ordinary(TaskStatus::InProgress),
        "resumes a Started task"
    );
}

#[test]
fn enter_cycles_an_agentic_task_and_takes_review_and_on_agent_over() {
    assert_eq!(
        next_status(agentic(AgenticStatus::Review)),
        agentic(AgenticStatus::Doing)
    );
    assert_eq!(
        next_status(agentic(AgenticStatus::OnAgent)),
        agentic(AgenticStatus::Doing)
    );
    assert_eq!(
        next_status(agentic(AgenticStatus::Doing)),
        agentic(AgenticStatus::Done)
    );
    assert_eq!(
        next_status(agentic(AgenticStatus::Done)),
        agentic(AgenticStatus::Todo)
    );
    assert_eq!(
        next_status(agentic(AgenticStatus::Todo)),
        agentic(AgenticStatus::Doing)
    );
}

#[test]
fn the_cycle_never_leaves_the_model_the_task_holds() {
    for status in [
        AgenticStatus::Todo,
        AgenticStatus::OnAgent,
        AgenticStatus::Review,
        AgenticStatus::Doing,
        AgenticStatus::Done,
    ] {
        assert!(matches!(next_status(agentic(status)), Status::Agentic(_)));
    }
    for status in [
        TaskStatus::Todo,
        TaskStatus::InProgress,
        TaskStatus::Started,
        TaskStatus::Done,
    ] {
        assert!(matches!(next_status(ordinary(status)), Status::Ordinary(_)));
    }
}

#[test]
fn alt_enter_pauses_and_resumes_an_ordinary_task() {
    for status in [TaskStatus::Todo, TaskStatus::InProgress, TaskStatus::Done] {
        assert_eq!(
            alt_step(ordinary(status)),
            Ok(ordinary(TaskStatus::Started))
        );
    }
    assert_eq!(
        alt_step(ordinary(TaskStatus::Started)),
        Ok(ordinary(TaskStatus::InProgress))
    );
}

#[test]
fn alt_enter_hands_a_doing_agentic_task_back_and_refuses_anywhere_else() {
    assert_eq!(
        alt_step(agentic(AgenticStatus::Doing)),
        Ok(agentic(AgenticStatus::OnAgent))
    );
    for status in [
        AgenticStatus::Todo,
        AgenticStatus::OnAgent,
        AgenticStatus::Review,
        AgenticStatus::Done,
    ] {
        assert_eq!(
            alt_step(agentic(status)),
            Err(StatusRefusal::AltEnterAgenticNotDoing)
        );
    }
}

#[test]
fn a_compound_task_refuses_every_status_gesture() {
    for step in [StatusStep::Advance, StatusStep::Alt] {
        assert_eq!(
            status_after(step, ordinary(TaskStatus::Todo), true),
            Err(StatusRefusal::Compound)
        );
    }
    assert_eq!(
        status_after(StatusStep::Advance, ordinary(TaskStatus::Todo), false),
        Ok(ordinary(TaskStatus::InProgress))
    );
}

#[test]
fn a_backlog_cleared_by_the_write_names_the_status_that_cleared_it() {
    let (backlog, live) = (TaskArchival::Backlog, TaskArchival::Live);
    assert_eq!(
        backlog_cleared(backlog, live, ordinary(TaskStatus::InProgress)),
        Some(BacklogCleared::ByStart)
    );
    assert_eq!(
        backlog_cleared(backlog, live, ordinary(TaskStatus::Started)),
        Some(BacklogCleared::ByStarted)
    );
    assert_eq!(
        backlog_cleared(backlog, live, agentic(AgenticStatus::Doing)),
        Some(BacklogCleared::ByStart)
    );
    assert_eq!(
        backlog_cleared(backlog, backlog, ordinary(TaskStatus::Done)),
        None,
        "still set aside"
    );
    assert_eq!(
        backlog_cleared(live, live, ordinary(TaskStatus::InProgress)),
        None,
        "never set aside"
    );
}

#[test]
fn the_agentic_key_writes_the_opposite_of_what_the_task_reads_as() {
    assert!(!toggled_agentic(true));
    assert!(toggled_agentic(false));
}

#[test]
fn enter_walks_the_verdict_unresolved_kept_broken_unresolved() {
    assert_eq!(
        verdict_after(VerdictPress::Cycle, Verdict::Unresolved),
        Verdict::Kept
    );
    assert_eq!(
        verdict_after(VerdictPress::Cycle, Verdict::Kept),
        Verdict::Broken
    );
    assert_eq!(
        verdict_after(VerdictPress::Cycle, Verdict::Broken),
        Verdict::Unresolved
    );
}

#[test]
fn a_verdict_control_toggles_and_never_moves_straight_to_the_other_verdict() {
    assert_eq!(
        verdict_after(VerdictPress::Kept, Verdict::Unresolved),
        Verdict::Kept
    );
    assert_eq!(
        verdict_after(VerdictPress::Kept, Verdict::Kept),
        Verdict::Unresolved
    );
    assert_eq!(
        verdict_after(VerdictPress::Kept, Verdict::Broken),
        Verdict::Kept
    );
    assert_eq!(
        verdict_after(VerdictPress::Broken, Verdict::Broken),
        Verdict::Unresolved
    );
    assert_eq!(
        verdict_after(VerdictPress::Broken, Verdict::Kept),
        Verdict::Broken
    );
}
