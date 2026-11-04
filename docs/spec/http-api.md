# HTTP Server

*One area of the [Arlesh design specification](../../SPEC.md).*

`arlesh-server` serves the board over HTTP: the whole board in one request, every node kind's
writes, the scope and lifecycle rules a client needs, and Arlesh's MCP endpoint at `/mcp`. It is
the first step of multi-device (2bd, settled with the user 2026-10-03). It runs the core itself,
through the Python bindings (`crates/arlesh-py`), so every rule, every write's atomicity and every
refusal is the Rust core's own. **No business logic lives in Python.** Each route translates HTTP
into one binding call and the answer back into HTTP, in the same spirit as the thin Tauri command
layer.

## Direction

The desktop app runs in one of two modes (see [Client Mode](client-mode.md), Task `9f0`):

- **Standalone** is the app as it has always been. It owns its local database, holds it while it
  runs, and serves its own MCP endpoint.
- **Client** makes the app a client of `arlesh-server`. The server is then the only writer, and it
  serves the MCP. The app serves none. Every operation the app's commands make goes through its
  Backend port, which in Client mode calls this server's routes; so every port method has a route
  here, except People and the knowledge base, which stay Standalone-only.

There is never more than one writer per database, and there is a single user, so neither mode needs
multi-writer support. The **hold** below is the safety net. The server takes the same hold the app
takes, so whichever of a Standalone app and the server starts second on the same file cannot hold
it, and the server refuses to start rather than become a second writer. A Client-mode app opens no
database, so it takes no hold.

## Running

```
pip install 'arlesh[server]'
arlesh-server --db <path> [--host <addr>] [--port N] [--tls-cert F --tls-key F] [--force]
```

It is started by hand on whichever machine holds the database. There is no unit file and no
service manager. The flags can also come from the environment, as `ARLESH_DATABASE__PATH`,
`ARLESH_DATABASE__FORCE`, `ARLESH_SERVER__HOST` and so on (pydantic-settings, nested with `__`).

- **The database as a URL.** `ARLESH_DATABASE_URL` names the database the way a container expects:
  `sqlite:///relative.db` or `sqlite:////absolute/arlesh.db`. `ARLESH_DATABASE_URL_FILE` names a
  file holding the URL instead, for a secret mounted as a file; giving both is refused. SQLite is
  the only scheme for now (Postgres comes later, through portable SQL). `--db` and
  `ARLESH_DATABASE__PATH` stay as the shorthand and win over the URL.

- **Address.** It listens on `127.0.0.1:4750` by default. `--host` opts in to a LAN or Tailscale
  address.
- **TLS** is optional, through `--tls-cert` and `--tls-key`, which must be given together.
  Without them the server speaks plain HTTP. Tailscale already encrypts its own traffic, but **on a
  plain LAN, plain HTTP sends the bearer tokens in the clear**. The server logs a warning when it
  serves plain HTTP on an address other than loopback.
- **The database** is opened for writing at startup, and migrated if it is behind. A missing file
  is created. A schema newer than the build is refused.

## Tokens and client identity

Every request needs a **bearer token**, reads included. A request without one, or with one this
server did not issue, is refused **401**. The body has kind `not_permitted` and
`details.reason` set to `missing_token` or `bad_token`, and the response carries
`WWW-Authenticate: Bearer`. The OpenAPI document (`/openapi.json`) and its page (`/docs`) are
the only paths open without a token: they describe the API and hold no board data.

```
arlesh-server token add <client> --db <path>     # prints the token, once
arlesh-server token list --db <path>
arlesh-server token revoke <client> --db <path>
arlesh-server pin list --db <path>                       # devices showing a PIN
arlesh-server pin approve <pin> [--name <n>] --db <path> # prompts for the name on a terminal
```

Tokens live **in the database**, in the server-only table `server_tokens` (migration 0097, Task
`9f0`), so they travel with the database they guard: a server seeded by copying `arlesh.db` keeps
its devices. The desktop app never reads the table, and it is not journaled, so no Ctrl+Z can bring
a revoked token back. Each token is kept as a SHA-256 digest; a token is 256 random bits, so a slow
hash would add nothing. A client has one token at a time: `add` refuses a client that already holds
one, so revoke it first. The table is read on every request, so a revoke takes effect at once,
without a restart.

