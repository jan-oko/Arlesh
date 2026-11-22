use super::*;
use crate::http::events::EventParser;

#[test]
fn a_character_split_across_two_reads_arrives_whole() {
    let event = "event: board-changed\ndata: {\"title\":\"Café ☕ 日本\"}\n\n".as_bytes();
    // Split inside the two-byte `é`, then inside the three-byte `☕`.
    let first_cut = event.iter().position(|byte| *byte == 0xC3).expect("an é") + 1;
    let second_cut = event.iter().position(|byte| *byte == 0xE2).expect("a ☕") + 1;
    let mut parser = EventParser::default();
    let mut pending = Vec::new();
    let mut heard = Vec::new();

    for part in [
        &event[..first_cut],
        &event[first_cut..second_cut],
        &event[second_cut..],
    ] {
        pending.extend_from_slice(part);
        heard.extend(parser.feed(&drain_utf8(&mut pending)));
    }

    assert_eq!(heard.len(), 1);
    assert_eq!(
        heard[0].data.as_deref(),
        Some("{\"title\":\"Café ☕ 日本\"}"),
        "no replacement character was written into the row"
    );
    assert!(pending.is_empty());
}

#[test]
fn bytes_that_are_not_text_are_replaced_and_not_waited_for() {
    let mut pending = vec![b'a', 0xFF, b'b'];

    assert_eq!(drain_utf8(&mut pending), "a\u{FFFD}b");
    assert!(pending.is_empty());
}
