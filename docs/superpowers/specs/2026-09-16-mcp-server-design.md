# Read-only MCP server hosted by the Arlesh app

An MCP endpoint served over localhost HTTP from inside the running Tauri app, exposing the
backend's read commands as eight resource-grouped tools. An agent — Claude Code, Claude Desktop —
can then read tasks, goals, flows, habits, domains, KB entries and scopes without the user
transcribing them. Writes are out of scope for this iteration but the design is shaped so they
drop in as additional operations rather than a new architecture.

## Motivation

Arlesh's data is only reachable through its own UI. Any agent asked to help plan a week, audit a
goal tree, or sanity-check a Flow's dependencies has to be told the contents by hand, which is both
tedious and lossy.

The backend is already well-positioned for this. `src-tauri/src/commands/` is a thin adapter — every
command is `Repository::new(&pool).method(..).await.map_err(|e| e.to_string())` — so the real logic
lives in the domain modules and a second adapter can sit beside the first without duplicating
anything.

## Status

accepted

## Considered options

### How the MCP layer reaches the data

- **Call the `#[tauri::command]` functions.** The literal reading of "wrap the exported commands".
  Rejected: every command takes `State<'_, DatabasePool>`, which cannot be constructed outside a
  Tauri invoke context. Reaching a one-line pass-through would mean fighting the framework.
- **Extract a service tier that both `commands/` and `mcp/` call.** Rejected as YAGNI: the commands
  hold no logic to share. The tier would buy an indirection and nothing else. It stays available if
  write operations later need shared validation, and promoting to it is mechanical.
- **Call the repositories directly, as a sibling adapter to `commands/`.** Chosen. See below.

### Where the server runs

- **Standalone binary opening `arlesh.db` directly.** Works when the app is closed, and trivial to
  launch over stdio. Rejected: once writes land, two processes share one SQLite file — the pool has
  no WAL pragma today (`database/mod.rs:10`) — and the open app would not see changes until it
  refetched.
- **Hosted by the running app.** Chosen. One process, one pool, no concurrency question, and a
  later write path can push live updates into the open UI. The cost is that the agent gets nothing
  while Arlesh is closed.

### Tool granularity

- **One tool per command.** ~33 tools now, ~80 once writes land. Rejected: MCP clients load every
  tool definition into context, and the agent still has to compose multi-step queries itself.
- **Agent-shaped tools** (`whats_ready`, `task_detail`). Rejected for this iteration: best
  ergonomics, but it requires new query logic and — as the filtering section below records — the
  semantics it would need do not exist in Rust.
- **Grouped by resource, an `operation` enum per tool.** Chosen. Eight tools, compact context
  footprint, direct mapping onto existing commands, and writes later become new enum variants.

### How much filtering to expose

The backend has no query-level filtering: the list queries are `SELECT * FROM <table> ORDER BY
position ASC` with no `WHERE` (`tasks/mod.rs:561`, `:314`, `flows/mod.rs:393`, `:400`, and the KB
and infos equivalents). The one exception is `DomainRepository::list`, which takes an optional
subtype and does `WHERE subtype = ?` (`domains/mod.rs:74`).

Two pieces of filter-adjacent logic *are* in Rust and are exposed as commands:
`tasks/lifecycle.rs` derives the Timing / Resolution / Archival axes that the UI filters on, via
`derive_scope_lifecycles(now)`; and `FlowRepository::valid_targets` (`flows/mod.rs:1524`, exposed as
the `scope_valid_flow_targets` command) filters candidate targets by flow duration.

What is TypeScript-only is the filter *predicates* — the List presets (`all` / `plan` / `start` /
`do` / `unblock`), pill dimensions, tag modes, archived modes — in `src/utils/filter-tree.ts` and
`src/utils/list-filter.ts`.

- **Port the preset predicates to Rust and expose them as tool filters.** Rejected: two
  implementations of the same rules, guaranteed to drift from the UI.
- **Port to Rust and have the frontend call them.** Rejected for this iteration: one definition and
  the right long-term answer, but it restructures working Phase-3 code that is otherwise untouched
  by this work.
- **Expose raw rows plus the lifecycle derivation.** Chosen. The useful half is available — an agent
  can answer "what is overdue" by joining `tasks.list` against `tasks.lifecycles` — and the MCP
  server stays an adapter rather than becoming a reason to restructure the filter layer. Preset
  parity is filed as follow-up work.

## Design

### 1. Module placement

A new `src-tauri/src/mcp/` module, declared in `lib.rs` beside the existing domain modules. It
holds a handler struct owning a cloned `DatabasePool`, with `#[tool_router]` / `#[tool]` methods
that construct repositories the same way `commands/` does:

```rust
TaskRepository::new(&self.pool).list().await
```

`commands/` is not modified. The two adapters are peers over one domain layer.

The crate's `#![deny(missing_docs)]` and `#![deny(clippy::all)]` apply, so every `pub` item in the
module is documented. Per `.claude/rules/rust.md`, no `.unwrap()` or `.expect()` in this path.

### 2. Transport and lifecycle

