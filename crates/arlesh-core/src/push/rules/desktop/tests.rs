//! The desktop follows change events and says what to show.

use super::*;
use crate::board::ChangeOrigin;
use crate::mindmap::{model::MindmapLoad, rules::changes::diff};
use crate::nodes::id::tid;
use crate::nodes::id::tkey;
use crate::push::rules::tests::{asking, lifecycle, todo};
use crate::tasks::lifecycle::Archival;

const EPOCH: &str = "run-1";

fn quiet() -> MindmapLoad {
    MindmapLoad {
        tasks: vec![todo(1), todo(2)],
        lifecycles: vec![
            lifecycle(1, false, Archival::Live),
            lifecycle(2, false, Archival::Live),
        ],
        ..MindmapLoad::default()
    }
}

fn asked(mut load: MindmapLoad) -> MindmapLoad {
    load.facts.insert(tkey("task", 1), asking(7));
    load
}

fn overdue(mut load: MindmapLoad) -> MindmapLoad {
    load.lifecycles[1] = lifecycle(2, true, Archival::Live);
    load
}

fn changes(before: &MindmapLoad, after: &MindmapLoad) -> Value {
    serde_json::from_str(&diff(before, after).unwrap().to_json().unwrap()).unwrap()
}

fn started(board: &MindmapLoad) -> DesktopNotifier {
    let mut notifier = DesktopNotifier::new();
    let shown = notifier
        .load(
            &serde_json::to_value(board).unwrap(),
            EPOCH,
            1,
            &Switches::default(),
        )
        .unwrap();
    assert!(shown.is_empty(), "the first board is already told");
    notifier
}

fn event<'a>(seq: u64, changes: &'a Value) -> Change<'a> {
    Change {
        epoch: EPOCH,
        seq: Some(seq),
        changes: Some(changes),
        reload: false,
        origin: Some(ChangeOrigin::Agent),
    }
}

