//! The event streams served beside `/mcp`: `GET /events/changes` and `GET /events/expectations`.
//!
//! Both are on the MCP endpoint's own origin, behind the same loopback and `Origin` rules, so
//! whatever reaches `/mcp` reaches them.
//!
//! * **`/events/changes`** is Server-Sent Events. It says `board-changed`, with the revision the
//!   board reached, after every committed write the host hears of. Writes that land close
//!   together arrive as one event.
//! * **`/events/expectations?after=<revision>&epoch=<epoch>&wait=<seconds>[&agentic=true]`** is a
//!   long poll over the changes to the waits the MCP can see: one JSON answer, for a client that
//!   cannot hold a stream open (a hook with a plain request). A change is a wait released,
//!   reopened, archived, unarchived, deleted or created (`?agentic=true` keeps only agentic
//!   waits); it is typed and carries ids, so a client filters by id and never re-reads. An edit
//!   to a pending wait's title or note is no change. It answers `{ revision, epoch, changes }` as
//!   soon as a change past `after` exists, or with no changes once `wait` seconds (25 by default,
//!   30 at most) have passed; the client polls again with the `revision` it got. With no `after`,
//!   another run's `epoch`, or an `after` the server's short log no longer reaches, it answers
//!   `{ revision, epoch, changes: [], reset: true }` at once: read the waits
//!   (`arlesh_waits.get_many`), then poll from that revision. `wait=0` answers without waiting.
//!
//! A host that cannot hear every write (the desktop app, where a window's own writes announce
//! nothing here) sets [`EventStreams::poll`], and the long poll reads again on that interval as
//! well as on each announced change.

mod feed;
mod log;
#[cfg(test)]
mod routes_tests;
pub mod rules;
#[cfg(test)]
mod tests;

use std::{
    collections::{BTreeMap, VecDeque},
    convert::Infallible,
    time::Duration,
};

use axum::{
    body::{Body, Bytes},
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::Response,
    routing::get,
};
use futures_util::stream;
use serde::{Deserialize, Serialize};
use tokio::time::{timeout, Instant};

pub use feed::ChangeFeed;
pub use log::{Reading, WaitLog, WaitLogs};
use rules::{admitted, WaitState};

use super::{ids::full_id, lookup::Board};
use crate::{access::model::NodeTable, database::session::SessionFactory, error::AppError};

/// The event a `/events/changes` stream sends: the same as the app's window event.
pub const BOARD_CHANGED: &str = "board-changed";
/// How long a stream stays silent before it sends a comment, so a proxy keeps it open.
const KEEPALIVE: Duration = Duration::from_secs(15);

/// What the streams follow, and how a host that cannot hear every write keeps up.
#[derive(Clone, Default)]
pub struct EventStreams {
    /// The count of committed writes. The router bumps it for every write an agent makes through
    /// `/mcp`; a host bumps it for the rest.
    pub feed: ChangeFeed,
    /// Reads the waits again this often even when no write was announced, for a host that hears
    /// of only some writes. `None` for a host that hears of all of them.
    pub poll: Option<Duration>,
    /// What the long-poll form of the wait stream answers from. Leave it at its default.
    pub logs: WaitLogs,
}

#[derive(Clone)]
struct Served {
    factory: SessionFactory,
    streams: EventStreams,
}

/// The routes of both streams over `factory`.
pub fn routes(factory: SessionFactory, streams: EventStreams) -> axum::Router {
    axum::Router::new()
        .route("/events/changes", get(changes_stream))
        .route("/events/expectations", get(expectations))
        .with_state(Served { factory, streams })
}

/// Every wait `board` shows, keyed by full id; only the agentic ones when `agentic`.
pub(super) fn wait_states(board: &Board, agentic: bool) -> BTreeMap<String, WaitState> {
    board
        .load
        .expectations
        .iter()
        .filter(|wait| wait.agentic || !agentic)
        .map(|wait| {
            let state = wait_state(board, wait);
            (state.wait_id.clone(), state)
        })
        .collect()
}

