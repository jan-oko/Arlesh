//! The port against `conformance/client-mode.json`: every Backend method has a REST route for
//! Client mode, or is named Standalone-only. The server's side — that each listed route is served —
//! is `crates/arlesh-py/tests/server/integration/test_server_parity.py`.

use std::collections::BTreeSet;

/// Every per-domain port file, read at compile time so a new method cannot be missed.
const PORT_FILES: &[&str] = &[
    include_str!("access.rs"),
    include_str!("block_reasons.rs"),
    include_str!("capacity.rs"),
    include_str!("commitments.rs"),
    include_str!("domains.rs"),
    include_str!("expectations.rs"),
    include_str!("flows.rs"),
    include_str!("gestures.rs"),
    include_str!("infos.rs"),
    include_str!("knowledge_base.rs"),
    include_str!("mindmap.rs"),
    include_str!("tasks.rs"),
    include_str!("undo.rs"),
];

const CONTRACT: &str = include_str!("../../../conformance/client-mode.json");

/// The method names a port file declares: every `async fn` in it.
fn methods(source: &str) -> impl Iterator<Item = String> + '_ {
    source.split("async fn ").skip(1).map(|rest| {
        rest.chars()
            .take_while(|character| character.is_alphanumeric() || *character == '_')
            .collect()
    })
}

fn port() -> BTreeSet<String> {
    PORT_FILES.iter().flat_map(|file| methods(file)).collect()
}

fn contract() -> (BTreeSet<String>, BTreeSet<String>) {
    let contract: serde_json::Value =
        serde_json::from_str(CONTRACT).expect("conformance/client-mode.json is JSON");
    let routed = contract["routes"]
        .as_object()
        .expect("`routes` is an object")
        .keys()
        .cloned()
        .collect();
    let standalone = contract["standalone_only"]
        .as_array()
        .expect("`standalone_only` is a list")
        .iter()
        .map(|name| name.as_str().expect("a method name").to_owned())
        .collect();
    (routed, standalone)
}

#[test]
fn the_port_files_are_read_whole() {
    // The scan above is only as good as its file list: the port's own module list is longer than
    // this one only when a file was added without being read here.
    let declared = include_str!("mod.rs").matches("\npub mod ").count();
    assert_eq!(
        declared,
        PORT_FILES.len() + 1,
        "every port module but `sqlite`"
    );
}

#[test]
fn every_port_method_has_a_route_or_is_standalone_only() {
    let (routed, standalone) = contract();
    let unlisted: Vec<_> = port()
        .into_iter()
        .filter(|method| !routed.contains(method) && !standalone.contains(method))
        .collect();
    assert!(
        unlisted.is_empty(),
        "no route in conformance/client-mode.json for {unlisted:?}"
    );
}

#[test]
fn the_contract_names_no_method_the_port_lacks() {
    let (routed, standalone) = contract();
    let port = port();
    let stale: Vec<_> = routed
        .union(&standalone)
        .filter(|method| !port.contains(*method))
        .collect();
    assert!(stale.is_empty(), "not on the Backend port: {stale:?}");
}

#[test]
fn no_method_is_both_routed_and_standalone_only() {
    let (routed, standalone) = contract();
    assert!(routed.is_disjoint(&standalone));
}
