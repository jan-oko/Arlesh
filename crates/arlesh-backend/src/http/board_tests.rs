//! The published board over HTTP: the follower relays changes without asking for the board, the
//! head and the last event id are kept, the fence follows the answers' stamps, and a server without
//! `/board/current` is read through `/board`. Against a server on a loopback port that answers
//! what each test says.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::events::Follower;
use super::*;
use crate::mindmap::BoardPort;
use crate::revision::BoardChange;

/// One request the server heard: its request line and its headers, lower-cased by name.
#[derive(Clone)]
struct Heard {
    line: String,
    headers: HashMap<String, String>,
}

struct Reply {
    status: u16,
    headers: Vec<(&'static str, String)>,
    body: String,
}

impl Reply {
    fn ok(body: &str) -> Self {
        Self {
            status: 200,
            headers: Vec::new(),
            body: body.to_owned(),
        }
    }

    fn with(mut self, name: &'static str, value: &str) -> Self {
        self.headers.push((name, value.to_owned()));
        self
    }
}

struct Server {
    url: String,
    heard: Arc<Mutex<Vec<Heard>>>,
}

impl Server {
    fn paths(&self) -> Vec<String> {
        self.heard
            .lock()
            .unwrap()
            .iter()
            .map(|heard| heard.line.clone())
            .collect()
    }
}

/// Serves `reply` for every request, one connection each, closing it after the answer.
async fn serve(reply: impl Fn(&Heard) -> Reply + Send + Sync + 'static) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("a port");
    let url = format!("http://{}", listener.local_addr().expect("an address"));
    let heard = Arc::new(Mutex::new(Vec::new()));
    let log = Arc::clone(&heard);
    let reply = Arc::new(reply);
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let (log, reply) = (Arc::clone(&log), Arc::clone(&reply));
            tokio::spawn(async move {
                let mut head = Vec::new();
                let mut chunk = [0u8; 1024];
                while !head.windows(4).any(|window| window == b"\r\n\r\n") {
                    match socket.read(&mut chunk).await {
                        Ok(0) | Err(_) => return,
                        Ok(read) => head.extend_from_slice(&chunk[..read]),
                    }
                }
                let text = String::from_utf8_lossy(&head).into_owned();
                let mut lines = text.split("\r\n");
                let line = lines.next().unwrap_or_default().to_owned();
                let headers = lines
                    .filter_map(|line| line.split_once(": "))
                    .map(|(name, value)| (name.to_ascii_lowercase(), value.to_owned()))
                    .collect();
                let heard = Heard { line, headers };
                let answer = reply(&heard);
                log.lock().unwrap().push(heard);
                let mut response = format!(
                    "HTTP/1.1 {} X\r\ncontent-length: {}\r\nconnection: close\r\n",
                    answer.status,
                    answer.body.len()
                );
                for (name, value) in &answer.headers {
                    response.push_str(&format!("{name}: {value}\r\n"));
                }
                response.push_str("\r\n");
                response.push_str(&answer.body);
                let _ = socket.write_all(response.as_bytes()).await;
            });
        }
    });
    Server { url, heard }
}

fn backend(server: &Server) -> Arc<HttpBackend> {
    Arc::new(
        HttpBackend::new(Connection::new(&server.url, "token"), Arc::new(|_| {}))
            .expect("a backend"),
    )
}

const HEALTH: &str = r#"{"api_version":1,"version":"0","commit":"x"}"#;
const CHANGE: &str = r#"{"epoch":"run1","seq":3,"revision":2,"now":"2026-11-13T12:00:00","hash":77,"changes":{"tasks":{"set":[["task-1",{"id":1,"title":"A"}]],"del":[]}}}"#;