/// One wait as the streams and the `watch` tools tell it.
pub(super) fn wait_state(board: &Board, wait: &crate::tasks::model::Expectation) -> WaitState {
    let short = |table: NodeTable, id: &crate::nodes::id::NodeId| {
        board.names.short_id(table, id).map_or_else(
            || board.names.short_id_among(&full_id(table, id)),
            str::to_owned,
        )
    };
    let parent_table = NodeTable::from_reference(&wait.parent_type).unwrap_or(NodeTable::Task);
    WaitState {
        wait_id: full_id(NodeTable::Expectation, &wait.id),
        short_id: short(NodeTable::Expectation, &wait.id),
        task_id: full_id(parent_table, &wait.parent_id),
        task_short_id: short(parent_table, &wait.parent_id),
        status: wait.status,
        archived: wait.archival == crate::tasks::model::ExpectationArchival::Archived,
        question: wait.question,
    }
}

/// The wait as an event's data: its state, whether it is gone, and the revision it was seen at.
#[derive(Serialize)]
struct WaitEventData<'a> {
    change: rules::Change,
    #[serde(flatten)]
    wait: &'a WaitState,
    deleted: bool,
    revision: u64,
    epoch: &'a str,
}

fn frame(id: &str, name: &str, data: &impl Serialize) -> Bytes {
    let data = serde_json::to_string(data).unwrap_or_else(|_| "{}".to_owned());
    Bytes::from(format!("id: {id}\nevent: {name}\ndata: {data}\n\n"))
}

fn comment(text: &str) -> Bytes {
    Bytes::from(format!(": {text}\n\n"))
}

pub(super) fn guard(headers: &HeaderMap) -> Result<(), StatusCode> {
    let text = |name| headers.get(name).and_then(|value| value.to_str().ok());
    if admitted(text(header::HOST), text(header::ORIGIN)) {
        Ok(())
    } else {
        Err(StatusCode::FORBIDDEN)
    }
}

fn event_stream(body: Body) -> Response {
    let mut response = Response::new(body);
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("text/event-stream"),
    );
    headers.insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-cache"),
    );
    headers.insert("x-accel-buffering", header::HeaderValue::from_static("no"));
    response
}

type Chunk = Result<Bytes, Infallible>;

// ---- /events/changes ----

struct Following {
    feed: ChangeFeed,
    seen: u64,
    pending: VecDeque<Bytes>,
}

async fn changes_stream(
    State(served): State<Served>,
    headers: HeaderMap,
) -> Result<Response, StatusCode> {
    guard(&headers)?;
    let feed = served.streams.feed;
    let current = feed.revision();
    let mut pending = VecDeque::new();
    // A client that reconnects with `Last-Event-ID` hears at once about anything it missed.
    let behind = headers
        .get("last-event-id")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|id| match id.split_once(':') {
            Some((epoch, seen)) if epoch == feed.epoch() => {
                seen.parse::<u64>().map_or(true, |seen| seen < current)
            }
            _ => true,
        });
    if behind {
        pending.push_back(board_changed(&feed, current));
    }
    pending.push_back(comment("connected"));
    let state = Following {
        seen: current,
        feed,
        pending,
    };
    let chunks = stream::unfold(state, |mut state| async move {
        loop {
            if let Some(chunk) = state.pending.pop_front() {
                return Some((Chunk::Ok(chunk), state));
            }
            match timeout(KEEPALIVE, state.feed.after(state.seen)).await {
                Ok(reached) => {
                    state.seen = reached;
                    state.pending.push_back(board_changed(&state.feed, reached));
                }
                Err(_) => state.pending.push_back(comment("keepalive")),
            }
        }
    });
    Ok(event_stream(Body::from_stream(chunks)))
}

fn board_changed(feed: &ChangeFeed, revision: u64) -> Bytes {
    let data = serde_json::json!({ "revision": revision, "epoch": feed.epoch() });
    frame(
        &format!("{}:{revision}", feed.epoch()),
        BOARD_CHANGED,
        &data,
    )
}

// ---- /events/expectations ----

/// How long a long poll waits when it names no `wait`, and the longest it may be asked to.
const DEFAULT_WAIT: u64 = 25;
const MAX_WAIT: u64 = 30;

