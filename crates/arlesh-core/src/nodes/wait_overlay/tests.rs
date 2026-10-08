//! Recording and applying a derived wait's own fields: an override only where it differs from
//! what the wait is drawn with, and nothing at all once every field is set back.

use chrono::NaiveDate;

use super::*;
use crate::nodes::origin::{Origin, WaitOrigin};
use crate::tasks::model::ExpectationStatus;

fn at(iso: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%S").unwrap()
}

fn day(date: &str) -> TimeScope {
    TimeScope::single(ScopeKey::day(
        NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap(),
    ))
}

/// A spawned wait as its Task's template draws it: "Reviewer replies", a two-day window, checked
/// every week from 8 July.
fn drawn() -> Expectation {
    Expectation {
        id: crate::nodes::id::NodeId::Stored(0),
        title: "Reviewer replies".into(),
        parent_type: "task".into(),
        parent_id: 7.into(),
        status: ExpectationStatus::Pending,
        archival: ExpectationArchival::Live,
        time_scope: Some(day("2026-07-01")),
        tag_ids: vec![],
        check_every: Some(DurationSpec {
            n: 1,
            kind: "week".into(),
        }),
        check_starting: Some(at("2026-07-08T09:00:00")),
        last_check_at: None,
        position: 0,
        is_private: false,
        agentic: false,
        agentic_note: None,
        question: false,
        answer: None,
        origin: Origin::SpawnedWait(WaitOrigin { task_id: 7.into() }),
    }
}

#[test]
fn every_field_set_on_one_wait_is_read_back_over_what_it_is_drawn_with() {
    let base = drawn();
    let mut overlay = ExpectationOverlay::default();
    overlay.set_title("Chase the reviewer".into(), &base);
    overlay.set_time_scope(Some(day("2026-07-03")), &base);
    overlay.set_check_every(None, &base);
    overlay.set_check_starting(at("2026-07-10T02:00:00"), &base);
    overlay.set_is_private(true, &base);
    overlay.set_agentic(true, &base);
    overlay.set_agentic_note(Some("Waiting on CI".into()), &base);
    overlay.set_question(true, &base);
    overlay.set_answer(Some("Green".into()), &base);

    let mut read = drawn();
    overlay.apply(&mut read);
    assert_eq!(read.title, "Chase the reviewer");
    assert_eq!(read.time_scope, Some(day("2026-07-03")));
    assert_eq!(read.check_every, None, "overridden to never");
    assert_eq!(read.check_starting, Some(at("2026-07-10T02:00:00")));
    assert!(read.is_private);
    assert!(read.agentic);
    assert_eq!(read.agentic_note.as_deref(), Some("Waiting on CI"));
    assert!(read.question);
    assert_eq!(read.answer.as_deref(), Some("Green"));
    // The template draws the next wait as it always did: nothing was written to it.
    assert_eq!(drawn().title, "Reviewer replies");
}

#[test]
fn a_field_set_back_to_what_it_is_drawn_with_clears_the_override() {
    let base = drawn();
    let mut overlay = ExpectationOverlay::default();
    overlay.set_title("Chase the reviewer".into(), &base);
    overlay.set_time_scope(None, &base);
    overlay.set_is_private(true, &base);
    assert!(!overlay.is_empty());

    overlay.set_title("Reviewer replies".into(), &base);
    overlay.set_time_scope(Some(day("2026-07-01")), &base);
    overlay.set_is_private(false, &base);
    assert!(overlay.is_empty(), "{overlay:?}");
}

#[test]
fn a_full_editor_save_repeating_what_is_shown_records_nothing() {
    let base = drawn();
    let mut overlay = ExpectationOverlay::default();
    overlay.set_title(base.title.clone(), &base);
    overlay.set_time_scope(base.time_scope.clone(), &base);
    overlay.set_check_every(base.check_every.clone(), &base);
    // The editor names the day, at the day's start: the same day is no change.
    overlay.set_check_starting(at("2026-07-08T02:00:00"), &base);
    overlay.set_is_private(base.is_private, &base);
    overlay.set_agentic(base.agentic, &base);
    overlay.set_agentic_note(None, &base);
    overlay.set_question(base.question, &base);
    overlay.set_answer(None, &base);
    assert!(overlay.is_empty(), "{overlay:?}");
}

#[test]
fn a_delegation_waits_archive_is_its_own() {
    let base = drawn();
    let mut overlay = ExpectationOverlay::default();
    overlay.set_archival(ExpectationArchival::Archived, &base);
    let mut read = drawn();
    overlay.apply(&mut read);
    assert_eq!(read.archival, ExpectationArchival::Archived);
    overlay.set_archival(ExpectationArchival::Live, &base);
    assert!(overlay.is_empty());
}
