use super::*;

#[test]
fn an_event_ends_at_a_blank_line() {
    let mut parser = EventParser::default();

    let events = parser.feed("id: e1:3\nevent: board-changed\ndata: {}\n\n");

    assert_eq!(
        events,
        vec![Event {
            id: Some("e1:3".to_owned()),
            name: Some("board-changed".to_owned()),
            data: Some("{}".to_owned()),
        }]
    );
}

#[test]
fn a_board_changed_event_carries_its_changes_as_the_server_wrote_them() {
    let mut parser = EventParser::default();

    let events = parser.feed(
        "id: run1:3\nevent: board-changed\ndata: {\"epoch\":\"run1\",\"seq\":3,\"revision\":2,\"now\":\"2026-11-13T12:00:00\",\"hash\":77,\"changes\":{\"tasks\":{\"set\":[[\"task-1\",{\"id\":1}]],\"del\":[]}}}\n\n",
    );

    let change = events[0].board_change().expect("a change");
    assert_eq!(change.epoch, "run1");
    assert_eq!(
        (change.seq, change.revision, change.hash),
        (Some(3), 2, Some(77))
    );
    assert_eq!(
        change.changes.as_ref().map(|raw| raw.get()),
        Some("{\"tasks\":{\"set\":[[\"task-1\",{\"id\":1}]],\"del\":[]}}")
    );
    assert!(!change.reload);
}

#[test]
fn an_older_servers_event_has_a_revision_and_no_sequence() {
    let mut parser = EventParser::default();

    let events = parser
        .feed("id: run1:3\nevent: board-changed\ndata: {\"revision\": 3, \"epoch\": \"run1\"}\n\n");

    let change = events[0].board_change().expect("a change");
    assert_eq!(change.seq, None);
    assert_eq!(change.stamp().revision, 3);
}

#[test]
fn a_reload_event_says_so() {
    let mut parser = EventParser::default();

    let events = parser.feed(
        "event: board-changed\ndata: {\"epoch\":\"e\",\"seq\":9,\"revision\":4,\"reload\":true}\n\n",
    );

    assert!(events[0].board_change().is_some_and(|change| change.reload));
}

#[test]
fn a_board_head_event_is_the_latest_publications_identity() {
    let mut parser = EventParser::default();

    let events = parser.feed(
        "event: board-head\ndata: {\"epoch\":\"e\",\"seq\":9,\"revision\":4,\"hash\":5,\"sums\":{\"tasks\":5}}\n\n",
    );

    let head = events[0].board_head().expect("a head");
    assert_eq!((head.seq, head.hash), (9, 5));
    assert_eq!(head.sums.get("tasks"), Some(&5));
}

#[test]
fn data_split_over_lines_and_chunks_is_joined() {
    let mut parser = EventParser::default();

    assert!(parser
        .feed("event: board-changed\ndata: {\"revision\":")
        .is_empty());
    let events = parser.feed(" 4,\ndata: \"epoch\": \"run1\"}\n\n");

    assert_eq!(
        events[0].data.as_deref(),
        Some("{\"revision\": 4,\n\"epoch\": \"run1\"}")
    );
    assert_eq!(
        events[0].board_change().map(|change| change.revision),
        Some(4)
    );
}

#[test]
fn an_event_whose_data_is_not_a_change_has_none() {
    let mut parser = EventParser::default();

    let bare = parser.feed("event: board-changed\n\n");
    let odd = parser.feed("event: board-changed\ndata: soon\n\n");

    assert!(bare[0].board_change().is_none());
    assert!(odd[0].board_change().is_none());
}

#[test]
fn an_event_split_across_chunks_is_put_back_together() {
    let mut parser = EventParser::default();

    let first = parser.feed("id: e1:4\nev");
    let second = parser.feed("ent: board-changed\r\n\r\n");

    assert!(first.is_empty());
    assert_eq!(second[0].name.as_deref(), Some("board-changed"));
    assert_eq!(second[0].id.as_deref(), Some("e1:4"));
}

#[test]
fn comments_are_not_events() {
    let mut parser = EventParser::default();

    assert!(parser.feed(": connected\n\n: keepalive\n\n").is_empty());
}

fn follower() -> Follower {
    let backend = HttpBackend::new(
        super::super::Connection::new("http://127.0.0.1:9", "token"),
        Arc::new(|_| {}),
    )
    .expect("a backend");
    Follower::new(
        Arc::new(backend),
        Arc::new(|_: BoardChange| {}),
        tokio::runtime::Handle::current(),
    )
}

#[tokio::test]
async fn a_follower_follows_once_resumed_and_not_after_suspending() {
    let follower = follower();
    assert!(!follower.is_following());

    follower.resume();
    follower.resume();
    assert!(follower.is_following());

    follower.suspend();
    assert!(!follower.is_following());

    follower.resume();
    assert!(follower.is_following());
    follower.suspend();
}

#[test]
fn the_follower_follows_the_route_the_conformance_map_names() {
    let contract: serde_json::Value =
        serde_json::from_str(include_str!("../../../../../conformance/client-mode.json"))
            .expect("the conformance map is JSON");
    let streams = contract["streams"]["changes"].as_str();

    assert_eq!(streams, Some(format!("GET {CHANGES_PATH}").as_str()));
}