`rmcp`'s `StreamableHttpService` is a tower service. An axum `Router` mounts it at `/mcp`, and
`tauri::async_runtime::spawn` serves it on `127.0.0.1:4747` from the existing `setup` hook in
`lib.rs`, after `app.manage(pool)`. The port is overridable with `ARLESH_MCP_PORT`.

Two guards:

- `StreamableHttpServerConfig`'s `allowed_hosts` and `allowed_origins` are restricted to localhost.
  This is the SDK's DNS-rebinding protection and it matters concretely: without it a page in the
  user's browser could POST to the port.
- **A bind failure must not take down the app.** If the port is occupied, log at `warn` and let
  Arlesh run without MCP. The existing `setup` hook uses `.expect()` for database bootstrap; that
  precedent is deliberately not followed here, because an occupied port is an ordinary condition
  and losing the whole app to it is the wrong trade.

New dependencies: `rmcp` (features `server`, `macros`, `transport-streamable-http-server`,
`transport-streamable-http-server-session`), `axum`, `schemars`. Exact feature flags are pinned
during implementation against the version that resolves.

### 3. Tool surface

Eight tools, every one annotated `read_only_hint = true`. Each takes an `operation` discriminant
plus that operation's parameters, which mirror the existing command signatures one-for-one.

| Tool | Operations | Backing commands |
| --- | --- | --- |
| `arlesh_tasks` | `list`, `get(id)`, `list_goals`, `get_goal(id)`, `dependencies(task_id)`, `all_dependencies`, `containment_conflicts(node_type, node_id, time_scope)`, `lifecycles(now)` | `list_tasks`, `get_task`, `list_goals`, `get_goal`, `list_task_dependencies`, `list_all_task_dependencies`, `scope_containment_conflicts`, `derive_scope_lifecycles` |
| `arlesh_flows` | `list`, `get(id)`, `goals(flow_id)`, `tasks(flow_id)`, `all_goals`, `all_tasks`, `valid_targets(duration_n, duration_kind, anchor_date, candidates)`, `origins(nodes)`, `instance_nodes`, `all_cycles`, `all_dependencies` | the corresponding `commands::flows` reads |
| `arlesh_habits` | `recurrence(flow_id)`, `iterations(flow_id, now)`, `item_statuses(flow_id)`, `completion_count(flow_id)` | `get_flow_recurrence`, `generate_habit_iterations`, `list_habit_item_statuses`, `habit_completion_count` |
| `arlesh_domains` | `list(subtype?)`, `get(id)` | `list_domains`, `get_domain` |
| `arlesh_kb` | `list_people`, `get_person(id)`, `list_events`, `list_threads` | `commands::knowledge_base` reads |
| `arlesh_scopes` | `get(id)`, `resolve(id)` | `get_scope`, `resolve_scope` |
| `arlesh_infos` | `list` | `list_infos` |
| `arlesh_block_reasons` | `list` | `list_all_block_reasons` |

Habits are split out of flows deliberately. Folded in, `arlesh_flows` would carry fifteen
operations and its schema would be the largest single thing in the agent's context.

Two notes on the surface:

- `generate_habit_iterations` reads despite its name. Its body is pure — it ends at
  `Ok(classify_iterations(..))` (`flows/mod.rs:894`); the `INSERT`/`DELETE` statements nearby belong
  to `set_habit_item_status` and `clear_habit_modifications`. It is safely read-only.
- `lifecycles` is what makes the chosen filtering option worth shipping. Without it the agent sees
  raw rows and has to infer overdue-ness from dates; with it, it gets the same derivation the UI
  renders.

Every `get_or_create_*` scope command is excluded — those write.

### 4. Errors and output

Tools return `Json<T>` of the domain models, so the MCP wire representation is byte-identical to
what the frontend receives from `invoke()` and there is one serde shape to reason about.

Repository errors map to a `CallToolResult` with `is_error: true` carrying `error.to_string()` —
the same stringification `commands/` performs. No new error type is introduced.

### 5. Testing

`src-tauri/tests/mcp.rs`, using the existing `helpers::test_pool()` (in-memory SQLite with
migrations run), matching the other eight integration-test files.

- Per-tool tests call the handler methods directly against a seeded pool and assert on the returned
  JSON. No HTTP in the test path.
- One test asserts the router lists all eight tools, to catch a tool silently dropped from
  registration.

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
- **Any local process can read the user's task database** while the app runs. Localhost binding plus
  host/origin validation stops browser pages and remote callers, not other programs on the machine.
  For a read-only personal task DB this was judged acceptable; a bearer token is the escalation if
  that changes.
- **Lists are unbounded.** `arlesh_tasks.list` returns every task. On a personal database this is
  fine, and it is the thing most likely to need a filter parameter first as the data grows.
- **Preset semantics remain unavailable to agents.** "What should I start" cannot be answered the
  way the List view answers it. The agent can approximate from raw fields and the lifecycle axes,
  and will not agree with the UI at the edges. Porting the predicates to Rust and having the
  frontend consume them is the follow-up that closes this.
- **Writes are additive.** They become new `operation` variants with `read_only_hint` dropped on the
  affected tools. No transport, module or testing change is implied.
