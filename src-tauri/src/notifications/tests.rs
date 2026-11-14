use super::*;

use std::sync::atomic::AtomicUsize;

#[derive(Default)]
struct Recorder {
    shown: Mutex<Vec<Notice>>,
    calls: AtomicUsize,
}

impl Deliver for Recorder {
    fn show(&self, notice: &Notice) {
        self.calls.fetch_add(1, Ordering::Relaxed);
        lock(&self.shown).push(notice.clone());
    }
}

fn app_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "arlesh-notifications-{name}-{}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn board(tasks: &str, facts: &str) -> CurrentBoard {
    let load = format!(r#"{{"tasks":{tasks},"lifecycles":[],"facts":{facts}}}"#);
    CurrentBoard {
        load: serde_json::value::RawValue::from_string(load).unwrap(),
        revision: Some(BoardRevision {
            epoch: "run".into(),
            revision: 1,
        }),
        seq: Some(1),
        now: None,
        hash: None,
    }
}

fn task_json(id: i64, title: &str) -> String {
    serde_json::json!({
        "id": id, "title": title, "parent_type": "project", "parent_id": 1,
        "status": { "kind": "agentic", "status": "on_agent" },
        "asynchronous": false, "compound": false, "archival": "live",
        "tag_ids": [], "position": id, "is_private": false
    })
    .to_string()
}

fn question_event(seq: u64, task: i64) -> BoardChange {
    let key = format!("task-{task}");
    let changes = format!(r#"{{"facts":{{"set":[["{key}",{{"open_question":99}}]],"del":[]}}}}"#);
    BoardChange::parse(&format!(
        r#"{{"epoch":"run","seq":{seq},"revision":{seq},"changes":{changes}}}"#
    ))
    .unwrap()
}

fn service(name: &str) -> (Notifications, Arc<Recorder>) {
    let recorder = Arc::new(Recorder::default());
    let service = Notifications::new(&app_dir(name), recorder.clone());
    service.load(&board(&format!("[{}]", task_json(1, "Fix it")), "{}"));
    (service, recorder)
}

#[test]
fn an_agents_question_shows_one_notification_with_the_phones_words() {
    let (service, recorder) = service("question");

    assert_eq!(service.on_change(&question_event(2, 1)), Followed::Done);

    let shown = lock(&recorder.shown);
    assert_eq!(shown.len(), 1);
    assert_eq!(shown[0].text, "An agent is waiting for your answer: Fix it");
    assert_eq!(shown[0].task.as_deref(), Some("task-1"));
}

#[test]
fn the_same_event_arriving_twice_shows_once() {
    let (service, recorder) = service("twice");

    service.on_change(&question_event(2, 1));
    service.on_change(&question_event(2, 1));

    assert_eq!(recorder.calls.load(Ordering::Relaxed), 1);
}

#[test]
fn a_switch_turned_off_is_kept_across_a_restart_and_silences_its_event() {
    let dir = app_dir("switch");
    let recorder = Arc::new(Recorder::default());
    let first = Notifications::new(&dir, recorder.clone());
    first.set_enabled(Channel::AgentQuestion, false).unwrap();

    let restarted = Notifications::new(&dir, recorder.clone());
    restarted.load(&board(&format!("[{}]", task_json(1, "Fix it")), "{}"));
    restarted.on_change(&question_event(2, 1));

    assert_eq!(recorder.calls.load(Ordering::Relaxed), 0);
    let question = restarted
        .switches()
        .into_iter()
        .find(|switch| switch.channel == Channel::AgentQuestion)
        .unwrap();
    assert!(!question.enabled);
    assert!(restarted.switches().iter().filter(|s| s.enabled).count() == 4);
}

#[test]
fn a_board_already_asking_at_startup_tells_nothing() {
    let recorder = Arc::new(Recorder::default());
    let service = Notifications::new(&app_dir("startup"), recorder.clone());

    service.load(&board(
        &format!("[{}]", task_json(1, "Fix it")),
        r#"{"task-1":{"open_question":5}}"#,
    ));

    assert_eq!(recorder.calls.load(Ordering::Relaxed), 0);
}

#[test]
fn an_event_before_any_board_asks_for_one() {
    let recorder = Arc::new(Recorder::default());
    let service = Notifications::new(&app_dir("early"), recorder);

    assert_eq!(
        service.on_change(&question_event(2, 1)),
        Followed::NeedsBoard
    );
}

#[test]
fn the_capacity_lock_has_words_without_a_task() {
    let event = PushEvent {
        key: "capacity".into(),
        value: "locked".into(),
        channel: Channel::CapacityLocked,
        task: None,
        title: None,
    };
    assert_eq!(notice_for(&event).text, "Agent capacity lock set");
}
