# Read-only MCP server hosted by the Arlesh app

An MCP endpoint served over localhost HTTP from inside the running Tauri app, exposing the
backend's reads as five resource-grouped tools built around `load_mindmap`'s whole-graph snapshot.
An agent — Claude Code, Claude Desktop — can then read tasks, goals, flows, habits, domains, KB
entries and scopes without the user transcribing them. Writes are out of scope for this iteration
but the design is shaped so they drop in as additional operations rather than a new architecture.

## Motivation

Arlesh's data is only reachable through its own UI. Any agent asked to help plan a week, audit a
goal tree, or sanity-check a Flow's dependencies has to be told the contents by hand, which is both
tedious and lossy.

The backend is well-positioned for this after ADR-0004. `src-tauri/src/commands/` is a thin
adapter — each command opens a session from the `SessionFactory` and delegates to a stateless
resource operator — so the real logic lives in the domain modules and a second adapter can sit
beside the first without duplicating anything.

## Status

accepted

## Considered options

### How the MCP layer reaches the data

- **Call the `#[tauri::command]` functions.** The literal reading of "wrap the exported commands".
  Rejected: every command takes `State<'_, SessionFactory>`, which cannot be constructed outside a
  Tauri invoke context — `tests/helpers.rs::command_host` has to stand up a whole mock app to get
  one. Reaching a two-line delegation that way is fighting the framework.
- **Extract a service tier that both `commands/` and `mcp/` call.** Rejected as YAGNI: the commands
  hold no logic to share beyond the session-mode choice, which is per-operation and documented at
  each site. The tier would buy an indirection and nothing else.
- **Open sessions from the same `SessionFactory`, as a sibling adapter to `commands/`.** Chosen.
  See below.

### Where the server runs

- **Standalone binary opening `arlesh.db` directly.** Works when the app is closed. Rejected: once
  writes land, two processes share one SQLite file — the pool has no WAL pragma — and the open app
  would not see changes until it refetched.
- **Hosted by the running app.** Chosen. One process, one factory, no concurrency question, and a
  later write path can push live updates into the open UI. The cost is that the agent gets nothing
  while Arlesh is closed.

### Tool granularity

- **One tool per command.** ~33 read tools now, ~85 once writes land. Rejected: MCP clients load
  every tool definition into context, and the agent still has to compose multi-step queries itself.
- **Eight tools grouped per resource, mirroring the read commands one-for-one.** This was the
  approved shape before ADR-0004 landed. Rejected on seeing `load_mindmap`: thirteen of those
  operations are fields of a single existing payload, so the grouped surface would be eight tools
  whose combined output one tool already returns.
- **A `load_mindmap` snapshot plus targeted tools for what it does not cover.** Chosen. Five tools,
  fifteen operations, and the common case — "show me everything" — is one call rather than
  thirteen.

### Whether the snapshot may write

`load_mindmap` writes, despite reading like a query: deriving a Habit's iterations materialises the
scope rows its windows land on, which is why the command opens a transactional session and commits.

- **Exclude it from the server** and rebuild the surface from pure reads. Rejected: it discards the
  single most useful payload on the server to preserve a label.
- **Run it on a session that is deliberately never committed.** Tempting, and it genuinely works —
  sqlx rolls the derived scopes back on drop and the payload still returns complete. Rejected
  because the payload's habit iterations reference those scope ids, so a later
  `arlesh_scopes.resolve` on one returns NotFound. A snapshot containing ids that do not resolve is
  a worse failure than an honest write.
- **Include it, commit, and annotate it `read_only_hint = false`.** Chosen. Its writes create no
  user content — no task, goal or flow — and are confined to materialising scope rows the UI would
  materialise on its next load anyway.

### How much filtering to expose

The backend has no query-level filtering: the list operators are `SELECT * FROM <table> ORDER BY
position ASC` with no `WHERE`. The one exception is the domains operator, which takes an optional
subtype.

Two pieces of filter-adjacent logic are in Rust and reachable: `tasks/lifecycle.rs` derives the
Timing / Resolution / Archival axes the UI filters on, and the flows operator's `valid_targets`
filters candidate targets by flow duration. The `lifecycles` field of `MindmapLoad` carries the
former for every task and goal in the same payload.

What is TypeScript-only is the filter *predicates* — the List presets (`all` / `plan` / `start` /
`do` / `unblock`), pill dimensions, tag modes, archived modes — in `src/utils/filter-tree.ts` and
`src/utils/list-filter.ts`.

- **Port the preset predicates to Rust and expose them as tool filters.** Rejected: two
  implementations of the same rules, guaranteed to drift from the UI.
- **Port to Rust and have the frontend call them.** Rejected for this iteration: one definition and
  the right long-term answer, but it restructures working Phase-3 code otherwise untouched here.