/// The query of `GET /events/expectations`.
#[derive(Debug, Default, Deserialize)]
pub struct ExpectationsQuery {
    /// Only the waits an agent raised.
    #[serde(default)]
    pub agentic: bool,
    /// The revision the client has heard up to.
    pub after: Option<u64>,
    /// The run of the server `after` counts in.
    pub epoch: Option<String>,
    /// How many seconds a long poll may wait for a change.
    pub wait: Option<u64>,
}

/// `GET /events/expectations`: always the long poll. With no `after` it answers at once, telling
/// the client to read the waits and poll from the revision it got.
async fn expectations(
    State(served): State<Served>,
    Query(query): Query<ExpectationsQuery>,
    headers: HeaderMap,
) -> Result<Response, StatusCode> {
    expectations_poll(served, query, headers).await
}

#[derive(Serialize)]
struct PollAnswer<'a> {
    revision: u64,
    epoch: &'a str,
    changes: Vec<WaitEventData<'a>>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    reset: bool,
}

fn json_answer(body: String) -> Response {
    let mut response = Response::new(Body::from(body));
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("application/json"),
    );
    headers.insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    response
}

/// The long poll over HTTP: [`poll_answer`] behind the loopback and `Origin` rules.
async fn expectations_poll(
    served: Served,
    query: ExpectationsQuery,
    headers: HeaderMap,
) -> Result<Response, StatusCode> {
    guard(&headers)?;
    poll_answer(&served.factory, &served.streams, &query)
        .await
        .map(json_answer)
        .map_err(|error| {
            tracing::warn!(error = %error, "could not read the waits for a long poll");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

/// The long poll: answers as soon as a change past `after` exists, or empty once `wait` seconds
/// have passed, as the JSON `{ revision, epoch, changes }` body. A client with no usable cursor
/// (none, another run's, or one the log no longer reaches) is told to read the waits afresh
/// (`reset`), and polls again from the revision it got.
///
/// Public so a host that serves the endpoint itself (the Python server) answers it with this.
pub async fn poll_answer(
    factory: &SessionFactory,
    streams: &EventStreams,
    query: &ExpectationsQuery,
) -> Result<String, AppError> {
    let feed = &streams.feed;
    let epoch = feed.epoch();
    let log = streams.logs.of(query.agentic);
    let deadline =
        Instant::now() + Duration::from_secs(query.wait.unwrap_or(DEFAULT_WAIT).min(MAX_WAIT));
    let cursor = query
        .after
        .filter(|after| *after > 0 && query.epoch.as_deref() == Some(epoch));
    let mut seen = feed.revision();
    loop {
        let reading = log
            .poll(factory, query.agentic, feed, cursor.unwrap_or_default())
            .await?;
        let remaining = deadline.saturating_duration_since(Instant::now());
        let (revision, stamped, reset) = match reading {
            Reading::Stale(revision) => (revision, Vec::new(), true),
            Reading::Events(revision, _) if cursor.is_none() => (revision, Vec::new(), true),
            Reading::Events(revision, stamped) => (revision, stamped, false),
        };
        if reset || !stamped.is_empty() || remaining.is_zero() {
            let changes = stamped
                .iter()
                .map(|(stamp, event)| WaitEventData {
                    change: event.change,
                    wait: &event.wait,
                    deleted: event.deleted(),
                    revision: *stamp,
                    epoch,
                })
                .collect();
            let answer = PollAnswer {
                revision,
                epoch,
                changes,
                reset,
            };
            return Ok(serde_json::to_string(&answer).unwrap_or_else(|_| "{}".to_owned()));
        }
        // Wake on the next write, or on the poll interval of a host that hears of only some.
        let tick = streams.poll.map_or(remaining, |poll| remaining.min(poll));
        if let Ok(reached) = timeout(tick, feed.after(seen)).await {
            seen = reached;
        }
    }
}

pub(super) async fn read_waits(
    factory: &SessionFactory,
    agentic: bool,
) -> Result<BTreeMap<String, WaitState>, AppError> {
    let mut db = factory.begin().await?;
    let now = chrono::Local::now().naive_local();
    let board = Board::read(&mut db, now, false).await?;
    Ok(wait_states(&board, agentic))
}
