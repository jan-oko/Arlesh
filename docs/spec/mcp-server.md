# MCP Server

*One area of the [Arlesh design specification](../../SPEC.md).*

Arlesh serves a [Model Context Protocol](https://modelcontextprotocol.io) endpoint while the app is
running, so an agent — Claude Code, Claude Desktop — can read the board without being told its
contents by hand. It is read-only with one deliberate exception: an agent can set an item's `bd`
issue link, and nothing else. It cannot create, rename, complete or delete a Task, Goal, Flow,
Domain or knowledge-base entry.

The endpoint is hosted by the app itself, not a separate process, so there is only ever one writer
to the database and the agent sees exactly what the open window sees. The cost is that it answers
nothing while Arlesh is closed.

**Address.** `http://127.0.0.1:4747/mcp`, overridable with the `ARLESH_MCP_PORT` environment
variable. It binds loopback only and rejects any request carrying an `Origin` header, so a page in
a browser cannot reach it. If the port is already taken the app logs a warning and runs without the
endpoint rather than refusing to start.

**Connecting.** `claude mcp add --transport http arlesh http://127.0.0.1:4747/mcp`

## Tools

Six tools rather than one per backend command, because an MCP client pays context for every tool
definition it loads.

| Tool | Operations |
| --- | --- |
| `arlesh_snapshot` | `load(now, sections?, cursor?)` — the whole planning graph: domains, goals, tasks, **commitments**, notes, flows, flow items, cycles, dependencies, block reasons, materialised instance nodes, every item's derived lifecycle, each flow's habit iterations and statuses, and which occurrence each **added child** hangs on. Paged; see below |
| `arlesh_scopes` | `get(id)`, `resolve(id)`, `resolve_many(ids)` |
| `arlesh_kb` | `list_people`, `get_person(id)`, `list_events`, `list_threads` |
| `arlesh_tasks` | `get(id)`, `containment_conflicts(node, time_scope)` |
| `arlesh_flows` | `get(id)`, `recurrence(flow_id)`, `completion_count(flow_id)`, `origins(nodes)` |
| `arlesh_beads` | `set(node_type, node_id, beads_id)` — the one write; `node_type` is `task`, `goal`, `commitment` or `project`. See below |

`arlesh_snapshot.load` is the entry point and covers the common case. The other reads
exist for what it does not carry: the knowledge base, scope resolution, a task's dependency-derived
block reasons, and a Habit's stored recurrence configuration as opposed to its derived iterations.

A Commitment arrives with its `verdict` (`unresolved` / `kept` / `broken`) and its derived
lifecycle. The verdict is recorded, never inferred, and `unresolved` means the user has not said
rather than "not done" — an agent that reads it as an unfinished task has misread the board.

Tasks, Goals and Commitments carry `time_scope` and `plan` as boundary **scope ids**, not dates, so reading a
snapshot means resolving those ids — `arlesh_scopes.resolve_many` does a batch in one call against
a single reference instant.

## Paging the snapshot

A real board does not fit in one MCP tool result. A board of 141 tasks, 162 domains and 15 habits
serialises to about 122,000 characters, which a client refuses outright — so following the
instruction to "start with the snapshot" returned a truncation error rather than data.

`load` therefore returns as much as fits — about 40,000 characters of items — plus a `next_cursor`.
Call again with that cursor until it comes back null. The example board takes four pages.

The payload's shape is unchanged: the same section names, the same item shapes, and an item is
never split across a boundary, so nothing has to be reassembled from two responses.

Two rules follow from paging, and an agent that gets them wrong misreads the board:

- **A section missing from a page has not been reached yet.** An empty section is sent as `[]`, so
  `[]` always means "none" and absence always means "not yet".
- **`sections` narrows the request** — `["tasks", "lifecycles"]` answers a scheduling question
  without paying for every flow cycle on the board.

Pages are derived independently rather than from a cached payload, so a board edited mid-walk can
produce a cursor that no longer lands anywhere; the server says so and the walk restarts. For one
local user a few seconds apart, that is rarer than the cost of holding server-side state would be
worth.

## Issue links

A Task, Goal, Commitment or Project can carry the id of the `bd` issue tracking it, and `arlesh_beads.set` is
the **only** way that field is ever written: no Tauri command touches the column and the editor
modals render it as text with no control. So an issue id shown in Arlesh always arrived over MCP.
Passing `null` clears the link. Setting one on an item that does not exist is an error rather than
a silent no-op, and only the `project` subtype of Domain accepts a link — an Aspect, Domain or Tag
is refused.

## Scope materialisation

`arlesh_snapshot` is annotated as *not* read-only, and honestly so. Deriving a Habit's iterations
materialises the canonical scope rows its windows land on — the same rows the Mindmap materialises
on its next load — so the snapshot writes those and commits them. It creates no Task, Goal, Flow or
note, and changes nothing the user entered. Running it without committing would make it a pure
read, but the iterations it returns reference the scope ids it mints, so the payload would name ids
that no longer exist.

Every tool other than `arlesh_snapshot` and `arlesh_beads` is annotated `read_only_hint = true`
and writes nothing at all.

## What is deliberately absent

- **Every write command**, including `retype_node`, `start_flow` and the `get_or_create_*` scopes.
- **`valid_targets`** — it reads, but resolving a concrete window mints the scopes it names, and it
  answers "where could this Flow be started?", a question nothing on this surface can act on while
  starting a Flow is a write. It returns alongside `start_flow`.
- **The List view's filter presets** (`all` / `plan` / `start` / `do` / `unblock`) and its pill
  dimensions. These live only in the frontend, so an agent cannot ask "what should I start" the way
  the List view answers it; it can approximate from the snapshot's `lifecycles`, which carry the
  same Timing / Resolution / Archival derivation the UI filters on.

## Errors

A tool that fails returns a result flagged as an error carrying the same structured `WireError` the
frontend receives across the Tauri boundary, including its stable `kind` — `not_found`,
`containment_violated`, `invalid_request`, `database`, `internal` — so an agent branches on the
discriminant rather than parsing a message.
