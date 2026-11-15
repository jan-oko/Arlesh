//! `arlesh_waits.list`: the agentic waits on the board, one cheap row each.
//!
//! The snapshot's `expectations` section carries every wait with its whole note and answer, so
//! finding the open questions under one project meant paging through all of them. A listed row
//! has only what is needed to choose one: its ids, title, status, kind and the Task it hangs
//! under. The note and the answer come from `get`.

use std::collections::HashMap;

use serde_json::{json, Value};

use super::{
    lookup::{found, Answer, Board},
    paging::{self, Cursor, Section, SectionItems, PAGE_BUDGET},
    params::{NodeIdParam, WaitStatusParam},
    result,
};
use crate::{
    access::model::NodeTable,
    nodes::id::NodeId,
    tasks::model::{Expectation, ExpectationStatus},
};

/// The kinds of node a wait can be asked about as `under`.
const UNDER_KINDS: [&str; 3] = ["domain", "goal", "task"];

/// What `list` was asked for.
pub(super) struct Query<'asked> {
    /// Which waits by status; pending when not given.
    pub status: Option<WaitStatusParam>,
    /// The node the waits must hang beneath, anywhere.
    pub under: Option<&'asked NodeIdParam>,
    /// Questions only (`true`), the others only (`false`), or both.
    pub question: Option<bool>,
    /// The previous page's `next_cursor`.
    pub cursor: Option<&'asked str>,
}

type NodeRef = (NodeTable, NodeId);

/// The waits that match `query`, one page of them.
pub(super) fn list(board: &Board, query: &Query<'_>) -> Answer {
    let under = match query.under {
        Some(id) => {
            let named = found!(board.resolve_among(id, &UNDER_KINDS));
            Some((named.table, named.node_id.clone()))
        }
        None => None,
    };
    let parents = parent_index(board);
    let wanted = query.status.unwrap_or(WaitStatusParam::Pending);

    let items: Vec<Value> = board
        .load
        .expectations
        .iter()
        .filter(|wait| wait.agentic && wait.parent_type == "task")
        .filter(|wait| matches_status(wait, wanted))
        .filter(|wait| query.question.is_none_or(|asked| wait.question == asked))
        .filter(|wait| {
            under
                .as_ref()
                .is_none_or(|node| hangs_beneath(wait, node, &parents))
        })
        .map(|wait| row(board, wait))
        .collect();

    let start = Cursor::start(&[Section::Expectations]).unwrap_or(Cursor {
        section: Section::Expectations,
        offset: 0,
    });
    let cursor = match query.cursor.map(Cursor::parse).transpose() {
        Ok(parsed) => parsed.unwrap_or(start),
        Err(error) => return result::refused(error.to_string()),
    };
    let available = [SectionItems {
        section: Section::Expectations,
        items,
    }];
    let page = match paging::take_page(&available, cursor, PAGE_BUDGET) {
        Ok(page) => page,
        Err(error) => return result::refused(error.to_string()),
    };
    let waits = page
        .sections
        .into_iter()
        .next()
        .map(|(_, items)| items)
        .unwrap_or_default();
    result::ok(json!({
        "waits": waits,
        "next_cursor": page.next.map(Cursor::as_token),
    }))
}

fn matches_status(wait: &Expectation, wanted: WaitStatusParam) -> bool {
    match wanted {
        WaitStatusParam::All => true,
        WaitStatusParam::Pending => wait.status == ExpectationStatus::Pending,
        WaitStatusParam::Released => wait.status == ExpectationStatus::Released,
    }
}

/// One wait as a list row: ids, title, status, kind, and the Task it hangs under.
fn row(board: &Board, wait: &Expectation) -> Value {
    let state = super::events::wait_state(board, wait);
    let task = board.task(&wait.parent_id);
    json!({
        "id": wait.id,
        "short_id": state.short_id,
        "full_id": state.wait_id,
        "title": wait.title,
        "status": wait.status,
        "question": wait.question,
        "task": {
            "id": wait.parent_id,
            "short_id": state.task_short_id,
            "full_id": state.task_id,
            "title": task.map(|task| task.title.as_str()),
        },
    })
}

/// Each visible domain, goal, commitment and Task's parent: what one step up the tree is.
fn parent_index(board: &Board) -> HashMap<NodeRef, NodeRef> {
    let load = &board.load;
    let reference = |parent_type: &str, parent_id: &NodeId| {
        NodeTable::from_reference(parent_type).map(|table| (table, parent_id.clone()))
    };
    let mut parents = HashMap::new();
    for domain in &load.domains {
        if let Some(parent) = domain.parent_id {
            parents.insert(
                (NodeTable::Domain, NodeId::Stored(domain.id)),
                (NodeTable::Domain, NodeId::Stored(parent)),
            );
        }
    }
    for goal in &load.goals {
        if let Some(parent) = reference(&goal.parent_type, &goal.parent_id) {
            parents.insert((NodeTable::Goal, goal.id.clone()), parent);
        }
    }
    for task in &load.tasks {
        if let Some(parent) = reference(&task.parent_type, &task.parent_id) {
            parents.insert((NodeTable::Task, task.id.clone()), parent);
        }
    }
    for commitment in &load.commitments {
        if let Some(parent) = reference(&commitment.parent_type, &commitment.parent_id) {
            parents.insert((NodeTable::Commitment, commitment.id.clone()), parent);
        }
    }
    parents
}

/// Whether `wait` hangs anywhere beneath `node`, or directly under it when it is a Task.
fn hangs_beneath(wait: &Expectation, node: &NodeRef, parents: &HashMap<NodeRef, NodeRef>) -> bool {
    let mut current = (NodeTable::Task, wait.parent_id.clone());
    // A tree cannot revisit a node; the bound only keeps a corrupt cycle from looping.
    for _ in 0..=parents.len() {
        if &current == node {
            return true;
        }
        match parents.get(&current) {
            Some(parent) => current = parent.clone(),
            None => return false,
        }
    }
    false
}
