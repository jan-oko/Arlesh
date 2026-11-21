//! [`HttpSource`] against a server on a loopback port: what the Replica asks of the wire.

use std::{sync::Arc, time::Duration};

use arlesh_core::replication::{self, replica};

use super::{
    rig::{remote_of, ServerRig},
    source::{Incoming, SyncSource},
    sync::Timings,
    HttpSource, ReplicaBackend, ReplicaConfig,
};
use crate::http::board_tests::{backend, serve, until, Heard, Reply, HEALTH};

const CHANGE: &str = r#"{"epoch":"run1","seq":3,"revision":2,"now":"2026-11-13T12:00:00","hash":77,"changes":{"tasks":{"set":[],"del":[]}}}"#;

fn stream(heard: &Heard, snapshot: &str) -> Reply {
    if heard.line.contains("/health") {
        return Reply::ok(HEALTH);
    }
    if heard.line.contains("/board/snapshot") {
        return Reply::ok(snapshot);
    }
    Reply::ok(&format!(
        "id: run1:3\nevent: board-changed\ndata: {CHANGE}\n\nevent: board-head\ndata: {{\"epoch\":\"run1\",\"seq\":3,\"revision\":2,\"hash\":77,\"sums\":{{}}}}\n\n"
    ))
    .with("content-type", "text/event-stream")
}

#[tokio::test]
async fn the_replica_stream_asks_for_rows_and_never_sends_last_event_id() {
    let server = serve(|heard| stream(heard, "{}")).await;
    let source = HttpSource::new(backend(&server));

    for _ in 0..2 {
        let mut events = source.open().await.expect("a stream");
        let first = events.recv().await.expect("an event");
        assert!(matches!(first, Incoming::Changed(_)));
        // The id of that event is on the stream, and a reconnect still does not send it back.
        while events.recv().await.is_some() {}
    }

    let streams: Vec<_> = server
        .heard
        .lock()
        .expect("lock")
        .iter()
        .filter(|heard| heard.line.contains("/events/changes"))
        .cloned()
        .collect();
    assert_eq!(streams.len(), 2);
    for heard in streams {
        assert!(heard.line.contains("rows=true"), "{}", heard.line);
        assert!(!heard.headers.contains_key("last-event-id"));
    }
}

#[tokio::test]
async fn a_snapshot_is_fetched_on_every_connect() {
    let rig = ServerRig::start().await;
    let snapshot = replication::device_snapshot(rig.backend.factory(), "run1", 0)
        .await
        .expect("a snapshot");
    let server = serve(move |heard| stream(heard, &snapshot)).await;
    let http = backend(&server);
    let replica = ReplicaBackend::start(ReplicaConfig {
        source: Arc::new(HttpSource::new(Arc::clone(&http))),
        remote: remote_of(&http),
        sink: Arc::new(|_| {}),
        runtime: tokio::runtime::Handle::current(),
        on_dropped: Arc::new(|_| {}),
        timings: Timings {
            tick: Duration::from_millis(50),
            max_backoff: Duration::from_millis(100),
            ..Timings::default()
        },
        cache: None,
    })
    .await
    .expect("a replica");

    // Each answer of the stream ends it, so the Replica connects again, and again takes a snapshot.
    until(|| {
        let snapshots = server
            .paths()
            .iter()
            .filter(|line| line.contains("/board/snapshot"))
            .count();
        (snapshots >= 3).then_some(snapshots)
    })
    .await;

    let paths = server.paths();
    let opens = paths
        .iter()
        .filter(|line| line.contains("/events/changes"))
        .count();
    let snapshots = paths
        .iter()
        .filter(|line| line.contains("/board/snapshot"))
        .count();
    assert!(
        snapshots >= opens,
        "every connect takes a snapshot: {opens} streams, {snapshots} snapshots"
    );
    assert!(replica.ready().is_some(), "the first board came in");
    let _ = replica::schema_version;
}
