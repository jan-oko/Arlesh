# The Backend port moves into a shared crate, and Python picks a backend with `Arlesh(backend=…)`

The user decided on 2026-11-04 that the Python package gets the same Backend mechanics as the Rust
app: a script chooses the app's own SQLite or HTTP backend, shared from Rust and not reimplemented
in Python. This ADR settles how. The behaviour is specified in
[Client Mode](../spec/client-mode.md#the-backend-crate-and-python) and, for the server's side, in
[HTTP Server](../spec/http-api.md#code).

## Status

proposed (2026-11-04). Nothing is implemented yet; the [delivery plan](#delivery) below lists the
pull requests.

## Context

[ADR 0011](0011-client-mode.md) put a **Backend port** under the Tauri commands
(`src-tauri/src/backend/`): one trait per domain (`BoardPort`, `TasksPort`, …), `Backend` as
their union, and two implementations. `SqliteBackend` runs the core in-process over the local file
(Standalone mode). `HttpBackend` calls `arlesh-server` (Client mode) and brings the revision
headers, gzip, reachability, the version handshake, pairing and the `/events` follower.
`conformance/client-mode.json` maps every port method to its route, and a test on each side holds
both sides to it.

The Python package (`crates/arlesh-py`) reaches the core by a different path. `arlesh.Database`
is an abstract class listing every operation, and `arlesh.SqliteDatabase` (what `arlesh.open`
returns) sends each call as one tagged JSON request to `_native`, whose `request.rs` has 105 arms.
Each arm "is what the matching Tauri command does": it is a **second copy** of `SqliteBackend`'s
bodies, written separately. Python has no HTTP client at all, so a script cannot talk to a server,
and `arlesh-server` (which wraps `SqliteDatabase`) is the only thing in Python that knows the HTTP
API.

The backend code is almost free of the app already:

- Every `crate::` path in `src-tauri/src/backend/` except `crate::backend` names an `arlesh-core`
  module through the re-export in `src-tauri/src/lib.rs`. The twelve `crate::commands::…` hits
  are doc links.
- The two notifications are already callbacks, not Tauri emits: `StatusNotify`
  (`Arc<dyn Fn(&ServerStatus)>`) and `events::Announce` (`Arc<dyn Fn(Option<BoardRevision>)>`).
  The emits are `commands::client_mode::status_notifier` and `commands::board::announce_revision`,
  app-side.
- The one real coupling is in `http/events.rs`: `Follower` spawns with
  `tauri::async_runtime::spawn` and stores a `tauri::async_runtime::JoinHandle`.

## Decisions

1. **A new workspace crate, `arlesh-backend` (`crates/arlesh-backend`).** It holds the port (every
   per-domain trait and `Backend`), `revision` (`BoardLoad`, `BoardRevision`), `sqlite/`
   (`SqliteBackend`) and `http/` (`HttpBackend`, `Connection`, `ServerStatus`, `Health`, `events`,
   `pairing`), with their unit tests and the port-versus-conformance test (`backend/tests.rs`).
   `src-tauri` and `arlesh-py` both depend on it, and it depends on `arlesh-core`, never on Tauri.
   *Why:* one implementation of each backend, run by both hosts. Python then runs the app's own
   code path, not a copy of it, and a fix to either backend reaches both.

   **What stays in `src-tauri`:** `AppBackend` (the `Arc<dyn Backend>` Tauri manages); every Tauri
   command; `client_mode/` (`mode.json`, the keyring vault); the two notifier adapters above, which
   turn a callback into a window event; the suspend and resume wiring
   (`commands::client_mode`, `WindowEvent::Suspended/Resumed`); the local MCP endpoint; windows,
   tabs and the tray. `src-tauri/src/backend.rs` becomes `pub use arlesh_backend::*;` plus
   `AppBackend`, the same re-export pattern `lib.rs` uses for the core, so no command changes.
   *Why:* everything that knows what a window is stays with the windows. The boundary is the one
   ADR 0011 drew for the port, now a crate boundary.

2. **Notifications stay callbacks; the follower is given a runtime handle.** The crate keeps
   `StatusNotify` and `Announce` as `Arc<dyn Fn … + Send + Sync>`. The app's callbacks emit to
   the windows, as now. Python's callbacks write into a `tokio::sync::watch` that its async
   iterator reads (decision 6). *Why:* a callback costs nothing when nobody listens and needs no
   new code in the app; a host that wants a channel wraps one in a closure, which is exactly what
   Python does. Choosing channels in the crate would have made the app add a forwarding task for
   the same result.

   `Follower::new` takes a `tokio::runtime::Handle` and spawns on it, storing a
   `tokio::task::JoinHandle`. It is **not** a bare `tokio::spawn`: `Follower::resume` is called
   from Tauri's `WindowEvent::Resumed` handler on the main thread, outside any runtime context,
   where `tokio::spawn` panics. The app passes `tauri::async_runtime::handle()`'s inner tokio
   handle, and Python passes the `pyo3-async-runtimes` runtime's handle. `crate::board::BOARD_CHANGED`
   becomes `arlesh_core::board::BOARD_CHANGED`, and the stream's path becomes one constant,
   `EVENTS_PATH`, so ADR 0013's rename (see [touchpoints](#touchpoints)) is a one-line change.

3. **Two cargo features, `sqlite` and `http`, both on by default.** `sqlite` gates `sqlite/`.
   `http` gates `http/`, `reqwest`, `rustls` and `BoardRevision::from_headers` (the one
   `reqwest` use outside `http/`, which moves into it). The port and `revision` are always built,
   so a fake backend can depend on the crate with no features. `src-tauri` depends on it with
   `default-features = false, features = ["http"]`, and its `standalone` feature becomes
   `standalone = ["arlesh-backend/sqlite"]`. So the Android build (`--no-default-features`)
   compiles no `SqliteBackend`, as today. `arlesh-py` enables both. A third feature, `schema`,
   derives `schemars::JsonSchema` on the crate's own wire types (`BoardRevision`, `ServerStatus`,
   `ReadOnlyReason`, `Health`, `PairStarted`, `PairStatus`), for `arlesh-py`'s model generator
   only. *Why:* Client-only stays lean without a second crate, and the app's existing feature
   keeps its meaning. `arlesh-core`, and with it `sqlx`, is still in Android's tree, as today:
   this ADR keeps Android's build as lean as it is now and does not try to make it leaner.

4. **The Python API: backends you describe, a façade you open.**

   ```python
   import arlesh

   async with arlesh.Arlesh(backend=arlesh.HttpBackend("https://arlesh.example", token=token)) as board:
       load = await board.board()

   async with arlesh.Arlesh(backend=arlesh.SqliteBackend("arlesh.db", client="notebook")) as board:
       ...

   db = await arlesh.open("arlesh.db", client="notebook")   # unchanged, a shortcut for the second
   ```

   - **`arlesh.SqliteBackend(path, *, client=None, force=False)`** and
     **`arlesh.HttpBackend(url, *, token)`** are native (pyo3) classes. Their constructors are
     synchronous and do no I/O: they *describe* a backend. **`arlesh.Arlesh(backend=…)`** opens it
     on `await Arlesh(backend=…).open()` or `async with`: SQLite opens the file (read-only without a
     `client`, migrating with one, checking the hold, exactly as `arlesh.open` does now), and HTTP
     builds the client and asks `/health`. *Why:* a Python constructor cannot `await`, and both
     opens do I/O that can be refused.
   - **`Arlesh` implements the `arlesh.Database` port**, which stays as it is: the abstract class
     the server and the tests' fakes depend on. `arlesh.open(path, client=…, force=…)` keeps its
     signature and returns an `Arlesh` over a `SqliteBackend`. `arlesh.SqliteDatabase` stays
     importable as an alias of `Arlesh`, for scripts that name it. *Why:* existing scripts and the
     server keep working with no change.
   - **The method names stay Python's** (`board`, `create_wait`, `set_tag`, `scope_lifecycles`,
     …), not the port's (`load_mindmap`, `create_expectation`, `add_tag_to_task`, …). They are the
     published Python API. `_native` maps each to a port method in **one table**, which replaces
     `request.rs`'s arms; the table is also exported as data, for the parity test (decision 9).
     The two Python-side compositions (`set_task_archived`, `set_commitment_archived`, which are
     `update_*` with an `archival`) stay in Python.
   - **Every method is a coroutine**, as now, run on the `pyo3-async-runtimes` tokio runtime over
     an `Arc<dyn Backend>`.
   - **Errors** are the core's `WireError` on both backends, so they map to `arlesh.errors` through
     the existing `from_native`, with no new classes. HTTP adds refusals that are already
     `not_permitted` with a `details.reason`: `server_unreachable`, `update_app`, `update_server`
     and `not_in_client_mode`. *Why:* the app's frontend handles a server's refusal exactly as a
     local one, and a script should too.
   - **Models** are the existing pydantic `arlesh.models`, generated from the Rust types. The few new
     types (decision 3's `schema` feature) are generated the same way.
   - **Operations only one backend has.** `serve_mcp`, `stop_mcp`, `reset_undo` and `arlesh.hold`
     are SQLite's: on an `HttpBackend` they raise `NotPermitted` with
     `details.reason = "not_in_client_mode"` (the server serves its own MCP at `/mcp`). People and
     the knowledge base are not in `Database` today, so nothing new is refused. `client` is the
     write-open's name on SQLite, and `None` on HTTP, where the token names the client and only the
     server knows it.
   - **HTTP behaves as the app's Client mode, with nothing turned off.** When the server cannot be
     reached, `board()` answers the board last loaded and every write is refused with
     `server_unreachable`; nothing is queued. A script reads `board.server_status`
     (`ServerStatus`: `reachable`, `last_sync`, `read_only`, `server_api_version`) to tell. *Why:*
     parity is the point of sharing the code, and the one difference (a stale board) is visible.
   - **gzip and TLS** are `reqwest`'s, as in the app (`gzip` feature, rustls with ring). Nothing is
     exposed: a script gets decompressed models.

5. **Revisions.** `board()` keeps returning `MindmapLoad`. `Arlesh.board_revision` is the stamp of
   the last board load, a `BoardRevision` (`epoch`, `revision`) on HTTP and `None` on SQLite, as
   in the app's Standalone mode. The existing `revision: int` and `next_change(after)` keep their
   meaning on SQLite (the in-process counter of `shared.rs`, shared by every open of the file). On
   HTTP, `revision` is the newest revision seen in a header or an event, and `next_change(after)`
   waits on the change stream, treating a new epoch as a change even when its revision is lower.

6. **Changes as an async iterator.**

   ```python
   async for change in board.changes():   # BoardRevision | None
       load = await board.board()
   ```

   `changes()` yields when the board changes, on both backends. On HTTP it runs the crate's
   `Follower` over `/events` (reconnects with backoff, `Last-Event-ID`, `/health` on reconnect),
   started by the first iterator and stopped when the last one closes, so a script that never
   listens holds no connection. On SQLite it reads the in-process counter, under a per-process
   epoch. Delivery is **latest-wins** (a `watch` channel): a slow consumer sees the newest
   revision, never a backlog. *Why:* a change event means "reload now", and only the newest one
   matters. It is also what the app's windows do.

7. **Pairing gives the token; storing it is the caller's.** `await arlesh.pairing.start(url, name)`
   returns a `PairStarted` (the PIN to show the user), and `await arlesh.pairing.wait(url,
   started)` polls until the PIN is approved and returns the token. The package stores no token
   anywhere. The app's keychain vault stays app-side. `HttpBackend` takes the token as an
   argument. *Why:* a script's secrets are its own business, and the vault is a desktop concern.

8. **`arlesh-server` moves to the shared `SqliteBackend`, and never runs on an `HttpBackend`.**
   The server reaches the board through `arlesh.open`, so it moves with no change of its own once
   `arlesh.open` returns an `Arlesh` over a `SqliteBackend`. Its `Board` keeps its `open_as(client)`
   and its write-open per client. Its composition root builds only a `SqliteBackend`, and
   `Board.open` refuses any other backend; there is no setting that chooses one. *Why:* a server
   over an `HttpBackend` is a relay, and a relay goes wrong in three ways:
   - **Loops.** Pointed at itself, or at a server that points back, each request becomes another
     request to itself and each `/events` subscriber another follower, until connections or
     timeouts run out. Nothing in the protocol would stop it.
   - **Identity.** Every write would reach the real server as the relay's own token, so the undo
     journal's per-client stamp (and so each device's own Undo) would collapse into one client.
   - **No hold, no MCP.** An `HttpBackend` takes no hold and cannot `serve_mcp`, so the server's
     startup guard and its per-client MCP endpoints would be gone.
   A relay, if one is ever wanted, needs its own ADR: a hop header (`X-Arlesh-Via`) to break loops
   and a way to forward the client's identity.

9. **Testing: one corpus, three readers, and a live server.**
   - The Rust side moves with the crate: `backend/tests.rs` (every port method is in `routes` or
     `standalone_only`) and the `http/` tests.
   - **A Python parity test** (`crates/arlesh-py/tests/test_backend_parity.py`, no server) replays
     `conformance/client-mode.json` against the Python façade: every method in `routes` is reached
     by a `Database` method through `_native`'s table, and every `Database` method is in the table
     or in a listed façade-only set (`close`, `serve_mcp`, `stop_mcp`, `reset_undo`, `revision`,
     `next_change`, `changes`, `client`, the two archival compositions). A port method with no
     Python method fails it, so the port and the package cannot drift apart.
   - **A live-server integration suite**
     (`crates/arlesh-py/tests/server/integration/test_python_http_backend.py`). The existing server
     tests use `fastapi.testclient.TestClient`, which is in-process ASGI with no socket, so
     `reqwest` cannot reach it. A new fixture, `live_server`, runs the same `ArleshServer` under
     uvicorn on `127.0.0.1:0` in a thread, with a token minted through the existing `tokens`
     fixture. The suite covers one create, read, update and delete per domain over `HttpBackend`,
     one refusal per error kind, `board_revision` from the headers, a gzipped board, `changes()`
     seeing a write made by a second client, `server_unreachable` after the server stops, and an
     `api_version` mismatch.
   - **The existing package tests run on both backends** where Client mode has the operation, by
     parametrizing their `db` fixture over `SqliteBackend` and `HttpBackend(live_server)`.
   - `SqliteBackend` writing as a non-desktop client must stamp that client on every journal entry.
     This is only true when every write runs in a transaction (`factory.begin()`), which is what
     `request.rs` guaranteed by construction. A test pins it for every write the table maps.

## Consequences

- `request.rs` (about 1,750 lines) goes, and with it the second copy of every command body. The
  bindings shrink to the open, the table, the façade-only operations and the conversions.
- The Python wheel gains `reqwest` and `rustls` with `ring`, which has a C and assembly build. It
  builds on the manylinux images maturin uses. The wheel grows by a few megabytes.
- The coverage gate measures the new crate as part of the workspace, as it does `arlesh-core`.
- The CI guard "arlesh-core does not depend on tauri" is extended to `arlesh-backend`.
- `docs/spec/client-mode.md` and `docs/spec/http-api.md` name `src-tauri/src/backend/`, and so does
  `conformance/client-mode.json`'s `about`; each is updated by the pull request that moves the code.
- Nothing user-visible changes in the app.

## Delivery

Sonnet-sized pull requests to `dev`, each green on its own, landed in this order. Every one keeps
the app's behaviour unchanged.

1. **Extract `arlesh-backend` (pure move).**
   *Scope:* `git mv` the port, `revision`, `sqlite/` and `http/` with their tests into
   `crates/arlesh-backend/src/`; rewrite `crate::<core module>` to `arlesh_core::`, and the doc
   links to `crate::commands::…` to prose; `Follower::new` takes a `tokio::runtime::Handle`;
   `EVENTS_PATH`; `from_headers` under `http`; the features of decision 3.
   *Files:* `Cargo.toml` (workspace `members`), `crates/arlesh-backend/**`, `src-tauri/Cargo.toml`,
   `src-tauri/src/backend.rs` (re-export plus `AppBackend`), `src-tauri/src/lib.rs` (the handle),
   `.github/workflows/ci.yml` (the Tauri guard; `cargo check -p arlesh-backend` with no features,
   `sqlite` only and `http` only), `conformance/client-mode.json` (`about` paths),
   `docs/spec/client-mode.md` (paths).
   *Acceptance:* `cargo test -p arlesh-backend` and `-p arlesh` pass with no test changed except its
   path; `cargo check -p arlesh --no-default-features` builds without the `sqlite` module;
   `cargo tree -p arlesh-backend` has no `tauri`; the Android CI build is green.

2. **Close the port's gaps against Python.**
   *Scope:* the operations Python has that the port lacks: `get_info` (`GET /infos/{id}`, which the
   server already serves) and the `at_capacity` override on the board (`load_mindmap(now,
   at_capacity: Option<bool>)`, the app passing `None`); audit the `now=` arguments Python's
   methods take against the port's, and add the missing ones. Add each to both backends and to
   `conformance/client-mode.json`.
   *Files:* `crates/arlesh-backend/src/{infos,mindmap}.rs` and their `sqlite/`, `http/`
   implementations, `src-tauri/src/commands/mindmap.rs`, `conformance/client-mode.json`.
   *Acceptance:* the Rust conformance test and the server's `test_server_parity.py` pass with the
   new routes listed.

3. **`_native` over the shared `SqliteBackend`.**
   *Scope:* `_native.SqliteBackend` and the native façade over `Arc<dyn Backend>`; the method table
   replaces `request.rs`; `arlesh.Arlesh`, `arlesh.SqliteBackend`; `Database` unchanged;
   `SqliteDatabase` an alias; `arlesh.open` builds an `Arlesh`; the revision bump moves to the
   table's write entries; the parity test (decision 9) and the client-stamp test.
   *Files:* `crates/arlesh-py/Cargo.toml`, `crates/arlesh-py/src/{lib,request,shared,opening}.rs`
   (and a new `backends.rs`), `crates/arlesh-py/python/arlesh/{__init__,database,_native.pyi}.py`,
   `crates/arlesh-py/tests/test_backend_parity.py`.
   *Acceptance:* the whole existing Python suite, server tests included, passes unchanged;
   `request.rs` is gone; the parity test passes.

4. **`HttpBackend` from Python.**
   *Scope:* `arlesh.HttpBackend(url, token=…)`; `server_status`; `board_revision`; the
   `not_in_client_mode` refusals of decision 4; `arlesh.pairing.start` and `wait`; the `schema`
   feature's models; the `live_server` fixture and `test_python_http_backend.py` (without
   `changes()`); the `db` fixture parametrized over both backends.
   *Files:* `crates/arlesh-py/src/backends.rs`, `crates/arlesh-py/python/arlesh/{database,pairing,
   models}.py`, `crates/arlesh-py/generate_models.py`, `crates/arlesh-py/tests/server/conftest.py`,
   the new test file.
   *Acceptance:* the suite passes on both backends; a refusal over HTTP raises the same class as
   the same refusal over SQLite.

