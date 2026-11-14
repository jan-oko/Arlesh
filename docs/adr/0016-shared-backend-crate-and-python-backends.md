# The Backend port moves into a shared crate, and Python picks a backend with `Arlesh(backend=…)`

The user decided on 2026-11-04 that the Python package gets the same Backend mechanics as the Rust
app: a script chooses the app's own SQLite or HTTP backend, shared from Rust and not reimplemented
in Python. The behaviour is specified in
[Client Mode](../spec/client-mode.md#the-backend-crate-and-python) and, for the server's side, in
[HTTP Server](../spec/http-api.md#code).

## Status

accepted (2026-11-04). Implemented in three stacked pull requests: the crate split, the bindings,
and the tests with the docs.

## Context

[ADR 0011](0011-client-mode.md) put a **Backend port** under the Tauri commands: one trait per
domain, `Backend` as their union, and two implementations. `SqliteBackend` runs the core in-process
(Standalone mode). `HttpBackend` calls `arlesh-server` (Client mode) and brings the revision
headers, gzip, reachability, the version handshake, pairing and the `/events` follower.
`conformance/client-mode.json` maps every port method to its route.

The Python package reached the core another way: `arlesh.Database` lists every operation, and
`arlesh.SqliteDatabase` sends each call as one tagged JSON request to `_native`, whose `request.rs`
has a match arm per operation. Python had no HTTP client, so a script could not talk to a server.

The backend code was almost free of the app: every `crate::` path except its own named an
`arlesh-core` module, the two notifications (`StatusNotify`, `events::Announce`) were already
callbacks, and the one real coupling was `Follower`'s `tauri::async_runtime::spawn`.

## Decisions

1. **A workspace crate, `arlesh-backend` (`crates/arlesh-backend`)** holds the port, `revision`,
   `sqlite/` and `http/` with their tests, and the test of the port against the conformance file.
   `src-tauri` and `arlesh-py` depend on it; it depends on `arlesh-core` and never on Tauri (CI
   checks `cargo tree`). `src-tauri/src/backend.rs` is `pub use arlesh_backend::*;` plus
   `AppBackend`, so no command changed. What knows what a window is stays in the app: the commands,
   `client_mode/` (`mode.json`, the vault), the notifier adapters, suspend and resume, the local MCP
   endpoint.
2. **Notifications stay callbacks, and the follower is given a runtime handle.** `Follower::new`
   takes a `tokio::runtime::Handle`, because `resume` is called from a window event on the main
   thread, outside any runtime, where a bare `tokio::spawn` panics. The app passes Tauri's tokio
   handle. The stream's path is one constant, `events::EVENTS_PATH`, so ADR 0013's rename is one
   line.
3. **Two cargo features, `sqlite` and `http`,** on by default. The app depends on the crate with
   only `http`, and its `standalone` feature enables `sqlite`, so Android's Client-only build
   compiles no `SqliteBackend`. `BoardRevision::from_headers` moved under `http`.
4. **The Python API: backends you describe, a façade you open.**

   ```python
   async with arlesh.Arlesh(backend=arlesh.HttpBackend(url, token=token)) as board:
       load = await board.board()
       async for change in board.changes():
           load = await board.board()
   ```

   `SqliteBackend(path, *, client=None, force=False)` and `HttpBackend(url, *, token)` describe a
   backend and do no I/O; `Arlesh` opens it on `async with` or `await open()`. `Arlesh`
   implements the existing `arlesh.Database` port with the same method names, models and errors.
   `arlesh.open` is a shortcut for an `Arlesh` over a `SqliteBackend`, and `SqliteDatabase` is
   another name for `Arlesh`, so scripts and `arlesh-server` do not change.
5. **HTTP is the app's own `HttpBackend`.** One Rust function maps each of `Database`'s operations to
   a port method (`crates/arlesh-py/src/backend_calls.rs`), so the revision headers, gzip, TLS, the
   version handshake and the stale-board read-only rule are the app's code, not a copy. Over a
   dropped server `board()` answers the board last loaded and every write is refused with
   `server_unreachable`; `server_status` says which. `serve_mcp`, `stop_mcp` and `reset_undo` are
   SQLite's: over HTTP they raise `NotPermitted` with `details.reason = "not_in_client_mode"`.
   `get_info` has no route on the port and is answered from `list_infos`; `board(at_capacity=…)`
   has none either and is refused over HTTP.
6. **SQLite stays on `request.rs`.** The brief allowed either; `SqliteBackend` in Python opens the
   database exactly as `arlesh.open` does. Replacing the second copy of the command bodies with the
   shared `SqliteBackend` needs the dispatcher to take over what `request.rs` does around each
   write (the Gesture, the client stamp, the revision counter that `arlesh-server`'s `/events`
   reads), and is left for its own change.
7. **Changes are an async iterator.** `changes()` yields a `BoardRevision | None` whenever the board
   changes, latest-wins (a `watch` channel, never a backlog). On HTTP the first iterator starts the
   crate's `Follower` and the last one to close stops it, so a script that never listens holds no
   connection. On SQLite it reads the in-process counter.
8. **`arlesh-server` runs on SQLite only.** A server over an `HttpBackend` is a relay, and a relay
   loops when pointed at itself, collapses every device's writes into one client (undo is per
   client) and has no hold or MCP. A relay needs its own ADR.
9. **Pairing gives the token; storing it is the caller's.** `arlesh.pairing.start` and `wait`
   return the PIN and then the token. The package stores nothing.

## Consequences

- The wheel gains `reqwest` and rustls with `ring`.
- `crates/arlesh-backend` is out of the coverage report as `src-tauri/src/backend/` was.
- Nothing user-visible changes in the app.

## Touchpoints

- ADR 0013 (`mcp-channels`) renames `/events` to `/events/changes`: whoever lands second changes
  `EVENTS_PATH` and the server's route.
- The WASM rules split adds a crate to the workspace `members`: keep both.
- FCM belongs to the app and uses the `Handle` the follower takes.
