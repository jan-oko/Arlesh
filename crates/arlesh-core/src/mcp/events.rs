//! The event streams served beside `/mcp`: `GET /events/changes` and `GET /events/expectations`.
//!
//! Both are Server-Sent Events, on the MCP endpoint's own origin, behind the same loopback and
//! `Origin` rules, so whatever reaches `/mcp` reaches them.
//!
//! * **`/events/changes`** says `board-changed`, with the revision the board reached, after every
//!   committed write the host hears of. Writes that land close together arrive as one event.
//! * **`/events/expectations`** says `wait-changed` for each change to a wait the MCP can see: it
//!   was released, reopened, archived, unarchived, deleted or created (`?agentic=true` keeps only
//!   agentic waits). The event is typed and carries ids, so a client filters by id and never
//!   re-reads. An edit to a pending wait's title or note is no event. The stream keeps no
//!   history: a client that reconnects reads the waits it watches once (`arlesh_waits.get_many`),
//!   then follows the stream. The first read the server makes happens before the response starts,
//!   so a change after the client sees the response is always an event.
//!
//! A host that cannot hear every write (the desktop app, where a window's own writes announce
//! nothing here) sets [`EventStreams::poll`], and the wait stream reads again on that interval
//! as well as on each announced change.

mod feed;
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
use rules::{admitted, changes, WaitEvent, WaitState};

use super::{ids::full_id, lookup::Board};
use crate::{access::model::NodeTable, database::session::SessionFactory, error::AppError};

/// The event a `/events/changes` stream sends: the same as the app's window event.
pub const BOARD_CHANGED: &str = "board-changed";
/// The event a `/events/expectations` stream sends.
pub const WAIT_CHANGED: &str = "wait-changed";
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
        .route("/events/expectations", get(expectations_stream))
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

fn event_frame(event: &WaitEvent, revision: u64, epoch: &str) -> Bytes {
    let data = WaitEventData {
        change: event.change,
        wait: &event.wait,
        deleted: event.deleted(),
        revision,
        epoch,
    };
    frame(&format!("{epoch}:{revision}"), WAIT_CHANGED, &data)
}

fn guard(headers: &HeaderMap) -> Result<(), StatusCode> {
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

#[derive(Deserialize)]
struct ExpectationsQuery {
    #[serde(default)]
    agentic: bool,
}

struct Watching {
    factory: SessionFactory,
    streams: EventStreams,
    agentic: bool,
    known: BTreeMap<String, WaitState>,
    seen: u64,
    last_sent: Instant,
    pending: VecDeque<Bytes>,
}

async fn read_waits(
    factory: &SessionFactory,
    agentic: bool,
) -> Result<BTreeMap<String, WaitState>, AppError> {
    let mut db = factory.begin().await?;
    let now = chrono::Local::now().naive_local();
    let board = Board::read(&mut db, now, false).await?;
    Ok(wait_states(&board, agentic))
}

async fn expectations_stream(
    State(served): State<Served>,
    Query(query): Query<ExpectationsQuery>,
    headers: HeaderMap,
) -> Result<Response, StatusCode> {
    guard(&headers)?;
    // The baseline is read before the response starts: whatever changes after the client sees the
    // response is then an event, and whatever changed before is in the client's own catch-up read.
    let seen = served.streams.feed.revision();
    let known = read_waits(&served.factory, query.agentic)
        .await
        .map_err(|error| {
            tracing::warn!(error = %error, "could not read the waits for an event stream");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    let state = Watching {
        factory: served.factory,
        streams: served.streams,
        agentic: query.agentic,
        known,
        seen,
        last_sent: Instant::now(),
        pending: VecDeque::from([comment("connected")]),
    };
    let chunks = stream::unfold(state, |mut state| async move {
        loop {
            if let Some(chunk) = state.pending.pop_front() {
                state.last_sent = Instant::now();
                return Some((Chunk::Ok(chunk), state));
            }
            state.advance().await;
        }
    });
    Ok(event_stream(Body::from_stream(chunks)))
}

impl Watching {
    /// Waits for the board to move (or a tick), reads the waits when it may have, and queues what
    /// changed, or a keepalive when the stream has been quiet too long.
    async fn advance(&mut self) {
        let tick = self
            .streams
            .poll
            .map_or(KEEPALIVE, |poll| poll.min(KEEPALIVE));
        let moved = timeout(tick, self.streams.feed.after(self.seen)).await;
        if let Ok(reached) = moved {
            self.seen = reached;
        }
        if moved.is_ok() || self.streams.poll.is_some() {
            match read_waits(&self.factory, self.agentic).await {
                Ok(now) => {
                    let revision = self.streams.feed.revision();
                    let epoch = self.streams.feed.epoch();
                    for event in changes(&self.known, &now) {
                        self.pending.push_back(event_frame(&event, revision, epoch));
                    }
                    self.known = now;
                }
                // A failed read is retried at the next tick: the stream stays open.
                Err(error) => {
                    tracing::warn!(error = %error, "could not read the waits for an event stream")
                }
            }
        }
        if self.pending.is_empty() && self.last_sent.elapsed() >= KEEPALIVE {
            self.pending.push_back(comment("keepalive"));
        }
    }
}
