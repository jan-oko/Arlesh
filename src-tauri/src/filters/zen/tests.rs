//! The Zen View's contents, ported from `src/utils/zen-contents.test.ts` as their specification.
//! The focus exemption is the frontend's, and is not here.

use super::*;
use crate::filters::model::{NodeFacts, NodeKind, TagMode};
use crate::tasks::{lifecycle::Timing, model::Verdict};

fn row(node: NodeFacts) -> OwnedRow {
    OwnedRow {
        node,
        ancestors: Vec::new(),
    }
}

fn task(id: &str, status: &str) -> OwnedRow {
    let mut node = NodeFacts::new(id, NodeKind::Task);
    node.status = Some(status.to_string());
    row(node)
}

fn agentic(id: &str, status: &str) -> OwnedRow {
    let mut row = task(id, status);
    row.node.agentic = true;
    row
}

fn wait(id: &str, agent_waiting: bool) -> OwnedRow {
    let mut node = NodeFacts::new(id, NodeKind::Expectation);
    node.status = Some("pending".to_string());
    node.timing = Some(Timing::Active);
    node.agent_waiting = agent_waiting;
    row(node)
}

fn commitment(id: &str, verdict: Verdict) -> OwnedRow {
    let mut node = NodeFacts::new(id, NodeKind::Commitment);
    node.verdict = Some(verdict);
    node.timing = Some(Timing::Active);
    row(node)
}

fn every_strip() -> ZenOptions {
    ZenOptions {
        commitments: true,
        expectations: true,
        ..ZenOptions::default()
    }
}

fn ids(rows: &[&OwnedRow]) -> Vec<String> {
    rows.iter().map(|row| row.node.id.clone()).collect()
}

#[test]
fn the_grid_reads_do_in_board_order_whatever_the_tabs_own_preset() {
    let tasks = [
        task("task-1", "todo"),
        task("task-2", "in_progress"),
        task("task-3", "done"),
        task("task-4", "in_progress"),
    ];
    let source = ZenSource {
        tasks: &tasks,
        commitments: &[],
        expectations: &[],
    };
    let zen = contents(source, &BoardFilter::preset(Preset::Plan), &every_strip());
    assert_eq!(ids(&zen.tasks), ["task-2", "task-4"]);
}

#[test]
fn the_strips_read_do_for_commitments_and_start_for_waits_and_a_hidden_strip_is_empty() {
    let commitments = [
        commitment("commitment-1", Verdict::Unresolved),
        commitment("commitment-2", Verdict::Kept),
    ];
    let expectations = [wait("expectation-1", false), wait("expectation-2", true)];
    let source = ZenSource {
        tasks: &[],
        commitments: &commitments,
        expectations: &expectations,
    };
    let zen = contents(source, &BoardFilter::default(), &every_strip());
    assert_eq!(ids(&zen.commitments), ["commitment-1"]);
    assert_eq!(
        ids(&zen.expectations),
        ["expectation-1"],
        "an agentic wait stays off the strip"
    );
    let hidden = contents(source, &BoardFilter::default(), &ZenOptions::default());
    assert!(hidden.commitments.is_empty());
    assert!(hidden.expectations.is_empty());
}

#[test]
fn review_leads_doing_stays_and_on_agent_waits_for_its_pill() {
    let tasks = [
        agentic("task-doing", "doing"),
        agentic("task-on-agent", "on_agent"),
        agentic("task-review", "review"),
    ];
    let source = ZenSource {
        tasks: &tasks,
        commitments: &[],
        expectations: &[],
    };
    let zen = contents(source, &BoardFilter::default(), &every_strip());
    assert_eq!(ids(&zen.tasks), ["task-review", "task-doing"]);
    let on_agent = BoardFilter {
        show_on_agent: true,
        ..BoardFilter::default()
    };
    let zen = contents(source, &on_agent, &every_strip());
    assert_eq!(
        ids(&zen.tasks),
        ["task-review", "task-doing", "task-on-agent"]
    );
}

#[test]
fn the_agentic_pill_narrows_the_grid_and_no_other_pill_does() {
    let tasks = [task("task-1", "in_progress"), agentic("task-2", "doing")];
    let source = ZenSource {
        tasks: &tasks,
        commitments: &[],
        expectations: &[],
    };
    let options = ZenOptions {
        agentic: vec![Pill {
            value: "agentic".to_string(),
            mode: TagMode::Exclude,
        }],
        ..every_strip()
    };
    let mut filter = BoardFilter::default();
    filter.pills.task_status = vec![Pill {
        value: "done".to_string(),
        mode: TagMode::Any,
    }];
    let zen = contents(source, &filter, &options);
    assert_eq!(ids(&zen.tasks), ["task-1"]);
}

#[test]
fn compound_and_delegated_tasks_leave_the_grid() {
    let mut compound = task("task-compound", "in_progress");
    compound.node.compound = true;
    let mut delegated = task("task-delegated", "in_progress");
    delegated.node.delegated = true;
    let tasks = [compound, delegated, task("task-plain", "in_progress")];
    let source = ZenSource {
        tasks: &tasks,
        commitments: &[],
        expectations: &[],
    };
    let zen = contents(source, &BoardFilter::default(), &every_strip());
    assert_eq!(ids(&zen.tasks), ["task-plain"]);
    let shows_compound = ZenOptions {
        shows_compound: true,
        ..every_strip()
    };
    let zen = contents(source, &BoardFilter::default(), &shows_compound);
    assert_eq!(ids(&zen.tasks), ["task-compound", "task-plain"]);
}