The table is reached through the bindings, never Python's own `sqlite3`: two copies of SQLite in one
process do not see each other's locks, and the WAL is corrupted under them. Tokens used to live in
`<db>.tokens` beside the database. The first time the server or a `token` command runs, that file's
tokens are moved into the table and the file is renamed `<db>.tokens.imported`, so a token revoked
later cannot come back from it. Reading the table migrates the database if it is behind, so the
server reads it at startup only when nothing holds the database (or it was forced).

**The token decides the client.** The client is the name the undo journal records on every write
(see [Undo](undo.md), *Clients, and a second writer*), so a request cannot write under another
client's name. The server keeps one write-open of the database per client, opened on that
client's first write and kept until shutdown, because the bindings fix a write-open's client when
it opens. Client names follow the core's rule: letters, digits, `.`, `_` and `-`. The server does
not check a name when it issues the token. A token issued to a name the core refuses can still
read, but its first write is refused 400 with `details.reason = "invalid_client"`.

## The hold: one writer per database

The desktop app holds its database while it runs: an operating-system lock on `<db>.lock`
(`AppHold` in the core, released when its process ends, so a crash leaves nothing stale). The
server takes **the same hold** at startup and keeps it until it stops (2026-10-08). So:

- **While the app or another server holds the database**, the server refuses to start. It logs
  *Refusing to start* with the reason (`not_permitted`, `details.reason = "held"`) and exits.
- **An app started while the server runs** cannot take its hold. The app does not stop for that:
  it logs a warning (`could not hold the database`) and runs, with nothing shown in its window.
  Making the app refuse, or say so, is the app's server-mode work, not this server's.
- **A script's write-open** (`arlesh.open(path, client=...)`) keeps its check-only behaviour: it
  is refused (`held_by_app`) while the server holds the database, unless it forces.
- **`--force`** (or `ARLESH_DATABASE__FORCE=true`) starts the server even though the database is
  held, and then it takes no hold. It warns plainly that the app or another server, if writing,
  and this server are now two writers to one file.

Holding the database, the server opens every write-open (its own at startup, and each client's
on its first write) past the open's own check, which would otherwise find the server's own hold.
The bindings expose the hold as `arlesh.hold(path)`, which answers an `arlesh.Hold` to `release()`.

## Routes

Routes follow the domain layer, not the Tauri command names. Request and response bodies are the
core's own types: the pydantic models in `arlesh.models`, generated from the Rust types' JSON
Schema. So the OpenAPI schema comes from the same source as the bindings, with no hand-written
copies. An update's field left out stays unchanged, and an explicit `null` clears it. Ids in a path
are row ids, or a Habit occurrence's UUID where the core takes either.

