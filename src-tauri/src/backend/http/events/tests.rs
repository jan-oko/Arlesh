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
fn an_event_carries_the_revision_its_data_names() {
    let mut parser = EventParser::default();

    let events = parser
        .feed("id: run1:3\nevent: board-changed\ndata: {\"revision\": 3, \"epoch\": \"run1\"}\n\n");

    assert_eq!(
        events[0].revision(),
        Some(BoardRevision {
            epoch: "run1".to_owned(),
            revision: 3
        })
    );
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
    assert_eq!(events[0].revision().map(|r| r.revision), Some(4));
}

#[test]
fn an_event_whose_data_is_not_a_revision_has_none() {
    let mut parser = EventParser::default();

    let bare = parser.feed("event: board-changed\n\n");
    let odd = parser.feed("event: board-changed\ndata: soon\n\n");

    assert_eq!(bare[0].revision(), None);
    assert_eq!(odd[0].revision(), None);
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
    Follower::new(Arc::new(backend), Arc::new(|_| {}))
}

#[test]
fn a_follower_follows_once_resumed_and_not_after_suspending() {
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
