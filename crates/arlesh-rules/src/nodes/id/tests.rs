use super::*;
use crate::nodes::id::tid;

/// RFC 9562's DNS namespace, for the published test vector.
const DNS_NAMESPACE: [u8; 16] = [
    0x6b, 0xa7, 0xb8, 0x10, 0x9d, 0xad, 0x11, 0xd1, 0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30, 0xc8,
];

#[test]
fn uuid_v5_matches_the_published_vector() {
    assert_eq!(
        uuid_v5(&DNS_NAMESPACE, "www.example.com"),
        "2ed6657d-e927-568b-95e1-2665a8aea6a2"
    );
}

#[test]
fn sha1_of_the_empty_message_is_the_known_digest() {
    let hex: String = sha1(b"").iter().map(|byte| format!("{byte:02x}")).collect();
    assert_eq!(hex, "da39a3ee5e6b4b0d3255bfef95601890afd80709");
}

#[test]
fn sha1_spans_several_blocks() {
    let message = "a".repeat(1000);
    let hex: String = sha1(message.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    assert_eq!(hex, "291e9a6c66994949b57ba5e650361e98fc36b1ba");
}

#[test]
fn a_stored_rows_old_full_id_is_the_v5_of_its_kind_and_number() {
    // The id every row from before UUID identity kept: pinned so that a change to the namespace or
    // the spelling is caught, since existing short ids and links hang on it.
    assert_eq!(
        uuid_v5(&NODE_NAMESPACE, "flow:20"),
        "5bbc317a-2326-53b7-9b97-01a7e0394202"
    );
    assert_eq!(
        uuid_v5(&NODE_NAMESPACE, "task:5"),
        "5326fbfc-08dd-567b-a15c-d9238ecc8049"
    );
    let id = parse_row_id(&uuid_v5(&NODE_NAMESPACE, "task:5")).unwrap();
    assert!(!is_derived_spelling(&id));
}

#[test]
fn a_derived_id_is_stable_distinct_per_key_and_version_eight() {
    let first = DerivedId::of_key("flow_task:12:2026-09-20:3");
    assert_eq!(first, DerivedId::of_key("flow_task:12:2026-09-20:3"));
    assert_ne!(first, DerivedId::of_key("flow_task:12:2026-09-21:3"));
    assert_eq!(first.as_str().len(), 36);
    assert_eq!(first.to_string(), first.as_str());
    let spelled = parse_row_id(first.as_str()).unwrap();
    assert!(is_derived_spelling(&spelled));
    assert_eq!(first.as_str().as_bytes().get(14), Some(&b'8'));
}

#[test]
fn a_node_id_travels_as_a_uuid_string_and_the_version_says_which_it_is() {
    let stored = NodeId::Stored(tid(42));
    let json = serde_json::to_string(&stored).unwrap();
    assert_eq!(json, format!("\"{}\"", tid(42)));
    assert_eq!(serde_json::from_str::<NodeId>(&json).unwrap(), stored);

    let derived = NodeId::Derived(DerivedId::of_key("flow_root:3:2026-09-20:0"));
    let json = serde_json::to_string(&derived).unwrap();
    assert_eq!(serde_json::from_str::<NodeId>(&json).unwrap(), derived);
}

#[test]
fn a_node_id_refuses_a_number_and_a_non_uuid() {
    assert!(serde_json::from_str::<NodeId>("7").is_err());
    assert!(serde_json::from_str::<NodeId>("\"7\"").is_err());
    assert!(serde_json::from_str::<NodeId>("\"not a uuid\"").is_err());
}

#[test]
fn a_node_id_says_which_row_it_names() {
    let stored = NodeId::from(tid(5));
    assert_eq!(stored.stored(), Some(tid(5)));
    assert!(stored.derived().is_none());
    assert!(!stored.is_derived());
    assert_eq!(stored, tid(5));
    assert_eq!(stored.to_string(), tid(5).to_string());

    let derived = NodeId::from(DerivedId::of_key("x"));
    assert_eq!(derived.stored(), None);
    assert!(derived.derived().is_some());
    assert!(derived.is_derived());
    assert_ne!(derived, tid(5));
    assert_eq!(derived.to_string().len(), 36);
}

#[test]
fn only_a_stored_id_is_required_stored() {
    assert_eq!(NodeId::Stored(tid(3)).require_stored(), Ok(tid(3)));
    let derived = DerivedId::of_key("flow_root:1:2026-01-01:0");
    let refusal = NodeId::Derived(derived.clone())
        .require_stored()
        .unwrap_err();
    assert_eq!(refusal, NotStored(derived));
    assert!(refusal.to_string().contains("derived"));
}

#[derive(Deserialize)]
struct Chosen {
    #[serde(default, deserialize_with = "deserialize_chosen_id")]
    id: Option<RowId>,
}

#[test]
fn a_chosen_id_is_optional_and_must_be_an_ordinary_uuid() {
    let absent: Chosen = serde_json::from_str("{}").unwrap();
    assert_eq!(absent.id, None);
    let null: Chosen = serde_json::from_str(r#"{"id": null}"#).unwrap();
    assert_eq!(null.id, None);

    let sent = format!(r#"{{"id": "{}"}}"#, tid(9));
    let chosen: Chosen = serde_json::from_str(&sent).unwrap();
    assert_eq!(chosen.id, Some(tid(9)));

    let nil = format!(r#"{{"id": "{}"}}"#, nil_row_id());
    assert!(serde_json::from_str::<Chosen>(&nil).is_err());
    let derived = format!(r#"{{"id": "{}"}}"#, DerivedId::of_key("k"));
    assert!(serde_json::from_str::<Chosen>(&derived).is_err());
    assert!(serde_json::from_str::<Chosen>(r#"{"id": 12}"#).is_err());
    assert!(serde_json::from_str::<Chosen>(r#"{"id": "12"}"#).is_err());
}

#[test]
fn the_nil_cycle_is_the_nil_uuid() {
    assert_eq!(
        nil_row_id().to_string(),
        "00000000-0000-0000-0000-000000000000"
    );
}
