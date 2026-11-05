//! The app's own [`HttpBackend`], for Python: Client mode as a script sees it.
//!
//! [`NativeHttpBackend`] wraps the shared `arlesh-backend` client, so the revision headers, gzip,
//! TLS, the version handshake and the stale-board rule are the app's code and not a copy. Calls go
//! through [`crate::backend_calls`]; the change stream is the crate's `Follower`, whose announcements
//! land in a `watch` channel so a slow reader sees only the newest (a change means "reload now").

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use arlesh_backend::{
    http::{events::Follower, pairing, Connection, HttpBackend},
    revision::BoardRevision,
};
use arlesh_core::error::{WireError, WireErrorKind};
use pyo3::prelude::*;
use serde::Serialize;
use tokio::sync::watch;

use crate::errors::{raise, Failure};
use crate::request::Request;

/// One notification from the change stream.
#[derive(Clone, Default)]
struct Change {
    /// Counts notifications, so two with the same stamp are still two.
    seq: u64,
    /// The stamp the event carried, when it carried one.
    revision: Option<BoardRevision>,
}

/// What the stream and the board loads have told this backend.
struct Feed {
    sender: watch::Sender<Change>,
    /// The newest stamp seen in a header or an event.
    seen: Mutex<Option<BoardRevision>>,
}

impl Feed {
    fn remember(&self, revision: Option<BoardRevision>) {
        if let Some(revision) = revision {
            *self.seen.lock().unwrap_or_else(|p| p.into_inner()) = Some(revision);
        }
    }

    fn publish(&self, revision: Option<BoardRevision>) {
        self.remember(revision.clone());
        self.sender.send_modify(|change| {
            change.seq += 1;
            change.revision = revision;
        });
    }

    fn seen(&self) -> Option<BoardRevision> {
        self.seen.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }
}

/// An opened connection to an `arlesh-server`.
#[pyclass(module = "arlesh._native", frozen)]
pub(crate) struct NativeHttpBackend {
    backend: Arc<HttpBackend>,
    follower: Follower,
    feed: Arc<Feed>,
    /// How many `changes()` iterators are open; the stream runs while there is one.
    listeners: AtomicUsize,
}

fn json_string(value: &impl Serialize) -> PyResult<String> {
    serde_json::to_string(value).map_err(|error| raise(WireError::internal(error.to_string())))
}

