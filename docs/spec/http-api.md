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

The desktop app will run in one of two modes:

- **Local mode** is the app as it is today. It owns the database, holds it while it runs, and
  serves its own MCP endpoint.
- **Server mode** makes the app a client of `arlesh-server`. The server is then the only writer,
  and it serves its own copy of the MCP. The app serves none.

There is never more than one writer, and there is a single user, so neither mode needs
multi-writer support. Server mode in the app does not exist yet; it is separate work. Until it
does, the **hold** below is the safety net. The server takes the same hold the app takes, so
there is one writer per database: whichever of the app and the server starts second cannot hold
it, and the server refuses to start rather than become a second writer.

## Running

```
pip install 'arlesh[server]'
arlesh-server --db <path> [--host <addr>] [--port N] [--tls-cert F --tls-key F] [--force]
```

It is started by hand on whichever machine holds the database. There is no unit file and no
service manager. The flags can also come from the environment, as `ARLESH_DATABASE__PATH`,
`ARLESH_DATABASE__FORCE`, `ARLESH_SERVER__HOST` and so on (pydantic-settings, nested with `__`).

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
```

Tokens live in `<db>.tokens` beside the database, readable by its owner only (mode 0600). Each is
kept as a SHA-256 digest; a token is 256 random bits, so a slow hash would add nothing. A client has
one token at a time: `add` refuses a client that already holds one, so revoke it first. The file is
read on every request, so a revoke takes effect at once, without a restart.

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
| `GET /board?now=&at_capacity=` | The whole board: every node with its lifecycle, short id and facts |
| `/tasks` | `GET /{id}`, create, `PATCH /{id}?confirmed=&descendant_plans=` (an update; naming a parent and position moves the Task), delete, `PUT /{id}/archived?archived=`, `POST /{id}/plan-containment-conflicts` (the body is the new Plan; writes nothing), `POST /{id}/status?step=`, `/agentic/toggle`, `/dependencies` (`GET`, `POST`, and `DELETE` with the dependency as its body), `/done-at`, `/duplicate`, `/convert-to-flow`, `/spawned-wait` and its check |
| `/goals` | `GET /{id}`, create, `PATCH /{id}?confirmed=`, delete, `/duplicate`, `/convert-to-flow` |
| `/commitments` | `GET /{id}`, create, update, delete, `PUT /{id}/archived?archived=`, `POST /{id}/verdict?press=` |
| `/waits` | create, update, delete, `/check/complete`, `/check/reopen` |
| `/infos`, `/domains` | read, create, update, delete, `/duplicate`; `GET /domains?subtype=` |
| `/flows` | read, create, update, delete, `/start`, `/recurrence`, `/habit-modifications`, `/fork`, `/duplicate`, `/dependencies` |
| `/flow-items` | create and update `flow_goal`, `flow_task`, `flow_commitment` and `flow_expectation` items, delete, `/cycles?reconcile=`, `/dependencies`, `/duplicate` |
| `/nodes/{kind}/{id}` | `/tags/{tag_id}` (`PUT` and `DELETE`), `/block-reasons` |
| `/scopes` | `GET /containing?kind=&date=`, `POST /resolve?now=` (the body is a scope key) |
| `/rules` | `POST /item-state`, `POST /commitment-state`: the derived lifecycles |
| `/mcp` | Arlesh's MCP endpoint (below) |

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
"validation"` and the field errors. An unknown route is 404 `not_found`, and a kind the server
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
- **`ports/tokens/`**: the server's own way out, the token file. `TokenStore` is the port and
  `FileTokenStore` the adapter; the tests' fake is the second adapter.
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
