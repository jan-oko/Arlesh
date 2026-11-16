//! The view reads the same facts off a board however it came to hold it.

use crate::nodes::id::tid;
use super::*;
use crate::nodes::id::tkey;
use crate::mindmap::rules::changes::diff;
use crate::push::rules::tests::{asking, check, lifecycle, todo};

fn board(tasks: Vec<Task>, lifecycles: Vec<ItemLifecycle>) -> MindmapLoad {
    MindmapLoad {
        tasks,
        lifecycles,
        ..MindmapLoad::default()
    }
}

fn changes_json(before: &MindmapLoad, after: &MindmapLoad) -> Value {
    let json = diff(before, after).unwrap().to_json().unwrap();
    serde_json::from_str(&json).unwrap()
}

fn json_of(load: &MindmapLoad) -> Value {
    serde_json::to_value(load).unwrap()
}

#[test]
fn a_view_of_the_board_as_json_is_the_view_of_the_board() {
    let mut load = board(
        vec![todo(1), todo(2), check(3)],
        vec![
            lifecycle(1, false, Archival::Live),
            lifecycle(2, true, Archival::Live),
            lifecycle(3, false, Archival::Live),
        ],
    );
    load.facts.insert(tkey("task", 1), asking(7));

    let from_json = BoardView::from_json(&json_of(&load)).unwrap();

    assert_eq!(from_json, BoardView::from_load(&load));
    assert_eq!(from_json.observed(false).facts.len(), 3);
}

#[test]
fn applying_the_diff_of_two_boards_gives_the_view_of_the_second() {
    let before = board(
        vec![todo(1), todo(2)],
        vec![lifecycle(1, false, Archival::Live)],
    );
    let mut after = board(
        vec![todo(1), check(3)],
        vec![
            lifecycle(1, true, Archival::Live),
            lifecycle(3, false, Archival::Live),
        ],
    );
    after.facts.insert(tkey("task", 1), asking(5));

    let mut view = BoardView::from_load(&before);
    view.apply(&changes_json(&before, &after)).unwrap();

    assert_eq!(view, BoardView::from_load(&after));
}

#[test]
fn a_question_that_closes_is_forgotten_by_the_view() {
    let mut asked = board(vec![todo(1)], vec![]);
    asked.facts.insert(tkey("task", 1), asking(5));
    let answered = board(vec![todo(1)], vec![]);

    let mut view = BoardView::from_load(&asked);
    view.apply(&changes_json(&asked, &answered)).unwrap();

    assert!(view.observed(false).facts.is_empty());
}

#[test]
fn the_capacity_lock_is_read_off_the_blocks_it_derives() {
    let locked = serde_json::json!({
        "block_reasons": { "set": [[&tkey("task", 1), [{
            "owner_type": "task", "owner_id": tid(1), "reason": "Agents at capacity",
            "position": 0, "derived": "agent_capacity"
        }]]], "del": [] }
    });
    let written = serde_json::json!({
        "block_reasons": { "set": [[&tkey("task", 1), [{
            "owner_type": "task", "owner_id": tid(1), "reason": "waiting", "position": 0
        }]]], "del": [] }
    });
    let lifted = serde_json::json!({ "block_reasons": { "set": [], "del": [tkey("task", 1)] } });
    let mut view = BoardView::default();

    view.apply(&locked).unwrap();
    assert!(view.capacity_locked());
    view.apply(&written).unwrap();
    assert!(
        !view.capacity_locked(),
        "a reason someone wrote is not the lock"
    );
    view.apply(&locked).unwrap();
    view.apply(&lifted).unwrap();
    assert!(!view.capacity_locked());
}

#[test]
fn an_entry_that_is_not_what_it_says_leaves_the_view_as_it_was() {
    let mut view = BoardView::from_load(&board(vec![todo(1)], vec![]));
    let before = view.clone();
    let bad = serde_json::json!({ "tasks": { "set": [[&tkey("task", 2), { "id": "nonsense" }]], "del": [tkey("task", 1)] } });

    assert!(view.apply(&bad).is_err());
    assert_eq!(view, before);
}
