use super::*;
use crate::tasks::model::{Review, ReviewVerdict};

fn question() -> Expectation {
    Expectation {
        id: 7.into(),
        title: "Red or blue?".into(),
        parent_type: "task".into(),
        parent_id: 1.into(),
        status: ExpectationStatus::Pending,
        archival: ExpectationArchival::Live,
        time_scope: None,
        tag_ids: vec![],
        check_every: None,
        check_starting: None,
        last_check_at: None,
        position: 0,
        is_private: false,
        agentic: true,
        agentic_note: None,
        question: true,
        answer: None,
        review: None,
        origin: Default::default(),
    }
}

fn review() -> Expectation {
    Expectation {
        review: Some(Review::default()),
        ..question()
    }
}

fn answer(text: &str) -> DraftRequest {
    DraftRequest {
        answer: Some(text.into()),
        verdict: None,
    }
}

fn verdict(verdict: ReviewVerdict, note: Option<&str>) -> DraftRequest {
    DraftRequest {
        answer: note.map(Into::into),
        verdict: Some(verdict),
    }
}

#[test]
fn a_question_draft_stores_its_answer_trimmed() {
    assert_eq!(check(&question(), &answer("  blue \n")), Ok(answer("blue")));
}

#[test]
fn a_blank_answer_to_a_question_is_refused() {
    assert_eq!(
        check(&question(), &answer("  \n")),
        Err(DraftRefusal::BlankAnswer)
    );
    assert_eq!(
        check(&question(), &DraftRequest::default()),
        Err(DraftRefusal::BlankAnswer)
    );
}

#[test]
fn a_verdict_on_a_question_is_refused() {
    assert_eq!(
        check(&question(), &verdict(ReviewVerdict::Approved, Some("blue"))),
        Err(DraftRefusal::VerdictOnQuestion)
    );
}

#[test]
fn a_review_draft_needs_a_verdict() {
    assert_eq!(
        check(&review(), &answer("looks fine")),
        Err(DraftRefusal::VerdictMissing)
    );
}

#[test]
fn a_review_draft_keeps_its_verdict_and_an_optional_note() {
    assert_eq!(
        check(
            &review(),
            &verdict(ReviewVerdict::ChangesRequested, Some(" fix it "))
        ),
        Ok(verdict(ReviewVerdict::ChangesRequested, Some("fix it")))
    );
    assert_eq!(
        check(&review(), &verdict(ReviewVerdict::Approved, Some("  "))),
        Ok(verdict(ReviewVerdict::Approved, None))
    );
}

#[test]
fn a_wait_that_is_not_an_open_question_takes_no_draft() {
    let mut released = question();
    released.status = ExpectationStatus::Released;
    let mut archived = question();
    archived.archival = ExpectationArchival::Archived;
    let mut not_question = question();
    not_question.question = false;
    let mut not_agentic = question();
    not_agentic.agentic = false;
    for wait in [released, archived, not_question, not_agentic] {
        assert_eq!(check(&wait, &answer("x")), Err(DraftRefusal::NotOpen));
    }
}

#[test]
fn an_open_question_or_review_is_sent() {
    assert_eq!(check_sendable(Some(&question())), Sendable::Release);
    assert_eq!(check_sendable(Some(&review())), Sendable::Release);
}

#[test]
fn a_released_wait_is_skipped_as_released() {
    let mut released = question();
    released.status = ExpectationStatus::Released;
    assert_eq!(
        check_sendable(Some(&released)),
        Sendable::Skip(SkipReason::Released)
    );
}

#[test]
fn a_missing_archived_or_non_question_wait_is_skipped_as_gone() {
    let mut archived = question();
    archived.archival = ExpectationArchival::Archived;
    let mut not_question = question();
    not_question.question = false;
    assert_eq!(check_sendable(None), Sendable::Skip(SkipReason::Gone));
    assert_eq!(
        check_sendable(Some(&archived)),
        Sendable::Skip(SkipReason::Gone)
    );
    assert_eq!(
        check_sendable(Some(&not_question)),
        Sendable::Skip(SkipReason::Gone)
    );
}
