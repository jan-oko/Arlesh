//! The desktop follows change events and says what to show.

use super::*;
use crate::mindmap::{model::MindmapLoad, rules::changes::diff};
use crate::push::rules::tests::{asking, check, lifecycle, todo};
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
    load.facts.insert("task-1".to_string(), asking(7));
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
            1,
            &Switches::default(),
        )
        .unwrap();
    assert!(shown.is_empty(), "the first board is already told");
    notifier
}

fn event<'a>(seq: u64, revision: u64, changes: &'a Value) -> Change<'a> {
    Change {
        epoch: EPOCH,
        seq: Some(seq),
        revision,
        changes: Some(changes),
        reload: false,
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
    after.facts.insert("task-2".to_string(), asking(8));
    let delta = changes(&before, &after);

    let first = notifier.follow(&event(2, 2, &delta), &Switches::default());
    assert_eq!(shown(first), ["question:8"]);

    let again = notifier.follow(&event(2, 2, &delta), &Switches::default());
    assert!(shown(again).is_empty(), "a replayed event tells nothing");
}

#[test]
fn a_task_going_overdue_is_told_by_a_tick_that_carries_no_write() {
    let before = quiet();
    let mut notifier = started(&before);
    let delta = changes(&before, &overdue(quiet()));

    let intake = notifier.follow(&event(2, 1, &delta), &Switches::default());

    assert_eq!(shown(intake), ["overdue:2"]);
}

#[test]
fn a_switched_off_event_is_not_shown_and_not_owed_when_switched_on_again() {
    let before = quiet();
    let mut notifier = started(&before);
    let off = Switches::with_off([Channel::AgentQuestion]);
    let delta = changes(&before, &asked(quiet()));

    assert!(shown(notifier.follow(&event(2, 2, &delta), &off)).is_empty());

    let nothing = serde_json::json!({});
    let later = notifier.follow(&event(3, 3, &nothing), &Switches::default());
    assert!(shown(later).is_empty());
}

#[test]
fn the_users_own_write_does_not_notify_what_it_made_true() {
    let before = quiet();
    let mut notifier = started(&before);
    notifier.note_own_write(EPOCH, 2);
    let delta = changes(&before, &overdue(quiet()));

    let intake = notifier.follow(&event(2, 2, &delta), &Switches::default());

    assert!(shown(intake).is_empty());
}

#[test]
fn an_own_write_never_hides_an_agents_question() {
    let before = quiet();
    let mut notifier = started(&before);
    notifier.note_own_write(EPOCH, 2);
    let delta = changes(&before, &asked(quiet()));

    let intake = notifier.follow(&event(2, 2, &delta), &Switches::default());

    assert_eq!(shown(intake), ["question:7"]);
}

#[test]
fn an_own_write_the_publication_does_not_hold_yet_waits_for_the_one_that_does() {
    let before = quiet();
    let mut notifier = started(&before);
    notifier.note_own_write(EPOCH, 5);
    let tick = changes(&before, &overdue(quiet()));
    let tell = notifier.follow(&event(2, 3, &tick), &Switches::default());
    assert_eq!(
        shown(tell),
        ["overdue:2"],
        "revision 3 does not hold write 5"
    );

    let mut with_generated = quiet();
    with_generated.tasks.push(check(3));
    with_generated
        .lifecycles
        .push(lifecycle(3, false, Archival::Live));
    let delta = changes(&overdue(quiet()), &overdue(with_generated));
    let own = notifier.follow(&event(3, 5, &delta), &Switches::default());
    assert!(shown(own).is_empty(), "revision 5 holds the user's write");
}

#[test]
fn a_gap_a_new_run_or_a_reload_asks_for_the_whole_board() {
    let before = quiet();
    let mut notifier = started(&before);
    let delta = changes(&before, &asked(quiet()));
    let switches = Switches::default();

    assert_eq!(
        notifier.follow(&event(5, 5, &delta), &switches),
        Intake::Resync
    );
    let other_run = Change {
        epoch: "run-2",
        ..event(2, 2, &delta)
    };
    assert_eq!(notifier.follow(&other_run, &switches), Intake::Resync);
    let reload = Change {
        reload: true,
        changes: None,
        ..event(2, 2, &delta)
    };
    assert_eq!(notifier.follow(&reload, &switches), Intake::Resync);
}

#[test]
fn before_the_first_board_there_is_nothing_to_follow() {
    let mut notifier = DesktopNotifier::new();
    let delta = serde_json::json!({});
    assert_eq!(
        notifier.follow(&event(2, 2, &delta), &Switches::default()),
        Intake::Resync
    );
}

#[test]
fn a_board_loaded_after_a_gap_tells_what_is_new_on_it() {
    let before = asked(quiet());
    let mut notifier = started(&before);
    let mut now = overdue(before);
    now.facts.insert("task-2".to_string(), asking(9));

    let shown = notifier
        .load(
            &serde_json::to_value(&now).unwrap(),
            EPOCH,
            9,
            9,
            &Switches::default(),
        )
        .unwrap();

    let keys: Vec<&str> = shown.iter().map(|event| event.key.as_str()).collect();
    assert_eq!(keys, ["overdue:2", "question:9"]);
}

#[test]
fn the_capacity_lock_is_told_when_set_and_when_cleared() {
    let before = quiet();
    let mut notifier = started(&before);
    let locked = serde_json::json!({ "block_reasons": { "set": [["task-1", [{
        "owner_type": "task", "owner_id": 1, "reason": "Agents at capacity",
        "position": 0, "derived": "agent_capacity" }]]], "del": [] } });
    let lifted = serde_json::json!({ "block_reasons": { "set": [], "del": ["task-1"] } });
    let switches = Switches::default();

    let set = notifier.follow(&event(2, 2, &locked), &switches);
    let cleared = notifier.follow(&event(3, 3, &lifted), &switches);

    assert_eq!(shown(set), ["capacity"]);
    assert_eq!(shown(cleared), ["capacity"]);
}