fn stream_reply(heard: &Heard) -> Reply {
    if heard.line.contains("/health") {
        return Reply::ok(HEALTH);
    }
    Reply::ok(&format!(
        "id: run1:3\nevent: board-changed\ndata: {CHANGE}\n\nevent: board-head\ndata: {{\"epoch\":\"run1\",\"seq\":3,\"revision\":2,\"hash\":77,\"sums\":{{\"tasks\":5}}}}\n\n"
    ))
    .with("content-type", "text/event-stream")
}

async fn until<T>(mut ready: impl FnMut() -> Option<T>) -> T {
    for _ in 0..200 {
        if let Some(found) = ready() {
            return found;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("it did not happen in time");
}

#[tokio::test]
async fn the_follower_relays_a_changes_nodes_as_raw_json_and_never_asks_for_the_board() {
    let server = serve(stream_reply).await;
    let backend = backend(&server);
    let heard: Arc<Mutex<Vec<BoardChange>>> = Arc::default();
    let sink = Arc::clone(&heard);
    let follower = Follower::new(
        backend,
        Arc::new(move |change| sink.lock().unwrap().push(change)),
        tokio::runtime::Handle::current(),
    );

    follower.resume();
    let change = until(|| heard.lock().unwrap().first().cloned()).await;
    follower.suspend();

    assert_eq!(change.seq, Some(3));
    assert_eq!(
        change.changes.as_ref().map(|raw| raw.get()),
        Some(r#"{"tasks":{"set":[["task-1",{"id":1,"title":"A"}]],"del":[]}}"#)
    );
    assert!(
        server.paths().iter().all(|line| !line.contains("/board")),
        "no board was requested: {:?}",
        server.paths()
    );
}

#[tokio::test]
async fn a_board_head_event_sets_the_head() {
    let server = serve(stream_reply).await;
    let backend = backend(&server);
    let follower = Follower::new(
        Arc::clone(&backend),
        Arc::new(|_| {}),
        tokio::runtime::Handle::current(),
    );

    follower.resume();
    let head = until(|| {
        backend
            .head()
            .filter(|head| head.sums.contains_key("tasks"))
    })
    .await;
    follower.suspend();

    assert_eq!((head.epoch.as_str(), head.seq, head.hash), ("run1", 3, 77));
    assert_eq!(backend.board_head().await, Some(head));
}

#[tokio::test]
async fn the_last_event_id_survives_a_suspend_and_a_resume() {
    let server = serve(stream_reply).await;
    let backend = backend(&server);
    let heard: Arc<Mutex<usize>> = Arc::default();
    let counted = Arc::clone(&heard);
    let follower = Follower::new(
        backend,
        Arc::new(move |_| *counted.lock().unwrap() += 1),
        tokio::runtime::Handle::current(),
    );
    let streams = |server: &Server| {
        server
            .heard
            .lock()
            .unwrap()
            .iter()
            .filter(|heard| heard.line.contains("/events/changes"))
            .cloned()
            .collect::<Vec<_>>()
    };

    follower.resume();
    until(|| (*heard.lock().unwrap() > 0).then_some(())).await;
    follower.suspend();
    follower.resume();
    let second = until(|| streams(&server).get(1).cloned()).await;
    follower.suspend();

    assert_eq!(streams(&server)[0].headers.get("last-event-id"), None);
    assert_eq!(
        second.headers.get("last-event-id").map(String::as_str),
        Some("run1:3")
    );
}

#[tokio::test]
async fn the_current_board_is_the_publication_with_what_its_headers_say() {
    let server = serve(|heard| {
        if heard.line.contains("/board/current") {
            Reply::ok(r#"{"tasks":[],"nulls":null}"#)
                .with("x-arlesh-epoch", "run1")
                .with("x-arlesh-revision", "5")
                .with("x-arlesh-seq", "9")
                .with("x-arlesh-hash", "1234")
                .with("x-arlesh-board-now", "2026-11-13T12:00:00")
        } else {
            Reply::ok(HEALTH)
        }
    })
    .await;
    let backend = backend(&server);

    let current = backend.current_board().await.expect("a board");

    assert_eq!(current.load.get(), r#"{"tasks":[],"nulls":null}"#);
    assert_eq!(current.seq, Some(9));
    assert_eq!(current.hash, Some(1234));
    assert_eq!(current.now.as_deref(), Some("2026-11-13T12:00:00"));
    assert_eq!(
        current.revision,
        Some(BoardRevision {
            epoch: "run1".to_owned(),
            revision: 5
        })
    );
}

#[tokio::test]
async fn a_server_without_the_route_is_read_through_board_with_no_sequence_or_hash() {
    let server = serve(|heard| {
        if heard.line.contains("/board/current") {
            let mut reply = Reply::ok(
                r#"{"kind":"not_found","message":"no such route","details":{"reason":"unknown_route"}}"#,
            );
            reply.status = 404;
            reply
        } else if heard.line.contains("/board") {
            Reply::ok(r#"{"tasks":[]}"#)
                .with("x-arlesh-epoch", "old")
                .with("x-arlesh-revision", "4")
        } else {
            Reply::ok(HEALTH)
        }
    })
    .await;
    let backend = backend(&server);

    let current = backend.current_board().await.expect("a board");

    assert_eq!((current.seq, current.hash, current.now), (None, None, None));
    assert_eq!(current.revision.map(|stamp| stamp.revision), Some(4));
    assert!(current.load.get().contains("\"tasks\":[]"));
    assert!(server
        .paths()
        .iter()
        .any(|line| line.contains("/board?now=")));
}

#[tokio::test]
async fn the_last_board_is_shown_while_the_server_is_away() {
    let server = serve(|_| {
        Reply::ok(r#"{"tasks":[]}"#)
            .with("x-arlesh-epoch", "run1")
            .with("x-arlesh-revision", "1")
    })
    .await;
    let backend = backend(&server);
    let first = backend.current_board().await.expect("a board");
    let away = HttpBackend::new(Connection::new("http://127.0.0.1:9", "t"), Arc::new(|_| {}))
        .expect("a backend");
    away.keep_current(&first);

    let shown = away.current_board().await.expect("the kept board");

    assert_eq!(shown.load.get(), first.load.get());
}

fn stamp(epoch: &str, revision: u64) -> BoardRevision {
    BoardRevision {
        epoch: epoch.to_owned(),
        revision,
    }
}

#[test]
fn the_fence_takes_the_newest_revision_and_a_new_epoch_replaces_it() {
    let (backend, _) = super::tests::nowhere_for_board_tests();

    assert_eq!(backend.fence(), None);
    backend.note_stamp(stamp("run1", 4));
    backend.note_stamp(stamp("run1", 2));
    assert_eq!(backend.fence(), Some(stamp("run1", 4)));
    backend.note_stamp(stamp("run1", 7));
    assert_eq!(backend.fence(), Some(stamp("run1", 7)));
    backend.note_stamp(stamp("run2", 1));
    assert_eq!(backend.fence(), Some(stamp("run2", 1)));
}

#[test]
fn an_event_moves_the_head_and_keeps_the_sums_of_the_same_run() {
    let (backend, _) = super::tests::nowhere_for_board_tests();
    backend.set_head(BoardHead {
        epoch: "run1".to_owned(),
        seq: 2,
        revision: 1,
        hash: 5,
        sums: [("tasks".to_owned(), 5)].into(),
    });
    let change = |epoch: &str, seq| BoardChange {
        epoch: epoch.to_owned(),
        seq: Some(seq),
        revision: 2,
        now: None,
        hash: Some(9),
        changes: None,
        reload: false,
    };

    backend.note_change(&change("run1", 3));
    let same_run = backend.head().expect("a head");
    backend.note_change(&change("run2", 1));
    let new_run = backend.head().expect("a head");

    assert_eq!((same_run.seq, same_run.hash), (3, 9));
    assert_eq!(same_run.sums.get("tasks"), Some(&5));
    assert!(new_run.sums.is_empty());
}