#[pymethods]
impl NativeHttpBackend {
    /// Runs one request against the server and answers its result as JSON.
    fn call<'py>(&self, py: Python<'py>, request: String) -> PyResult<Bound<'py, PyAny>> {
        let backend = Arc::clone(&self.backend);
        let feed = Arc::clone(&self.feed);
        pyo3_async_runtimes::tokio::future_into_py(py, async move {
            let request: Request = serde_json::from_str(&request).map_err(|error| {
                raise(Failure::new(
                    WireErrorKind::InvalidRequest,
                    format!("unreadable request: {error}"),
                ))
            })?;
            let answer = Box::pin(crate::backend_calls::run(backend.as_ref(), request))
                .await
                .map_err(raise)?;
            feed.remember(answer.revision);
            Ok(answer.value.to_string())
        })
    }

    /// The connection's status as JSON: `url`, `reachable`, `last_sync`, `read_only`,
    /// `server_api_version`.
    fn server_status(&self) -> PyResult<String> {
        json_string(&self.backend.status())
    }

    /// The stamp of the newest board load or event, as JSON (`epoch`, `revision`), or `None`.
    fn board_revision(&self) -> PyResult<Option<String>> {
        self.feed.seen().map(|seen| json_string(&seen)).transpose()
    }

    /// The newest revision seen, or 0.
    #[getter]
    fn revision(&self) -> u64 {
        self.feed.seen().map_or(0, |seen| seen.revision)
    }

    /// No client: the token names it, and only the server knows.
    #[getter]
    fn client(&self) -> Option<String> {
        None
    }

    /// Starts following the change stream, if no listener already does.
    fn follow(&self) {
        if self.listeners.fetch_add(1, Ordering::SeqCst) == 0 {
            self.follower.resume();
        }
    }

    /// One listener fewer; the stream stops with the last.
    fn unfollow(&self) {
        let previous = self
            .listeners
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1));
        if previous == Ok(1) {
            self.follower.suspend();
        }
    }

    /// Whether the stream is being followed now.
    fn following(&self) -> bool {
        self.follower.is_following()
    }

    /// Waits for a notification newer than `seq` and answers it as JSON (`seq`, `revision`).
    fn wait_change<'py>(&self, py: Python<'py>, seq: u64) -> PyResult<Bound<'py, PyAny>> {
        let mut receiver = self.feed.sender.subscribe();
        pyo3_async_runtimes::tokio::future_into_py(py, async move {
            let change = receiver
                .wait_for(|change| change.seq > seq)
                .await
                .map_err(|_| raise(WireError::internal("the change feed closed")))?
                .clone();
            Ok(serde_json::json!({ "seq": change.seq, "revision": change.revision }).to_string())
        })
    }

    /// The notifications so far.
    #[getter]
    fn change_seq(&self) -> u64 {
        self.feed.sender.borrow().seq
    }

    /// Refused: the server serves its own MCP endpoint.
    fn serve_mcp<'py>(
        &self,
        py: Python<'py>,
        _host: String,
        _port: u16,
    ) -> PyResult<Bound<'py, PyAny>> {
        refused(py, "serving MCP")
    }

    /// Refused, as [`Self::serve_mcp`].
    fn stop_mcp<'py>(&self, py: Python<'py>) -> PyResult<Bound<'py, PyAny>> {
        refused(py, "stopping MCP")
    }

    /// Refused: only the server resets its journal.
    fn reset_undo<'py>(&self, py: Python<'py>) -> PyResult<Bound<'py, PyAny>> {
        refused(py, "resetting the undo journal")
    }

    /// Stops following the stream.
    fn close<'py>(&self, py: Python<'py>) -> PyResult<Bound<'py, PyAny>> {
        self.follower.suspend();
        self.listeners.store(0, Ordering::SeqCst);
        pyo3_async_runtimes::tokio::future_into_py(py, async { Ok(()) })
    }
}

fn refused<'py>(py: Python<'py>, what: &'static str) -> PyResult<Bound<'py, PyAny>> {
    pyo3_async_runtimes::tokio::future_into_py(py, async move {
        Err::<(), _>(raise(arlesh_backend::http::not_in_client_mode(what)))
    })
}

/// Connects to the server at `url` with `token`, asking `/health` once.
#[pyfunction]
pub(crate) fn connect(py: Python<'_>, url: String, token: String) -> PyResult<Bound<'_, PyAny>> {
    pyo3_async_runtimes::tokio::future_into_py(py, async move {
        let backend = Arc::new(
            HttpBackend::new(Connection::new(url, token), Arc::new(|_| {})).map_err(raise)?,
        );
        let feed = Arc::new(Feed {
            sender: watch::Sender::new(Change::default()),
            seen: Mutex::new(None),
        });
        let announced = Arc::clone(&feed);
        let follower = Follower::new(
            Arc::clone(&backend),
            Arc::new(move |revision| announced.publish(revision)),
            pyo3_async_runtimes::tokio::get_runtime().handle().clone(),
        );
        backend.check_health().await.map_err(raise)?;
        Ok(NativeHttpBackend {
            backend,
            follower,
            feed,
            listeners: AtomicUsize::new(0),
        })
    })
}

/// Asks the server at `url` for a PIN for a device named `name`; answers `PairStarted` as JSON.
#[pyfunction]
pub(crate) fn pair_start(
    py: Python<'_>,
    url: String,
    name: Option<String>,
) -> PyResult<Bound<'_, PyAny>> {
    pyo3_async_runtimes::tokio::future_into_py(py, async move {
        let started = pairing::pair_start(&url, name.as_deref())
            .await
            .map_err(raise)?;
        json_string(&started)
    })
}

/// Asks whether the PIN of request `id` was approved; answers `PairPolled` as JSON.
#[pyfunction]
pub(crate) fn pair_poll(
    py: Python<'_>,
    url: String,
    id: String,
    pin: String,
) -> PyResult<Bound<'_, PyAny>> {
    pyo3_async_runtimes::tokio::future_into_py(py, async move {
        let polled = pairing::pair_poll(&url, &id, &pin).await.map_err(raise)?;
        json_string(&polled)
    })
}