| Path | What |
| --- | --- |
| `GET /health` | `api_version`, the package `version` and the build `commit` (`ARLESH_COMMIT`): the app's handshake. Behind the token, so checking it checks the token |
| `GET /events` | The change stream (below) |
| `GET /board?now=&at_capacity=` | The whole board: every node with its lifecycle, short id and facts |
| `/board` | `GET /lifecycles?now=`, `/task-dependencies?now=`, `/block-reasons`: the board's parts on their own |
| `GET /tasks`, `/goals`, `/commitments`, `/waits` `?now=` | Every node of the kind, derived at `now`, as the board has them |
| `/tasks` | `GET /{id}`, create, `PATCH /{id}?confirmed=&descendant_plans=` (an update; naming a parent and position moves the Task), delete, `PUT /{id}/archived?archived=`, `POST /{id}/plan-containment-conflicts` (the body is the new Plan; writes nothing), `POST /{id}/status?step=`, `/agentic/toggle`, `/dependencies` (`GET`, `POST`, and `DELETE` with the dependency as its body), `/done-at`, `/duplicate`, `/convert-to-flow`, `/spawned-wait` and its check, `GET /{id}/dependency-candidates` (what the quick dependency picker offers) |
| `/goals` | `GET /{id}`, create, `PATCH /{id}?confirmed=`, delete, `/duplicate`, `/convert-to-flow` |
| `/commitments` | `GET /{id}`, create, update, delete, `PUT /{id}/archived?archived=`, `POST /{id}/verdict?press=` |
| `/waits` | create, update, delete, `/check/complete`, `/check/reopen` |
| `/infos`, `/domains` | read, create, update, delete, `/duplicate`; `GET /infos`; `GET /domains?subtype=` |
| `/flows` | read, create, update, delete, `/start`, `/recurrence` (`GET` too), `/habit-modifications`, `/fork`, `/duplicate`, `/dependencies`; `GET` the list, `/{id}/goals`, `/{id}/tasks`, `/{id}/completion-count`, `/instance-nodes`; `POST /origins` and `/scope-valid-targets` (reads, the body a list of nodes) |
| `/flow-items` | create and update `flow_goal`, `flow_task`, `flow_commitment` and `flow_expectation` items, delete, `/cycles?reconcile=`, `/dependencies`, `/duplicate`; `GET /flow_goal`, `/flow_task`, `/cycles`, `/dependencies`: every Flow's |
| `/nodes/{kind}/{id}` | `/tags/{tag_id}` (`PUT` and `DELETE`), `/block-reasons`, `POST /scope-containment-conflicts` (the body a Time Scope) and `GET /reparent-conflicts?parent_type=&parent_id=`: what-ifs that write nothing |
| `/capacity` | The agent capacity lock: `GET`, and `PUT` with `{"at_capacity": …}`. One lock per database file, shared by every route and every client's MCP endpoint |
| `/undo`, `/redo` | `GET /undo` (what the calling client's next undo and redo would be), `POST /undo`, `POST /redo`: the calling client's own stacks. `null` when there is nothing to take back |
| `/gestures` | The gesture operations: each gesture the app makes over several commands, as one request — one transaction, one undo step. `POST /delete-nodes` (the body a list of `{kind, id}`), and `POST /paste`, `/insert-parent`, `/move-node`, `/plan-tasks`, `/plan-move`, `/save-task`, `/save-goal`, `/save-commitment`, `/save-project`, `/save-wait`, `/save-flow`, `/save-flow-item`, `/new-flow` and `/archive-nodes`, each with the gesture's writes as its body and answering each write's result (see [Client Mode](client-mode.md), *Undo*) |
| `/mcp-access` | The MCP roots: `GET` (what the MCP can see), `GET /catalogue`, `PUT` and `DELETE /roots/{node_kind}/{node_id}` |
| `/scopes` | `GET /containing?kind=&date=`, `POST /resolve?now=` (the body is a scope key) |
| `/rules` | `POST /item-state`, `POST /commitment-state`: the derived lifecycles |
| `/mcp` | Arlesh's MCP endpoint (below) |
| `POST /pair`, `POST /pair/poll` | **Open without a token.** A new device asks for a PIN (body `{"name"}`, answers `id`, `pin`, `name`, `expires_at`; rate limited per address) and polls with `{"id", "pin"}` (answers `pending`, or `approved` with the device's `name` and `token`, once). See *Pairing* below |
| `/devices`, `/pairings` | `GET /devices` (name, `created_at`, `last_seen_at`, `current`), `DELETE /devices/{name}` (not the asking device's own), `GET /pairings/{pin}` (the name a waiting device suggests) and `POST /pairings/{pin}/approve` (body `{"name"}`, optional; answers the name as saved) |

## Pairing

A device with no token gets one by pairing (Task 289): `POST /pair` and `POST /pair/poll` are the only
routes besides `/openapi.json` and `/docs` open without a token, and `/pair` is rate limited per
address (429, `details.reason = "rate_limited"`, `Retry-After`). The PIN rules, the safeguards and
the naming are in [Client Mode](client-mode.md), *Pairing a device*. The signed-in side is
`arlesh-server pin list|approve` on the command line, and `/devices` and `/pairings` over HTTP.

Pairing refusals carry `details.reason`: `unknown_pairing` (404: the request is unknown, used,
expired or invalidated), `unknown_pin` and `unknown_device` (404), `wrong_pin` (403, with
`remaining`), `pin_invalidated` and `current_device` (403), `too_many_pending` (429).

The PINs are in the server-only table `pairing_pins` (migration 0098), reached through the bindings
like the tokens, and not journaled. The same migration adds `server_tokens.last_seen_at`, which
`/devices` reports; the server writes it at most once a minute per device.

**Parity with the app.** Every method of the desktop app's Backend port has a route here, except
People and the knowledge base, which have none (see [Client Mode](client-mode.md)). The mapping is
`conformance/client-mode.json`, which both sides test: the app that every port method is listed, the
server that every listed route is served and that its `API_VERSION` is the app's.

## Undo: every write is one Gesture

Each write request is one Gesture of the client its token names: the server opens it before the
write and closes it after, so it reaches that client's Undo Stack as one step, and a client's undo
never takes back another's write. The open, the write and the close run under a lock per database
file, so no other client's write lands inside the Gesture; an agent's write through `/mcp` still
can, journaled as source `mcp` and kept off every stack, as in the app. A Gesture never stays open
between requests: a gesture the app makes over several nodes is one of the `/gestures` operations
instead (see [Client Mode](client-mode.md), *Undo*). The stacks are in memory, one pair per client,
and start empty with the server, which also clears the journal at startup as the app does.

## Live sync: `/events`

`GET /events` is a Server-Sent Events stream. Every committed write bumps the board's **revision**:
a write through any route as any client, the capacity lock, and an agent's write through `/mcp`.
The revision is one per database file, shared by every open of it in the process, and it starts at
0 when the server starts. The stream sends `event: board-changed` with `data: {"revision": n,
"epoch": e}` when the revision moves past the last one it sent, so writes close together arrive as
one event. Each event's id is `<epoch>:<revision>`, the epoch naming this run of the server. A
client reconnecting with `Last-Event-ID` is sent one event at once if it missed anything: the
revision moved past its own, or the server restarted. A comment goes out every 15 s of silence, so
a proxy keeps the stream open.

## Revision on every answer, and gzip

Every answer carries two headers, `X-Arlesh-Revision` and `X-Arlesh-Epoch`: the same pair the
stream sends, so a client holding a copy of the board can tell whether the next event is news. A
**read** (`GET`) carries the revision as it stood when the request arrived, before the read ran, so
a write landing mid-read can make the copy look older than it is and never newer: a client reloads
once too often, never once too few. A **write** carries the revision after it committed. The
headers are used rather than a body envelope so no response shape changes. The board's own body
(`/board`) is unchanged.

Answers over 1 KB are gzipped when the client sends `Accept-Encoding: gzip`. `/events` never is: a
compressor holds a stream back until it has enough to compress, and an event must arrive as it
happens.

## Errors

Every response that is not a success has the same body: the core's `kind`, a `message` and
`details`. A server-side (5xx) failure also carries a `transaction_id`, which names the request
in the server's log. A client branches on `kind`, never on the status alone.

| Kind | Status |
| --- | --- |
| `not_found` | 404 |
| `invalid_request`, `ambiguous_id` | 400 |
| `containment_violated`, `status_changed` | 409 |
| `needs_confirmation`, `needs_time_scope` | 422: *send it again with more* |
| `not_permitted` | 403, or 401 when the token is missing or bad |
| `database`, `internal` | 500 |

A request that does not match its schema is 400 `invalid_request`, with `details.reason =
"validation"` and the field errors. An unknown route is 404 `not_found` with `details.reason = "unknown_route"`, so a newer app can tell a
feature this server lacks from a missing node; a kind the server
does not know is answered as 500 `internal`. FastAPI's own 422 for a malformed request is
replaced, because 422 here means *confirm or add a window*.

**The confirmation protocol is kept, not flattened.** A write the core will not make without
consent, such as completing a Habit occurrence that still holds unfinished children, is refused
422 `needs_confirmation`. Its `details` name what is at stake. The same request sent again with
`?confirmed=true` goes ahead. Setting a Flow item's cycles is confirmed with `?reconcile=fork` or
`discard`. A Commitment with no window is refused 422 `needs_time_scope`, and goes ahead when sent
again with a `time_scope`. A new Plan on a Task that would leave a Task below it outside the Plan
it inherits is refused 409 `containment_violated`. `POST /tasks/{id}/plan-containment-conflicts`
names those Tasks, and the update goes ahead when sent again with `?descendant_plans=clamp` or
`clear`.

## The MCP at `/mcp`

The server serves Arlesh's MCP endpoint, with the core's own router, tools and rules (see
[MCP Server](mcp-server.md)). The core router is served on a private loopback port through the
bindings (`Database.serve_mcp`), and `/mcp` is a **streaming reverse proxy** to it:

- **It sits behind the same token.** A request without a token is refused 401 before it reaches
  the router, which has no authentication of its own.
- **It passes `POST`, `GET` and `DELETE` through.** Responses stream back unbuffered, so
  Server-Sent Events arrive as they are sent. `Accept`, `Content-Type`, `mcp-session-id`,
  `mcp-protocol-version` and `Last-Event-ID` go upstream. `Content-Type`, `mcp-session-id`,
  `mcp-protocol-version`, `Cache-Control` and `Content-Encoding` come back.
- **It strips what the router refuses.** The router admits a loopback `Host` only and rejects any
  request carrying an `Origin`. So the proxy sends a loopback `Host` and never forwards
  `Authorization`, `Origin` or `Referer`.
- **Each client gets its own endpoint.** It is served from that client's write-open on its first
  MCP request. So an agent's writes are journaled as source `mcp` under the client its token
  names, as every other route's are. Each endpoint stops when its database closes at shutdown.

## Code

The server lives in the `arlesh` package as `arlesh.server`, installed by the optional extra
`arlesh[server]` (FastAPI, uvicorn, pydantic-settings, loguru, httpx, Typer). The extra also
installs the `arlesh-server` command. Its layout follows the user's Librarian project:
`business_logic/`, `entrypoints/` (the ways in) and `ports/` (the ways out).

- **The database seam belongs to the `arlesh` package.** `arlesh.Database` is the port: an
  abstract class listing every operation. `arlesh.SqliteDatabase` is its implementation, the
  Rust core over the SQLite file, which `arlesh.open` returns. The server depends on the port
  only. Its composition root injects the implementation, and its unit tests inject a fake.
- **`business_logic/board.py`**: the `Board` holds which open database a request reads and writes
  through. It takes the hold, keeps one write-open per client, and serves each client's MCP
  endpoint from that client's write-open. It is handed an `open_as(client)` answering the
  package's port, and a `take_hold()`.
- **`entrypoints/`**, the ways in:
  - `cli/app.py`: the `arlesh-server` command (Typer), and the composition root. Run with no
    command, it serves; `token add|list|revoke` manage tokens. It builds the `Board` over
    `arlesh.open` and `arlesh.hold`.
  - `fastapi/`:
    - `app.py`: `ArleshServer` (a `FastAPI` subclass) and `AppRouter`, which puts every router
      behind the token.
    - `routers/`: one `APIRouter` subclass per kind, each registering its routes in
      `_register_routes`.
    - `security_scheme.py`: the bearer scheme, which puts the client in a `ContextVar` the routes
      read.
    - `exception_handling/`: kinds to statuses.
    - `logging/`: the request middleware, which stamps a transaction id, and the lifespan, which
      holds the startup guard.
    - `run.py`: starts uvicorn.
  - `mcp/proxy.py`: `/mcp`, the streaming reverse proxy, mounted on the FastAPI app. Its way out
    is an injected httpx client, so it needs no port of its own.
- **`ports/tokens/`**: the server's own way out, the token table. `TokenStore` is the port and
  `DatabaseTokenStore` the adapter over the `server_tokens` table (through the bindings'
  `token_call`); the tests' fake is the second adapter. `FileTokenStore` is kept only to read an
  old `<db>.tokens` file once.
- **`ports/pairing/`**: `PairingStore` and `DatabasePairingStore` over `pairing_pins`, through the
  same `token_call`. The rules (PIN, lifetime, attempts, names) are `business_logic/pairing.py`,
  over the two ports and a clock, so they are unit-tested with no database.
- **Configuration and logging:** `config.py` holds the settings (pydantic-settings), and
  `logger.py` sets up loguru.

There is no managers layer: the bindings are the business logic.

The tests are in `crates/arlesh-py/tests/server/`. `unit/` mirrors the source tree, with fakes of
the package's `Database` port and of the hold. `integration/` drives the HTTP surface with
FastAPI's `TestClient` against a temporary database. It covers every route, every error kind's
status and body, auth, the confirmation retry, the hold (a second server refused, a forced start,
the hold released on shutdown), `/mcp`, and a few derived values checked against what the Rust
tests assert for the same input. They run in CI's `python` lane, beside the bindings' own tests,
under the same pytest-cov gate, mypy and ruff.