fn by(origin: ChangeOrigin, change: Change<'_>) -> Change<'_> {
    Change {
        origin: Some(origin),
        ..change
    }
}

fn shown(intake: Intake) -> Vec<String> {
    match intake {
        Intake::Show(events) => events.into_iter().map(|event| event.key).collect(),
        Intake::Resync => panic!("expected notifications, got a resync"),
    }
}

#[test]
fn starting_with_a_question_already_open_tells_nothing_and_a_new_one_tells_once() {
    let before = asked(quiet());
    let mut notifier = started(&before);
    let mut after = before.clone();
    after.facts.insert(tkey("task", 2), asking(8));
    let delta = changes(&before, &after);

    let first = notifier.follow(&event(2, &delta), &Switches::default());
    assert_eq!(shown(first), [format!("question:{}", tid(8))]);

    let again = notifier.follow(&event(2, &delta), &Switches::default());
    assert!(shown(again).is_empty(), "a replayed event tells nothing");
}

#[test]
fn a_task_going_overdue_is_told_by_a_tick_that_carries_no_write() {
    let before = quiet();
    let mut notifier = started(&before);
    let delta = changes(&before, &overdue(quiet()));

    let intake = notifier.follow(&event(2, &delta), &Switches::default());

    assert_eq!(shown(intake), [format!("overdue:{}", tid(2))]);
}

#[test]
fn a_switched_off_event_is_not_shown_and_not_owed_when_switched_on_again() {
    let before = quiet();
    let mut notifier = started(&before);
    let off = Switches::with_off([Channel::AgentQuestion]);
    let delta = changes(&before, &asked(quiet()));

    assert!(shown(notifier.follow(&event(2, &delta), &off)).is_empty());

    let nothing = serde_json::json!({});
    let later = notifier.follow(&event(3, &nothing), &Switches::default());
    assert!(shown(later).is_empty());
}

#[test]
fn the_users_own_write_does_not_notify_what_it_made_true() {
    let before = quiet();
    let mut notifier = started(&before);
    let delta = changes(&before, &overdue(quiet()));

    let intake = notifier.follow(
        &by(ChangeOrigin::User, event(2, &delta)),
        &Switches::default(),
    );

    assert!(shown(intake).is_empty());
}

#[test]
fn the_users_own_write_notifies_neither_a_question_nor_the_capacity_lock() {
    let before = quiet();
    let mut notifier = started(&before);
    let switches = Switches::default();
    let asked = changes(&before, &asked(quiet()));
    let locked = serde_json::json!({ "block_reasons": { "set": [[&tkey("task", 1), [{
        "owner_type": "task", "owner_id": tid(1), "reason": "Agents at capacity",
        "position": 0, "derived": "agent_capacity" }]]], "del": [] } });

    let question = notifier.follow(&by(ChangeOrigin::User, event(2, &asked)), &switches);
    let lock = notifier.follow(&by(ChangeOrigin::User, event(3, &locked)), &switches);

    assert!(shown(question).is_empty(), "ctrl+z reopening a question");
    assert!(shown(lock).is_empty(), "locking an account by hand");
}

#[test]
fn what_the_user_did_is_not_owed_to_them_later() {
    let before = quiet();
    let mut notifier = started(&before);
    let switches = Switches::default();
    let asked_by_user = changes(&before, &asked(quiet()));
    notifier.follow(&by(ChangeOrigin::User, event(2, &asked_by_user)), &switches);

    let nothing = serde_json::json!({});
    let later = notifier.follow(&event(3, &nothing), &switches);

    assert!(shown(later).is_empty());
}

#[test]
fn the_same_change_by_an_agent_or_by_time_notifies() {
    let before = quiet();
    let switches = Switches::default();
    let asked = changes(&before, &asked(quiet()));

    for origin in [Some(ChangeOrigin::Agent), Some(ChangeOrigin::Time), None] {
        let mut notifier = started(&before);
        let change = Change {
            origin,
            ..event(2, &asked)
        };
        assert_eq!(
            shown(notifier.follow(&change, &switches)),
            [format!("question:{}", tid(7))],
            "{origin:?}"
        );
    }
}

#[test]
fn a_gap_a_new_run_or_a_reload_asks_for_the_whole_board() {
    let before = quiet();
    let mut notifier = started(&before);
    let delta = changes(&before, &asked(quiet()));
    let switches = Switches::default();

    assert_eq!(
        notifier.follow(&event(5, &delta), &switches),
        Intake::Resync
    );
    let other_run = Change {
        epoch: "run-2",
        ..event(2, &delta)
    };
    assert_eq!(notifier.follow(&other_run, &switches), Intake::Resync);
    let reload = Change {
        reload: true,
        changes: None,
        ..event(2, &delta)
    };
    assert_eq!(notifier.follow(&reload, &switches), Intake::Resync);
}

#[test]
fn before_the_first_board_there_is_nothing_to_follow() {
    let mut notifier = DesktopNotifier::new();
    let delta = serde_json::json!({});
    assert_eq!(
        notifier.follow(&event(2, &delta), &Switches::default()),
        Intake::Resync
    );
}

#[test]
fn a_board_loaded_after_a_gap_tells_what_is_new_on_it() {
    let before = asked(quiet());
    let mut notifier = started(&before);
    let mut now = overdue(before);
    now.facts.insert(tkey("task", 2), asking(9));

    let shown = notifier
        .load(
            &serde_json::to_value(&now).unwrap(),
            EPOCH,
            9,
            &Switches::default(),
        )
        .unwrap();

    let keys: Vec<&str> = shown.iter().map(|event| event.key.as_str()).collect();
    assert_eq!(
        keys,
        [
            format!("overdue:{}", tid(2)),
            format!("question:{}", tid(9))
        ]
    );
}

#[test]
fn the_capacity_lock_is_told_when_set_and_when_cleared() {
    let before = quiet();
    let mut notifier = started(&before);
    let locked = serde_json::json!({ "block_reasons": { "set": [[&tkey("task", 1), [{
        "owner_type": "task", "owner_id": tid(1), "reason": "Agents at capacity",
        "position": 0, "derived": "agent_capacity" }]]], "del": [] } });
    let lifted = serde_json::json!({ "block_reasons": { "set": [], "del": [tkey("task", 1)] } });
    let switches = Switches::default();

    let set = notifier.follow(&event(2, &locked), &switches);
    let cleared = notifier.follow(&event(3, &lifted), &switches);

    assert_eq!(shown(set), ["capacity"]);
    assert_eq!(shown(cleared), ["capacity"]);
}
