use std::{collections::BTreeMap, time::Duration};

use super::{
    rules::{admitted, changes, Change, WaitState},
    ChangeFeed,
};
use crate::tasks::model::ExpectationStatus;

fn wait(id: &str, status: ExpectationStatus, archived: bool) -> WaitState {
    WaitState {
        wait_id: id.into(),
        short_id: id[..3].into(),
        task_id: "task-full".into(),
        task_short_id: "4ab".into(),
        status,
        archived,
        question: true,
    }
}

fn board(waits: &[WaitState]) -> BTreeMap<String, WaitState> {
    waits
        .iter()
        .map(|wait| (wait.wait_id.clone(), wait.clone()))
        .collect()
}

fn kinds(before: Vec<WaitState>, after: Vec<WaitState>) -> Vec<Change> {
    changes(&board(&before), &board(&after))
        .into_iter()
        .map(|event| event.change)
        .collect()
}

#[test]
fn a_wait_that_did_not_move_is_no_event() {
    let one = wait("aaa111", ExpectationStatus::Pending, false);

    assert!(kinds(vec![one.clone()], vec![one]).is_empty());
}

#[test]
fn a_released_wait_is_released_and_a_reopened_one_is_reopened() {
    let pending = wait("aaa111", ExpectationStatus::Pending, false);
    let released = wait("aaa111", ExpectationStatus::Released, false);

    assert_eq!(
        kinds(vec![pending.clone()], vec![released.clone()]),
        [Change::Released]
    );
    assert_eq!(kinds(vec![released], vec![pending]), [Change::Reopened]);
}

#[test]
fn archiving_and_unarchiving_are_events_and_status_comes_before_archival() {
    let live = wait("aaa111", ExpectationStatus::Pending, false);
    let archived = wait("aaa111", ExpectationStatus::Pending, true);
    let released_and_archived = wait("aaa111", ExpectationStatus::Released, true);

    assert_eq!(
        kinds(vec![live.clone()], vec![archived.clone()]),
        [Change::Archived]
    );
    assert_eq!(
        kinds(vec![archived], vec![live.clone()]),
        [Change::Unarchived]
    );
    assert_eq!(
        kinds(vec![live], vec![released_and_archived]),
        [Change::Released, Change::Archived]
    );
}

#[test]
fn a_wait_that_vanishes_is_deleted_carrying_its_last_state() {
    let one = wait("aaa111", ExpectationStatus::Pending, false);

    let events = changes(&board(std::slice::from_ref(&one)), &board(&[]));

    assert_eq!(events.len(), 1);
    assert!(events[0].deleted());
    assert_eq!(events[0].wait, one);
}

#[test]
fn a_wait_that_appears_is_created() {
    let one = wait("aaa111", ExpectationStatus::Pending, false);

    assert_eq!(kinds(vec![], vec![one]), [Change::Created]);
}

#[test]
fn only_a_loopback_host_without_an_origin_is_admitted() {
    assert!(admitted(Some("127.0.0.1:4747"), None));
    assert!(admitted(Some("localhost"), None));
    assert!(admitted(Some("[::1]:4747"), None));
    assert!(!admitted(Some("example.com"), None));
    assert!(!admitted(None, None));
    assert!(!admitted(Some("127.0.0.1"), Some("https://example.com")));
}

#[tokio::test]
async fn the_feed_counts_writes_and_wakes_a_waiter() {
    let feed = ChangeFeed::new();
    assert_eq!(feed.revision(), 0);
    let waiter = tokio::spawn({
        let feed = feed.clone();
        async move { feed.after(0).await }
    });

    feed.announcer()(None);

    let reached = tokio::time::timeout(Duration::from_secs(5), waiter)
        .await
        .expect("the waiter was not woken")
        .expect("the waiter panicked");
    assert_eq!(reached, 1);
    assert!(!feed.epoch().is_empty());
}
