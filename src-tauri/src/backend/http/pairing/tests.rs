use super::*;

#[test]
fn a_pending_poll_carries_no_token() {
    let polled: PairPolled = serde_json::from_str(r#"{"status":"pending"}"#).expect("parses");

    assert_eq!(polled.status, PairStatus::Pending);
    assert_eq!(polled.token, None);
}

#[test]
fn an_approved_poll_carries_the_name_and_token() {
    let polled: PairPolled =
        serde_json::from_str(r#"{"status":"approved","name":"pixel","token":"secret"}"#)
            .expect("parses");

    assert_eq!(polled.status, PairStatus::Approved);
    assert_eq!(polled.name.as_deref(), Some("pixel"));
    assert_eq!(polled.token.as_deref(), Some("secret"));
}

#[test]
fn a_started_pairing_reads_as_the_server_writes_it() {
    let started: PairStarted = serde_json::from_str(
        r#"{"id":"abc","pin":"004217","name":"Pixel-8","expires_at":"2026-11-01T10:10:00"}"#,
    )
    .expect("parses");

    assert_eq!(started.pin, "004217");
    assert_eq!(started.name, "Pixel-8");
}

#[test]
fn a_device_never_seen_has_no_last_seen() {
    let device: Device = serde_json::from_str(
        r#"{"name":"phone","created_at":"2026-11-01T09:00:00","current":false}"#,
    )
    .expect("parses");

    assert_eq!(device.last_seen_at, None);
    assert!(!device.current);
}

#[tokio::test]
async fn a_server_that_cannot_be_reached_is_reported_as_such() {
    let error = pair_start("http://127.0.0.1:9/", Some("phone"))
        .await
        .expect_err("nothing listens there");

    assert_eq!(
        error.details().and_then(|details| details.get("reason")),
        Some(&json!("server_unreachable"))
    );
}

#[test]
fn every_call_here_is_listed_in_the_contract() {
    let contract: serde_json::Value =
        serde_json::from_str(include_str!("../../../../../conformance/client-mode.json"))
            .expect("the contract is JSON");
    let listed = contract["pairing"]
        .as_object()
        .expect("`pairing` is an object");

    for name in [
        "pair_start",
        "pair_poll",
        "list_devices",
        "waiting_device",
        "approve_device",
        "revoke_device",
    ] {
        assert!(listed.contains_key(name), "{name} is not in the contract");
    }
}
