//! The two routes over a real socket, against a migrated scratch database.

use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicU32, Ordering},
    time::Duration,
};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

use super::{routes, ChangeFeed, EventStreams};
use crate::database::{
    open::{open, OpenMode},
    session::SessionFactory,
};

static NEXT: AtomicU32 = AtomicU32::new(0);

/// A migrated database in a directory of its own, and the factory over it.
async fn scratch() -> (SessionFactory, PathBuf) {
    let directory = std::env::temp_dir().join(format!(
        "arlesh-events-test-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("arlesh.db");
    let factory = open(
        &path,
        OpenMode::Write {
            client: "events-test".parse().unwrap(),
            force: false,
        },
    )
    .await
    .unwrap();
    (factory, directory)
}

/// A plain connection to the scratch database, for writing it from outside the endpoint.
async fn side(directory: &Path) -> sqlx::SqliteConnection {
    use sqlx::Connection;
    sqlx::SqliteConnection::connect(&format!(
        "sqlite://{}",
        directory.join("arlesh.db").display()
    ))
    .await
    .unwrap()
}

/// Roots every Aspect and puts one agentic wait under the first, then returns the wait's id.
async fn raise_a_wait(directory: &Path) -> i64 {
    let mut db = side(directory).await;
    sqlx::query(
        "INSERT INTO mcp_roots (node_kind, node_id) \
         SELECT 'domain', id FROM domains WHERE parent_id IS NULL \
         ON CONFLICT (node_kind, node_id) DO NOTHING",
    )
    .execute(&mut db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO expectations (title, parent_type, parent_id, agentic, agentic_question, status) \
         SELECT 'Which colour?', 'domain', id, 1, 1, 'pending' FROM domains \
          WHERE parent_id IS NULL ORDER BY id LIMIT 1",
    )
    .execute(&mut db)
    .await
    .unwrap();
    sqlx::query_scalar("SELECT max(id) FROM expectations")
        .fetch_one(&mut db)
        .await
        .unwrap()
}

async fn release(directory: &Path, id: i64) {
    let mut db = side(directory).await;
    sqlx::query("UPDATE expectations SET status = 'released' WHERE id = ?")
        .bind(id)
        .execute(&mut db)
        .await
        .unwrap();
}

/// Serves the routes on a free port.
async fn serve(factory: SessionFactory, streams: EventStreams) -> std::net::SocketAddr {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = routes(factory, streams);
    tokio::spawn(async move { axum::serve(listener, app).await });
    address
}

async fn request(address: std::net::SocketAddr, target: &str, extra: &str) -> TcpStream {
    let mut stream = TcpStream::connect(address).await.unwrap();
    stream
        .write_all(format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n{extra}\r\n").as_bytes())
        .await
        .unwrap();
    stream
}

/// Reads until `needle` has arrived, or fails after ten seconds.
async fn read_until(stream: &mut TcpStream, needle: &str) -> String {
    let mut heard = String::new();
    let mut buffer = [0u8; 4096];
    tokio::time::timeout(Duration::from_secs(10), async {
        while !heard.contains(needle) {
            let read = stream.read(&mut buffer).await.unwrap();
            assert_ne!(read, 0, "ended before {needle:?}: {heard}");
            heard.push_str(&String::from_utf8_lossy(&buffer[..read]));
        }
    })
    .await
    .unwrap_or_else(|_| panic!("did not hear {needle:?} in: {heard}"));
    heard
}

/// One whole non-streaming answer.
async fn answer(address: std::net::SocketAddr, target: &str) -> String {
    let mut stream = request(address, target, "Connection: close\r\n").await;
    let mut heard = String::new();
    tokio::time::timeout(Duration::from_secs(10), stream.read_to_string(&mut heard))
        .await
        .unwrap()
        .unwrap();
    heard
}

fn body(answer: &str) -> serde_json::Value {
    let (_, body) = answer.split_once("\r\n\r\n").unwrap();
    serde_json::from_str(body.trim()).unwrap_or_else(|_| {
        // Chunked: the JSON sits between the size line and the terminator.
        let start = body.find('{').unwrap();
        let end = body.rfind('}').unwrap();
        serde_json::from_str(&body[start..=end]).unwrap()
    })
}

#[tokio::test]
async fn the_change_stream_says_connected_then_tells_of_each_write() {
    let (factory, directory) = scratch().await;
    let feed = ChangeFeed::new();
    let address = serve(
        factory,
        EventStreams {
            feed: feed.clone(),
            ..EventStreams::default()
        },
    )
    .await;
    let mut stream = request(address, "/events/changes", "").await;

    let first = read_until(&mut stream, ": connected").await;
    assert!(first.contains("text/event-stream"), "{first}");
    assert!(!first.contains("event: board-changed"), "{first}");
    feed.bump();
    let heard = read_until(&mut stream, "event: board-changed").await;

    assert!(heard.contains("\"revision\":1"), "{heard}");
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn a_change_stream_reconnecting_behind_is_told_at_once() {
    let (factory, directory) = scratch().await;
    let feed = ChangeFeed::new();
    feed.bump();
    let address = serve(
        factory,
        EventStreams {
            feed: feed.clone(),
            ..EventStreams::default()
        },
    )
    .await;
    let behind = format!("Last-Event-ID: {}:0\r\n", feed.epoch());
    let other_run = "Last-Event-ID: elsewhere:1\r\n".to_owned();
    let garbled = format!("Last-Event-ID: {}:soon\r\n", feed.epoch());
    let current = format!("Last-Event-ID: {}:1\r\n", feed.epoch());

    for extra in [behind, other_run, garbled] {
        let mut stream = request(address, "/events/changes", &extra).await;
        let heard = read_until(&mut stream, ": connected").await;
        assert!(heard.contains("event: board-changed"), "{extra}: {heard}");
    }
    let mut stream = request(address, "/events/changes", &current).await;
    let heard = read_until(&mut stream, ": connected").await;
    assert!(!heard.contains("event: board-changed"), "{heard}");
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn a_request_from_another_origin_is_refused() {
    let (factory, directory) = scratch().await;
    let address = serve(factory, EventStreams::default()).await;

    for target in [
        "/events/changes",
        "/events/expectations",
        "/events/expectations?wait=0",
    ] {
        let mut stream = request(address, target, "Origin: https://evil.example\r\n").await;
        let heard = read_until(&mut stream, "HTTP/1.1 ").await;
        assert!(heard.contains("403"), "{target}: {heard}");
    }
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn a_long_poll_with_no_cursor_is_told_to_read_afresh() {
    let (factory, directory) = scratch().await;
    let streams = EventStreams::default();
    let epoch = streams.feed.epoch().to_owned();
    let address = serve(factory, streams).await;

    let first = body(&answer(address, "/events/expectations?wait=0").await);
    let stale = body(
        &answer(
            address,
            &format!("/events/expectations?after=99&epoch={epoch}&wait=0"),
        )
        .await,
    );
    let other_run = body(&answer(address, "/events/expectations?after=1&epoch=other&wait=0").await);

    for reading in [&first, &stale, &other_run] {
        assert_eq!(reading["reset"], true, "{reading}");
        assert_eq!(reading["epoch"], epoch.as_str());
        assert_eq!(reading["changes"], serde_json::json!([]));
    }
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn a_long_poll_with_nothing_new_answers_empty_when_its_wait_is_up() {
    let (factory, directory) = scratch().await;
    let streams = EventStreams {
        poll: Some(Duration::from_millis(50)),
        ..EventStreams::default()
    };
    // A cursor of 0 is no cursor, so the board has moved once before the poll begins.
    streams.feed.bump();
    let epoch = streams.feed.epoch().to_owned();
    let address = serve(factory, streams).await;
    let baseline = body(&answer(address, "/events/expectations?wait=0").await);
    let after = baseline["revision"].as_u64().unwrap();

    let quiet = body(
        &answer(
            address,
            &format!("/events/expectations?after={after}&epoch={epoch}&wait=1"),
        )
        .await,
    );

    assert!(quiet.get("reset").is_none(), "{quiet}");
    assert_eq!(quiet["changes"], serde_json::json!([]));
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn a_long_poll_answers_the_moment_a_wait_is_released() {
    let (factory, directory) = scratch().await;
    let id = raise_a_wait(&directory).await;
    let feed = ChangeFeed::new();
    feed.bump();
    let epoch = feed.epoch().to_owned();
    let address = serve(
        factory.clone(),
        EventStreams {
            feed: feed.clone(),
            ..EventStreams::default()
        },
    )
    .await;
    let baseline = body(&answer(address, "/events/expectations?agentic=true&wait=0").await);
    let after = baseline["revision"].as_u64().unwrap();
    let target = format!("/events/expectations?agentic=true&after={after}&epoch={epoch}&wait=20");
    let poll = tokio::spawn(async move { answer(address, &target).await });

    tokio::time::sleep(Duration::from_millis(200)).await;
    release(&directory, id).await;
    feed.bump();
    let heard = body(&poll.await.unwrap());

    assert_eq!(heard["changes"][0]["change"], "released", "{heard}");
    assert_eq!(heard["changes"][0]["deleted"], false);
    assert!(heard["changes"][0]["revision"].as_u64().unwrap() > after);
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn the_wait_stream_tells_of_a_release_the_feed_announced() {
    let (factory, directory) = scratch().await;
    let id = raise_a_wait(&directory).await;
    let feed = ChangeFeed::new();
    let address = serve(
        factory.clone(),
        EventStreams {
            feed: feed.clone(),
            ..EventStreams::default()
        },
    )
    .await;
    let mut stream = request(address, "/events/expectations?agentic=true", "").await;
    read_until(&mut stream, ": connected").await;

    release(&directory, id).await;
    feed.bump();
    let heard = read_until(&mut stream, "\"change\":\"released\"").await;

    assert!(heard.contains("event: wait-changed"), "{heard}");
    let _ = std::fs::remove_dir_all(directory);
}