- **Expose the snapshot, whose `lifecycles` field already carries the derivation.** Chosen. An
  agent can answer "what is overdue" from one call. Preset parity is filed as follow-up work
  (`Arlesh-32r`).

## Design

### 1. Module placement

A new `src-tauri/src/mcp/` module, declared in `lib.rs` beside the existing domain modules. It
holds a handler struct owning a cloned `SessionFactory`, with `#[tool_router]` / `#[tool]` methods
that open a session the same way `commands/` does:

```rust
let mut db = self.factory.connect().await?;
db.tasks().get(TaskId(id)).await
```

Reads use `connect()` (pooled). The one operation that writes — the snapshot — uses `begin()` and
commits, exactly as `commands::mindmap::load_mindmap` does.

The two adapters are peers over one session layer, and `commands/` keeps all its behaviour. It
changes in one respect: `ResolvedScope` and the pure `resolve(scope, now)` that builds it moved
down from `commands/scopes.rs` into `scopes::resolve`, because both adapters now return that shape
and neither sits below the other. Nothing else referenced it, and the frontend keeps its own
hand-written interface, so the move has no ripple.

The crate's `#![deny(missing_docs)]` and `#![deny(clippy::all)]` apply, so every `pub` item in the
module is documented. Per `.claude/rules/rust.md`, no `.unwrap()` or `.expect()` in this path.

**Operators must be used inline** (ADR-0004): two cannot be bound simultaneously, and the borrow
error when they are is among Rust's least readable. Each tool body opens its session, calls one
operator inline, and returns.

### 2. Transport and lifecycle

`rmcp`'s `StreamableHttpService` is a tower service. An axum `Router` mounts it at `/mcp`, and
`tauri::async_runtime::spawn` serves it on `127.0.0.1:4747` from the existing `setup` hook in
`lib.rs`, after `app.manage(SessionFactory::new(pool))`. The port is overridable with
`ARLESH_MCP_PORT`.

Two guards:

- Origin validation is enabled with `StreamableHttpServerConfig::enforce_origin_validation()`.
  `allowed_hosts` already defaults to loopback only, so it needs no change; `allowed_origins`
  defaults to *empty*, which disables Origin validation rather than enforcing it. Enforcing with an
  empty allowlist rejects any request carrying an Origin at all — which a browser page always sends
  and an MCP client never does.
- **A bind failure must not take down the app.** If the port is occupied, log at `warn` and let
  Arlesh run without MCP. The existing `setup` hook uses `.expect()` for database bootstrap; that
  precedent is deliberately not followed here, because an occupied port is an ordinary condition
  and losing the whole app to it is the wrong trade.

New dependencies: `rmcp` (features `server`, `macros`, `transport-streamable-http-server`,
`transport-streamable-http-server-session`), `axum`, `schemars`. Exact feature flags are pinned
during implementation against the version that resolves.

### 3. Tool surface

Five tools. Each takes an `operation` discriminant plus that operation's parameters, which mirror
the existing command signatures. All are annotated `read_only_hint = true` except `arlesh_snapshot`.

| Tool | Operations | Notes |
| --- | --- | --- |
| `arlesh_snapshot` | `load(now)` | `MindmapLoad` — domains, goals, tasks, infos, flows, flow goals/tasks/cycles/dependencies, block reasons, task dependencies, flow instance nodes, lifecycles, and per-flow habit iterations and statuses. **Not read-only.** |
| `arlesh_scopes` | `get(id)`, `resolve(id)`, `resolve_many(ids)` | Turns the snapshot's scope ids into dates. |
| `arlesh_kb` | `list_people`, `get_person(id)`, `list_events`, `list_threads` | The one domain the snapshot ignores entirely. |
| `arlesh_tasks` | `get(id)`, `containment_conflicts(node_type, node_id, time_scope)` | `get` returns `TaskWithBlockers` — the task plus explicit *and* virtual block reasons. `containment_conflicts` is a what-if query. |
| `arlesh_flows` | `get(id)`, `recurrence(flow_id)`, `completion_count(flow_id)`, `origins(nodes)` | The flow questions the snapshot does not answer: the stored recurrence config, as opposed to its derived iterations. |

Everything absent from this table is absent because `arlesh_snapshot` already returns it:
`list_tasks`, `list_goals`, `get_goal`, `list_domains`, `get_domain`, `list_infos`, `list_flows`,
`list_flow_goals`, `list_flow_tasks`, `list_all_flow_*`, `list_all_task_dependencies`,
`list_all_block_reasons`, `list_flow_instance_nodes`, `derive_scope_lifecycles`,
`generate_habit_iterations` and `list_habit_item_statuses`.

Every write command is excluded, including `retype_node`, `start_flow`, and the `get_or_create_*`
scope commands.

