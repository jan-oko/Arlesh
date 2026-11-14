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
        review: None,
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

mod review_content {
    use super::*;
    use crate::tasks::model::{ReviewDetails, ReviewLink};

    fn link(label: &str, url: &str) -> ReviewLink {
        ReviewLink {
            label: label.into(),
            url: url.into(),
        }
    }

    fn details(links: Vec<ReviewLink>, hand_tests: &[&str]) -> ReviewDetails {
        ReviewDetails {
            links,
            hand_tests: hand_tests.iter().map(|test| test.to_string()).collect(),
        }
    }

    fn refused(title: &str, summary: &str, details: ReviewDetails) -> ReviewRefusal {
        normalise_review(title, Some(summary), details).expect_err("the review is refused")
    }

    #[test]
    fn a_blank_title_is_refused() {
        assert_eq!(
            refused("  ", "Changed it", ReviewDetails::default()),
            ReviewRefusal::BlankTitle
        );
    }

    #[test]
    fn a_blank_or_missing_summary_is_refused() {
        assert_eq!(
            refused("Review", "", ReviewDetails::default()),
            ReviewRefusal::BlankSummary
        );
        assert_eq!(
            normalise_review("Review", None, ReviewDetails::default()).expect_err("no summary"),
            ReviewRefusal::BlankSummary
        );
    }

    #[test]
    fn blank_hand_tests_are_dropped_and_the_rest_trimmed() {
        let (_, _, kept) = normalise_review(
            "Review",
            Some("Changed it"),
            details(vec![], &["", "  ", " Press Enter "]),
        )
        .expect("accepted");
        assert_eq!(kept.hand_tests, vec!["Press Enter".to_string()]);
    }

    #[test]
    fn a_link_needs_a_label_and_a_url() {
        for blank in [link("", ""), link("PR", " "), link(" ", "https://a.test/x")] {
            assert_eq!(
                refused("Review", "Changed it", details(vec![blank], &[])),
                ReviewRefusal::BlankLink
            );
        }
    }

    #[test]
    fn only_http_and_https_urls_are_accepted() {
        for url in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "ftp://a.test/x",
            "https://",
            "https://a.test/a b",
            "//a.test/x",
        ] {
            assert!(
                matches!(
                    refused("Review", "Changed it", details(vec![link("PR", url)], &[])),
                    ReviewRefusal::BadUrl(_)
                ),
                "{url} is refused"
            );
        }
        let (_, _, kept) = normalise_review(
            "Review",
            Some("Changed it"),
            details(
                vec![
                    link("PR", "HTTPS://github.com/o/r/pull/1"),
                    link("Doc", "http://a.test/x"),
                ],
                &[],
            ),
        )
        .expect("accepted");
        assert_eq!(kept.links.len(), 2);
    }

    #[test]
    fn every_field_has_a_cap() {
        let long = |n: usize| "x".repeat(n);
        assert!(matches!(
            refused(&long(MAX_TITLE + 1), "s", ReviewDetails::default()),
            ReviewRefusal::TooLong { field: "title", .. }
        ));
        assert!(matches!(
            refused("t", &long(MAX_SUMMARY + 1), ReviewDetails::default()),
            ReviewRefusal::TooLong {
                field: "summary",
                ..
            }
        ));
        assert!(matches!(
            refused("t", "s", details(vec![], &[&long(MAX_HAND_TEST + 1)])),
            ReviewRefusal::TooLong {
                field: "hand test",
                ..
            }
        ));
        assert!(matches!(
            refused(
                "t",
                "s",
                details(vec![link(&long(MAX_LABEL + 1), "https://a.test")], &[])
            ),
            ReviewRefusal::TooLong {
                field: "link label",
                ..
            }
        ));
        let many_links = vec![link("PR", "https://a.test"); MAX_LINKS + 1];
        assert!(matches!(
            refused("t", "s", details(many_links, &[])),
            ReviewRefusal::TooMany { what: "links", .. }
        ));
        let tests = vec!["try"; MAX_HAND_TESTS + 1];
        assert!(matches!(
            refused("t", "s", details(vec![], &tests)),
            ReviewRefusal::TooMany {
                what: "hand tests",
                ..
            }
        ));
    }

    #[test]
    fn a_review_needs_an_agentic_wait() {
        assert_eq!(require_agentic(false, true), Err(ReviewRefusal::NotAgentic));
        assert_eq!(require_agentic(true, true), Ok(()));
        assert_eq!(require_agentic(false, false), Ok(()));
    }

    #[test]
    fn only_a_task_an_agent_holds_takes_a_review() {
        assert_eq!(require_held(&ON_AGENT), Ok(()));
        assert_eq!(require_held(&REVIEW), Ok(()));
        let todo = Status::Agentic(AgenticStatus::Todo);
        assert_eq!(require_held(&todo), Err(ReviewRefusal::TaskNotHeld));
    }

    #[test]
    fn a_released_question_or_review_is_not_released_again() {
        let mut released = wait(1, true);
        released.status = ExpectationStatus::Released;
        assert_eq!(
            require_open_for_agent_release(&released),
            Err(ReviewRefusal::AlreadyReleased)
        );
        assert_eq!(require_open_for_agent_release(&wait(1, true)), Ok(()));
        let mut ci = wait(1, false);
        ci.status = ExpectationStatus::Released;
        assert_eq!(
            require_open_for_agent_release(&ci),
            Ok(()),
            "a CI wait is idempotent"
        );
    }
}
