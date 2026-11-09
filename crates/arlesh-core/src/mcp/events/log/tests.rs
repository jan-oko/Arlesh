use super::*;
use crate::tasks::model::ExpectationStatus;

fn wait(id: &str, status: ExpectationStatus) -> WaitState {
    WaitState {
        wait_id: id.into(),
        short_id: id[..3].into(),
        task_id: "task-full".into(),
        task_short_id: "4ab".into(),
        status,
        archived: false,
        question: true,
    }
}

fn board(waits: &[WaitState]) -> BTreeMap<String, WaitState> {
    waits
        .iter()
        .map(|wait| (wait.wait_id.clone(), wait.clone()))
        .collect()
}

fn pending(id: &str) -> WaitState {
    wait(id, ExpectationStatus::Pending)
}

fn released(id: &str) -> WaitState {
    wait(id, ExpectationStatus::Released)
}

#[test]
fn the_first_read_is_a_baseline_not_a_burst_of_creations() {
    let mut state = State::default();

    state.absorb(board(&[pending("aaa-1")]), 4);

    assert_eq!(state.reading(4), Reading::Events(4, vec![]));
    assert_eq!(state.reading(3), Reading::Stale(4));
}

#[test]
fn a_change_is_stamped_past_the_revision_it_was_noticed_at() {
    let mut state = State::default();
    state.absorb(board(&[pending("aaa-1")]), 4);

    state.absorb(board(&[released("aaa-1")]), 5);

    let Reading::Events(through, events) = state.reading(4) else {
        panic!("a reading at the baseline is not stale");
    };
    assert_eq!(through, 5);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].0, 5);
    assert_eq!(
        events[0].1.change,
        crate::mcp::events::rules::Change::Released
    );
    // A client that has heard up to 5 hears it no more.
    assert_eq!(state.reading(5), Reading::Events(5, vec![]));
}

#[test]
fn a_change_found_late_is_still_past_a_revision_already_handed_out() {
    let mut state = State::default();
    state.absorb(board(&[pending("aaa-1")]), 4);
    // A quiet sync hands out revision 6 ...
    state.absorb(board(&[pending("aaa-1")]), 6);
    // ... then a write the earlier read missed shows up, with the feed still at 6.
    state.absorb(board(&[released("aaa-1")]), 6);

    let Reading::Events(_, events) = state.reading(6) else {
        panic!("not stale");
    };
    assert_eq!(events.len(), 1, "a client at 6 must hear the late change");
    assert!(events[0].0 > 6);
}

#[test]
fn a_cursor_from_the_future_or_below_the_floor_is_stale() {
    let mut state = State::default();
    state.absorb(board(&[]), 10);

    assert_eq!(state.reading(11), Reading::Stale(10));
    assert_eq!(state.reading(9), Reading::Stale(10));
    assert_eq!(state.reading(10), Reading::Events(10, vec![]));
}

#[test]
fn only_the_newest_changes_are_kept_and_a_client_behind_them_is_stale() {
    let mut state = State::default();
    state.absorb(board(&[]), 1);
    let mut waits = Vec::new();
    for revision in 2..(KEPT as u64 + 20) {
        waits.push(pending(&format!("w{revision:04}")));
        state.absorb(board(&waits), revision);
    }

    assert!(state.events.len() <= KEPT);
    assert!(matches!(state.reading(1), Reading::Stale(_)));
    let newest = state.through;
    assert!(matches!(state.reading(newest - 1), Reading::Events(_, events) if events.len() == 1));
}