**`valid_targets` is excluded too, though it reads.** Like the snapshot it writes — resolving a
concrete window mints the canonical scopes it names, which is why the command opens a transaction —
and unlike the snapshot nothing here can act on its answer: it tells you where a flow *could* be
started while `start_flow` remains a write and out of scope. Including it would flag all of
`arlesh_flows` non-read-only to serve a question with no follow-up. It returns alongside
`start_flow`.

**Operation enums must declare their schema type.** The tools take an internally-tagged enum
(`#[serde(tag = "operation")]`), for which `schemars` emits a root `oneOf` and no `"type"`. MCP
requires every `inputSchema` to have root type `object`, and `rmcp` rejects the tool at
registration if it does not — so each enum carries `#[schemars(extend("type" = "object"))]`. The
added keyword is true of every variant; it is a gap in the generated schema, not a reshaping of the
contract.

**`resolve_many` is new.** It is the only operation without a one-to-one backend counterpart: a
loop over the scopes operator's `resolve`, added because `Task.time_scope` carries `start_id` /
`end_id` rather than dates. Without it an agent holding a snapshot must make one round trip per
distinct scope id just to learn when anything is scheduled. It adds no logic beyond the loop.

### 4. Errors and output

Tools return `Json<T>` of the domain models, so the MCP wire representation is the same serde shape
the frontend receives from `invoke()`.

Errors reuse `WireError` rather than re-inventing stringification: each tool maps its domain error
with `WireError::from_error`, and the tool result carries `is_error: true` with the `WireError`
serialised as structured content. That keeps the `kind` discriminant — `not_found`,
`containment_violated`, `invalid_request`, `database`, `internal` — machine-readable for the agent
in the same way it is for the frontend, instead of flattening it to a message string.

### 5. Testing

`src-tauri/tests/mcp.rs`, using `helpers::test_pool()` and `helpers::session_factory()` — the
latter exists precisely for "tests that drive a session themselves rather than through a command".

- Per-tool tests call the handler methods directly against a seeded pool and assert on the returned
  JSON. No HTTP in the test path.
- One test asserts the router lists all five tools, to catch a tool dropped from registration.
- One test asserts an error path maps to the right `WireErrorKind` — a `get` on a missing id
  returning `not_found` rather than a generic failure.
- One test asserts `arlesh_snapshot.load` commits: after the call, the derived scope rows are
  present in the pool. `tests/mindmap_commands.rs` already asserts on rows rather than on the
  result for this reason — a missing commit still returns `Ok`.

**Coverage.** The project's quality gate is `cargo tarpaulin --fail-under 85` excluding
`src/commands/*`. `src/mcp/` is not under that exclusion, so it counts toward the threshold and
needs genuine per-operation tests, not a smoke test.

One caution from `helpers.rs`: the test pool has **one connection**. A test that holds a `Db`
session open and then queries the pool waits out sqlx's 30-second acquire timeout and fails as a
connection timeout rather than an assertion. Commit or drop the session before reading the pool.

An end-to-end HTTP test is deliberately omitted: it would mostly exercise `rmcp`. The real
end-to-end check is connecting a client to a running app.

### 6. Documentation

- `SPEC.md` gets a new top-level "MCP Server" section. It is **not** numbered as a ninth
  implementation phase — the eight phases are feature phases and this is orthogonal to all of them.
- `README.md` documents the connection command:
  `claude mcp add --transport http arlesh http://127.0.0.1:4747/mcp`
- `CHANGELOG.md` gets an `Added` entry describing what an agent can now read, in user-facing terms —
  not the module structure.

## Consequences

- **The agent sees nothing when Arlesh is closed.** This is the accepted cost of hosting in-app, and
  the failure is silent from the client's side — a connection refusal, not an explanatory error.
- **The most useful tool is not read-only.** `arlesh_snapshot` materialises scope rows. The server
  is read-only in the sense that matters — no user content is created or changed — but the label is
  not literally true, and the tool annotation says so rather than hiding it.
- **Any local process can read the user's task database** while the app runs. Localhost binding plus
  host/origin validation stops browser pages and remote callers, not other programs on the machine.
  For a read-only personal task DB this was judged acceptable; a bearer token is the escalation.
- **The snapshot is unbounded.** It returns every task, goal, flow and domain in one payload. On a
  personal database this is fine, and it is the thing most likely to need narrowing first as the
  data grows — at which point a filter argument on `load` is the natural place to put it.
- **Preset semantics remain unavailable to agents.** "What should I start" cannot be answered the
  way the List view answers it. The agent can approximate from raw fields and the lifecycle axes,
  and will not agree with the UI at the edges. `Arlesh-32r` closes this.
- **Writes are additive.** They become new `operation` variants with `read_only_hint` dropped on the
  affected tools. No transport, module or testing change is implied — though a write operation
  touching more than one statement must open `begin()` and commit, and per ADR-0004 a nested
  composite operation must join the caller's session rather than opening its own.