5. **`changes()` and `next_change` over HTTP.**
   *Scope:* the watch-backed follower bridge, started on first iteration and stopped on the last
   close; `next_change` and `revision` over it; the SQLite side of `changes()`.
   *Files:* `crates/arlesh-py/src/backends.rs` (or a `changes.rs`),
   `crates/arlesh-py/python/arlesh/database.py`, the live-server suite.
   *Acceptance:* a write by a second client reaches an open `changes()` iterator; closing every
   iterator closes the stream (the server's subscriber count drops to 0); a server restart is seen
   as a new epoch.

6. **The server: SQLite only, and the docs.**
   *Scope:* `Board.open` refuses a non-SQLite backend; the server's docstrings name `Arlesh`; the
   spec's *Code* section.
   *Files:* `crates/arlesh-py/python/arlesh/server/business_logic/board.py`,
   `crates/arlesh-py/python/arlesh/server/__init__.py`, `docs/spec/http-api.md`, a unit test.
   *Acceptance:* a `Board` handed an `HttpBackend` opener refuses at startup.

PRs 4 and 5 can be reviewed in parallel once 3 lands. A changelog fragment (`added`) goes with PR 4,
the first user-visible change: Python scripts can talk to a server.

### Touchpoints

- **ADR 0013 (branch `mcp-channels`), if it renames `/events` to `/events/changes`.** The follower
  is `http/events.rs`, which PR 1 moves. Whichever lands second carries the change: after PR 1 it is
  `EVENTS_PATH` in `crates/arlesh-backend/src/http/events.rs`, the server's route, and the `about`
  text. The Python `changes()` (PR 5) follows the constant and needs nothing more.
- **The WASM rules split** adds another crate, so it and PR 1 both edit the workspace `members` in
  the root `Cargo.toml`: a one-line conflict. If rules modules leave `arlesh-core`, the backend's
  imports of `arlesh_core::tasks::rules::dependencies::candidates` and
  `arlesh_core::mindmap::rules::plans::PlanClampTarget` keep working only through the re-export the
  rules convention requires (`.claude/rules/rust.md`, *Modules moved into `rules` keep their old
  path*). Either order works.
- **FCM (Android push).** It belongs to the app: the receiver, the token registration and waking
  the follower stay in `src-tauri`. It touches the backend crate only if it changes how the
  follower suspends or resumes (`Follower::resume`/`suspend`, `client_mode.rs`'s window events).
  It should land after PR 1 or rebase onto it, and use the `Handle` the follower now takes.

## Open questions

These are for the user. The ADR assumes the answer in brackets until they say otherwise.

1. **The façade's name and shape.** Is `arlesh.Arlesh(backend=…)` opened by `await
   Arlesh(backend=…).open()` or `async with` (two steps, as decided above), or do you want a one-step
   `await arlesh.connect(backend)`? [Two steps, with `arlesh.open` kept as the one-step shortcut
   for SQLite.]
2. **The token from the environment.** Should `HttpBackend(url)` with no `token` read
   `ARLESH_TOKEN`, and the URL `ARLESH_URL`? [No: the token is required, so nothing is picked up
   by surprise.]
3. **The stale board over HTTP.** A script gets the last loaded board, read-only, while the
   server is unreachable, as the app does. Do you want an option to raise instead
   (`HttpBackend(..., offline="raise")`)? [No option: parity, with `server_status` to check.]
4. **`SqliteDatabase`.** Keep it as a permanent alias of `Arlesh`, or deprecate it with a warning
   and remove it in a later version? [Keep it, undeprecated, until you say otherwise.]
5. **Package version.** Is PR 4 (the first new public API) a minor bump of `arlesh` (0.3.0 →
   0.4.0)? [Yes.]
