use super::*;

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
fn a_derived_id_is_stable_and_distinct_per_key() {
    let first = DerivedId::of_key("flow_task:12:2026-09-20:3");
    assert_eq!(first, DerivedId::of_key("flow_task:12:2026-09-20:3"));
    assert_ne!(first, DerivedId::of_key("flow_task:12:2026-09-21:3"));
    assert_eq!(first.as_str().len(), 36);
    assert_eq!(first.to_string(), first.as_str());
}

#[test]
fn a_node_id_travels_as_a_number_or_a_string() {
    let stored = NodeId::Stored(42);
    assert_eq!(serde_json::to_string(&stored).unwrap(), "42");
    let derived = NodeId::Derived(DerivedId::of_key("flow_root:3:2026-09-20:0"));
    let json = serde_json::to_string(&derived).unwrap();
    assert!(json.starts_with('"'));
    assert_eq!(serde_json::from_str::<NodeId>(&json).unwrap(), derived);
    assert_eq!(
        serde_json::from_str::<NodeId>("7").unwrap(),
        NodeId::Stored(7)
    );
}

#[test]
fn a_node_id_says_which_row_it_names() {
    let stored = NodeId::from(5);
    assert_eq!(stored.stored(), Some(5));
    assert!(stored.derived().is_none());
    assert!(!stored.is_derived());
    assert_eq!(stored, 5);
    assert_eq!(stored.to_string(), "5");

    let derived = NodeId::from(DerivedId::of_key("x"));
    assert_eq!(derived.stored(), None);
    assert!(derived.derived().is_some());
    assert!(derived.is_derived());
    assert_ne!(derived, 5);
    assert_eq!(derived.to_string().len(), 36);
}

#[test]
fn only_a_stored_id_is_required_stored() {
    assert_eq!(NodeId::Stored(3).require_stored(), Ok(3));
    let derived = DerivedId::of_key("flow_root:1:2026-01-01:0");
    let refusal = NodeId::Derived(derived.clone())
        .require_stored()
        .unwrap_err();
    assert_eq!(refusal, NotStored(derived));
    assert!(refusal.to_string().contains("derived"));
}
