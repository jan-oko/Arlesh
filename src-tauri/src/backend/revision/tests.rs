use super::*;

fn headers(revision: &str, epoch: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(REVISION_HEADER, revision.parse().expect("a header value"));
    headers.insert(EPOCH_HEADER, epoch.parse().expect("a header value"));
    headers
}

#[test]
fn the_stamp_is_read_from_the_two_headers() {
    assert_eq!(
        BoardRevision::from_headers(&headers("7", "run1")),
        Some(BoardRevision {
            epoch: "run1".to_owned(),
            revision: 7
        })
    );
}

#[test]
fn an_answer_missing_either_header_has_no_stamp() {
    let mut only_revision = HeaderMap::new();
    only_revision.insert(REVISION_HEADER, "7".parse().expect("a header value"));

    assert_eq!(BoardRevision::from_headers(&HeaderMap::new()), None);
    assert_eq!(BoardRevision::from_headers(&only_revision), None);
    assert_eq!(BoardRevision::from_headers(&headers("seven", "run1")), None);
}

#[test]
fn a_load_is_the_board_with_the_revision_beside_it_on_the_wire() {
    let stamped = BoardLoad::at(
        MindmapLoad::default(),
        Some(BoardRevision {
            epoch: "run1".to_owned(),
            revision: 3,
        }),
    );

    let wire = serde_json::to_value(&stamped).expect("serializes");

    assert_eq!(
        wire["revision"],
        serde_json::json!({ "epoch": "run1", "revision": 3 })
    );
    assert!(wire["tasks"].is_array(), "the rows are at the top level");
}

#[test]
fn an_unversioned_load_has_no_revision_field() {
    let wire =
        serde_json::to_value(BoardLoad::unversioned(MindmapLoad::default())).expect("serializes");

    assert!(wire.get("revision").is_none());
}
