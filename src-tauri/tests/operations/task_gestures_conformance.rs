//! What a press writes, replayed from the shared conformance corpus.
//!
//! `conformance/task-gestures.json` writes the status step, `Alt+Enter`, the Compound refusal and the
//! verdict down as data. This runs every case through `tasks::rules::gestures`;
//! `src/utils/task-gestures-conformance.test.ts` runs them through the TypeScript copy the board uses
//! to show a press before the server answers it (ADR 0012, decision 13). Neither side generates the
//! file.

use arlesh_lib::tasks::model::{AgenticStatus, Status, TaskStatus, Verdict};
use arlesh_lib::tasks::rules::gestures::{
    alt_step, next_status, status_after, verdict_after, StatusRefusal, StatusStep, VerdictPress,
};
use serde::Deserialize;

const CORPUS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../conformance/task-gestures.json"
));

/// What a gesture leaves: a status, or the reason nothing is written.
#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "outcome", rename_all = "snake_case")]
enum Expected {
    Written { status: Status },
    Refused { reason: StatusRefusal },
}

impl From<Expected> for Result<Status, StatusRefusal> {
    fn from(expected: Expected) -> Self {
        match expected {
            Expected::Written { status } => Ok(status),
            Expected::Refused { reason } => Err(reason),
        }
    }
}

#[derive(Debug, Deserialize)]
struct NextCase {
    current: Status,
    next: Status,
}

#[derive(Debug, Deserialize)]
struct AltCase {
    current: Status,
    result: Expected,
}

#[derive(Debug, Deserialize)]
struct AfterCase {
    step: StatusStep,
    current: Status,
    compound: bool,
    result: Expected,
}

#[derive(Debug, Deserialize)]
struct VerdictCase {
    press: VerdictPress,
    current: Verdict,
    verdict: Verdict,
}

#[derive(Debug, Deserialize)]
struct Corpus {
    next_status: Vec<NextCase>,
    alt_step: Vec<AltCase>,
    status_after: Vec<AfterCase>,
    verdict_after: Vec<VerdictCase>,
}

fn corpus() -> Corpus {
    serde_json::from_str(CORPUS).expect("the corpus parses")
}

fn every_status() -> Vec<Status> {
    let ordinary = [
        TaskStatus::Todo,
        TaskStatus::InProgress,
        TaskStatus::Started,
        TaskStatus::Done,
    ]
    .map(Status::Ordinary);
    let agentic = [
        AgenticStatus::Todo,
        AgenticStatus::OnAgent,
        AgenticStatus::Review,
        AgenticStatus::Doing,
        AgenticStatus::Done,
    ]
    .map(Status::Agentic);
    ordinary.into_iter().chain(agentic).collect()
}

#[test]
fn every_status_steps_as_the_corpus_says() {
    for case in corpus().next_status {
        assert_eq!(next_status(case.current), case.next, "{:?}", case.current);
    }
}

#[test]
fn alt_enter_does_what_the_corpus_says() {
    for case in corpus().alt_step {
        assert_eq!(
            alt_step(case.current),
            Result::from(case.result),
            "{:?}",
            case.current
        );
    }
}

#[test]
fn a_step_on_a_compound_or_an_ordinary_task_does_what_the_corpus_says() {
    for case in corpus().status_after {
        assert_eq!(
            status_after(case.step, case.current, case.compound),
            Result::from(case.result),
            "{:?} on {:?} (compound: {})",
            case.step,
            case.current,
            case.compound
        );
    }
}

#[test]
fn every_press_leaves_the_verdict_the_corpus_says() {
    for case in corpus().verdict_after {
        assert_eq!(
            verdict_after(case.press, case.current),
            case.verdict,
            "{:?} on {:?}",
            case.press,
            case.current
        );
    }
}

#[test]
fn every_status_and_every_press_has_a_case() {
    let corpus = corpus();
    for status in every_status() {
        assert!(
            corpus.next_status.iter().any(|case| case.current == status),
            "{status:?} has no next_status case"
        );
        assert!(
            corpus.alt_step.iter().any(|case| case.current == status),
            "{status:?} has no alt_step case"
        );
        for step in [StatusStep::Advance, StatusStep::Alt] {
            for compound in [false, true] {
                assert!(
                    corpus.status_after.iter().any(|case| case.step == step
                        && case.current == status
                        && case.compound == compound),
                    "{step:?} on {status:?} (compound: {compound}) has no status_after case"
                );
            }
        }
    }
    for press in [
        VerdictPress::Cycle,
        VerdictPress::Kept,
        VerdictPress::Broken,
    ] {
        for current in [Verdict::Unresolved, Verdict::Kept, Verdict::Broken] {
            assert!(
                corpus
                    .verdict_after
                    .iter()
                    .any(|case| case.press == press && case.current == current),
                "{press:?} on {current:?} has no verdict_after case"
            );
        }
    }
}
