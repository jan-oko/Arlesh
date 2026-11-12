# MCP Server

*One area of the [Arlesh design specification](../../SPEC.md).*

Arlesh serves a [Model Context Protocol](https://modelcontextprotocol.io) endpoint while the app is
running, so an agent — Claude Code, Claude Desktop — can read the board without being told its
contents by hand. It sees only the parts of the board the user has opened to it as **MCP roots**,
and nothing at all until they open one (see *Access* below). It is read-only with one deliberate
exception: an agent can raise an **agentic wait** under an Agentic Task — "the agent is waiting on
you" — and nothing else. It cannot create,
rename, complete or delete a Task, Goal, Flow, Domain or knowledge-base entry.

The endpoint is hosted by the app itself, not a separate process, so there is only ever one writer
to the database and the agent sees exactly what the open window sees. The cost is that it answers
nothing while Arlesh is **not running** — which, since closing the window only hides it to the tray
([Windows & Tray](window-tray.md)), now takes a deliberate Quit rather than a reflexive click on the
close button.

**Address.** `http://127.0.0.1:4747/mcp` by default. It binds loopback only and rejects any
request carrying an `Origin` header, so a page in a browser cannot reach it.

**Port, status and restart** (2026-09-25). The port is a setting on the Settings modal's **MCP**
page, beside the roots. It belongs to the machine rather than the board, so it is saved in
`mcp.json` in the app's data directory, beside the window session (`windows.json`) — not as a row,
which would be journaled and let Ctrl+Z move the listener. The `ARLESH_MCP_PORT` environment
variable, when set to a valid port, still **wins** over the setting; the page says so, naming the
port in force, rather than silently ignoring the field. An unparseable override, or port 0, is
ignored with a warning.

The page shows the listener's **status**: *listening on* its address, or *not listening* on the
port with the operating system's reason — most often that the address is already in use, because
another Arlesh holds the port. A port that cannot be bound never stops the app from starting; it is
recorded as the failed status rather than only logged. **Restart** stops the listener, if any, and
binds again on the current port; **applying a new port** saves it and moves the listener onto it at
once, with no app restart. Each answers with the status it left behind. A client still connected to
the old listener is not cut off, but no new connection reaches it.

**Served from Python** (2026-10-03, `a77`). The same endpoint — the core's own router, the same
tools and rules — can be served by a Python process through the bindings instead of the app:
`await db.serve_mcp(host="127.0.0.1", port=0)` on a database opened for writing answers the port it
bound, and `await db.stop_mcp()` (or closing the database) stops it. It is for the FastAPI server
(`arlesh-server`) in its first form, which proxied `/mcp` to it; the server no longer does (below,
*Spoken by the Python server*), and the binding stays for its own tests and for any host that wants a
listener. It binds a loopback address only and refuses any other. An agent's writes there are journaled as source `mcp` from the
server's client rather than `desktop` (see [Undo](undo.md), *Clients, and a second writer*). The
board-changed announcement is silent, since there are no windows to tell. In local mode the app
serves its own endpoint as before; the app's hold on the database keeps the two from running over
one file.

**Spoken by the Python server** (2026-11-06, Task `688`). `arlesh-server` does not run an MCP
listener per client and proxy to it (that hop timed out in production, and `httpx.ConnectTimeout`
reached the client as a generic internal error). FastAPI speaks the protocol itself and the core
answers it, through four bindings on a database opened for writing: `db.mcp_tools()` (the
`tools/list` array), `await db.mcp_instructions()`, `await db.mcp_initialize(params)` and
`await db.mcp_call(name, arguments)`. The last two answer `{"result": ...}` or
`{"error": {"code", "message", "data"}}`, which Python puts in the request's JSON-RPC envelope; it
reimplements no tool, parameter check, access rule or paging. The calls run on the client's own
write-open, so write attribution, per-device undo and the revision an
agent's write bumps are those of the endpoint above. Settled while building:

- **No connection needed.** `rmcp` builds a tool's request context only inside a running service,
  and no tool reads it. `ArleshMcp::call` borrows the context of one idle service started on an
  in-memory pipe with the handshake skipped (`mcp/detached.rs`) and dispatches through the same
  `ToolRouter` the endpoint uses; so an unknown tool, bad parameters and a tool's result are
  answered by the very code a connected client reaches. Nothing was split out from under the macros.
- **Handshake.** The `initialize` answer is the endpoint's own: the same capabilities, server info
  and instructions (the fixed guide, then the roots, read afresh per call), from the same
  `negotiate_initialize`, so the protocol version is the client's when the SDK knows it and
  otherwise the newest it does.
- **Errors.** An unknown tool is a JSON-RPC error, code `-32602`, message `tool not found`. Bad
  parameters (a missing field, a wrong type) and a tool's own failure are a **result** with
  `isError: true` (the first as text, the second as the `WireError` in `structuredContent`). Both
  are the Rust endpoint's answers, and `tests/test_mcp.py` replays the same calls against that
  endpoint and compares. Python adds only the protocol's own errors: `-32700` (not JSON, HTTP 400),
  `-32600`, `-32601` (unknown method), `-32602` (`tools/call` params of the wrong shape) and
  `-32603` when the core refuses outright; never a bare 500.
- **Methods.** `initialize`, `notifications/initialized` (accepted, `202`), `tools/list`,
  `tools/call` and `ping`; a JSON array is a batch.

**Connecting.** `claude mcp add --transport http Arlesh http://127.0.0.1:4747/mcp` — the server is named `Arlesh` (renamed from `arlesh` on 2026-09-25, so Claude Code's tool prefix is `mcp__Arlesh__`); the tools keep their `arlesh_*` names.

## Access

Settled with the user on 2026-09-24 (`Arlesh-rz0`), replacing a per-node grant model with levels
and holes that was designed the same day and never shipped. The purpose is a cleaner context for
the agent, not security: there are no tokens and no authentication, one set of roots applies to
the whole endpoint, and it stays loopback-only as above.

**The MCP roots.** A setting names the nodes whose subtrees the MCP can see — its **roots**. The
MCP can **read** everything inside a root, however deep, and nothing outside every root. With no
roots it sees nothing: every bulk read answers as though the board were empty, and every request
naming a node is refused. Roots may nest or overlap; a node is visible when any root is at or
above it.

**Write means Agentic.** Inside a root, a Task that reads as **Agentic** — its own flag, or its
nearest flagged ancestor's, by the same rule the app badges (see [*Tasks*](resources.md)) — can be
**written** as well as read. Everything else inside a root is read-only, and only a Task is ever
Agentic, so no Goal, Commitment, Project or Domain is ever writable. The flag is read off the whole
board, so an Agentic Task above a root still makes the Tasks inside it writable.

**Agents create Agentic Tasks** (added by the user to `Arlesh-rz0`, 2026-09-24). Inside a root an
agent may **create** a Task under any visible node that can hold one — a Domain or Project, a Goal,
a Task, a Commitment, or a Habit occurrence — and every Task it creates is created **Agentic**, its
own flag set, so it is writable from then on like any Agentic Task. The one exception is a Task
explicitly marked **Not agentic** (its own setting, not merely inheriting nothing): its subtree is the
user's, and creating under it is refused with `not_permitted`. **Editing is unchanged**: an
existing Task that does not read as Agentic, inherited or explicit, still cannot be written. The
rule is `AccessMap::may_create_task_under` (and `…_under_occurrence`), beside the read and write
checks; `arlesh_tasks.create` applies it (see *Writing tasks* below).

**Private stays private.** A private node is hidden from the MCP even inside a root, together with
its whole subtree — the rule Private Mode applies, and one the roots do not relax. A root that is
itself private, or sits under a private node, therefore opens nothing. This was agreed before the
model was simplified and was not revoked by it.

**Only stored nodes are roots.** A root names a row — a Domain (any of the four domain-table
subtypes), Goal, Task, Commitment, Expectation, Info, Flow or flow item — keyed by its table and its
row id, the way the node's own table keys it. A **derived** row (ADR 0008 — a Habit occurrence, a wait's check
task, a delegated Task's wait, a spawned wait, each an ordinary row of its kind with a UUID id and
an `origin`) is never a root, and is written only where a tool says so (an Agentic occurrence
through `arlesh_tasks`, an agentic derived wait's release through `arlesh_waits`): it is visible exactly when it is not
private and the nearest **stored** row above it is visible, climbing through derived parents (an
occurrence under its iteration's root) to get there. A stored row hung on an occurrence is a stored
row like any other, visible by the roots above the Habit's host its columns name.

**Storage.** The roots are rows of the board (`mcp_roots`), not a per-window preference: the board
is what they describe, and every window and the MCP endpoint read the same list. They are
**journaled**, so adding or removing a root is an ordinary Gesture and **Ctrl+Z reverses it**. A
root belongs to its row: deleting the node drops the root in the same Gesture, and undoing the
delete brings both back — otherwise SQLite reusing the freed row id would open an unrelated node.

**Where the user sets them.** On the *Agents* page of the settings modal (called *MCP access* until 2026-10-01) (see
[*Mindmap*](mindmap-view.md), *Top bar*): the roots are listed with their path and kind, added with
the node search `Ctrl+O` uses, and removed with each row's ×. A root the MCP cannot see because it
is private is flagged as such rather than hidden from the list.

**How the app shows it.** Every node the MCP can see carries an **antenna** in its status-badge row,
wherever the shared badge row is drawn — Mindmap, List View, Steps and Plan View cards — with the
tooltip *Visible to the MCP (via {root})*. It has one state: whether the MCP may also *write* the
node is exactly whether it is Agentic, which the bot-head badge already says. The frontend does not
work visibility out itself; the backend resolves it once (`list_mcp_access`) and the board load
stamps it onto the tree, a derived node taking its nearest stored ancestor's answer.

**How the agent is told.** The instructions the server returns on `initialize` end with the roots
it can see, each by kind, id and short path (at most three segments — `… › ARLESH › Features ›
Search (task 212)`), and the two rules above. They are built per connection, so a root added,
removed or retitled is in the next session's instructions. A private root is not named.

**Enforcement** is a thin layer at each tool's edges (`src-tauri/src/mcp/access.rs`), over the one
resolver in `src-tauri/src/access/`:

- **Bulk reads omit.** `arlesh_snapshot.load` pages, the knowledge-base listings and every result
  that lists nodes leave out what the MCP cannot see, together with every relation that points at
  it: tag ids naming a hidden Tag, dependency edges, lifecycles, block reasons (including the
  derived "Blocked by …" text), checks, spawned waits, flow instance links, occurrence attachments
  and containment conflicts. Nothing says anything was left out. A readable node's **parent
  reference** and a Flow's **target** are kept: they say where the node hangs, and the top of a
  root's subtree always hangs somewhere the MCP cannot see. The snapshot applies the roots
  **after** its `filter`, so a Frozen Project above a root still drops its subtree exactly as the
  user's own view would.
- **A named node outside the roots is refused** with `not_permitted` — `arlesh_tasks.get`,
  `containment_conflicts`, every `arlesh_flows` operation, `arlesh_kb.get_person`. A node that does
  not exist is refused the same way, so the error kind never tells an agent that something exists
  where it cannot look.
- **`arlesh_waits.ask` needs write** on the Task it raises the wait under.
- **`arlesh_infos.create` needs write** on the Task it hangs the note under.
- **`arlesh_tasks` writes** follow the two rules above: `create` needs `may_create_task_under`
  at the parent, and every other write needs a Task that reads as Agentic. See *Writing tasks*.
- **The knowledge base** hangs on no node, so no root contains it. A Person, Event or Thread is
  visible exactly when a node the MCP can see points at it: a Task delegated to the Person, or a
  Task or Goal linking the entity.
- **Scopes** are the calendar, not the board, and carry nothing a root protects; `arlesh_scopes` is
  unaffected.
- **The Flow sections travel with their Flow**: a Flow's derivation outcome (`habits`), cycles and
  intra-flow dependencies are there exactly when the Flow is. Its occurrences are rows of the kind
  sections, filtered like every derived row.


**Sessions and Claims** (2026-11-07, Task `7a0`; see [Agents](agents.md)). The roots above are the
**user's**. An MCP session no longer sees them directly: it starts **unattached**, seeing nothing and
able to call only `arlesh_agents.attach`; every other tool refuses it with `not_permitted`. Once it
attaches (a one-time PIN, or the agent token an earlier attach answered) the session is bound to an
**Agent**, and its view is the Agent's **Claim**: a subtree inside the user's roots, in place of
them. Every rule in this section then applies with the Claim as the one root, so a node outside it is
omitted from bulk reads and refused by name, and the instructions the server returns on `initialize`
name the Agent and its Claim instead of the roots (or, unattached, say how to attach). A paused
Claim reads and writes nothing new. The binding lasts as long as the session and is lost when the
server restarts; the agent attaches again with its token. In-process callers and tests that build a
bare handler still see the user's roots.


## Tools

Ten tools rather than one per backend command, because an MCP client pays context for every tool
definition it loads.

| Tool | Operations |
| --- | --- |
| `arlesh_snapshot` | `load(now?, sections?, cursor?, filter?, agentic?)` — `now` is a local date-time string (`"2026-09-25T09:00:00"`) and defaults to the server's current time; the whole planning graph: domains, goals, tasks, **commitments**, notes, flows, flow items (`flow_goals`, `flow_tasks`, `flow_commitments`, `flow_expectations`), cycles, dependencies, block reasons, materialised instance nodes, every item's derived lifecycle, each flow's habit iterations and statuses, and which occurrence each **added child** hangs on. Paged; see below |
| `arlesh_scopes` | `get(id)`, `resolve(id)`, `resolve_many(ids)` — `id` is a scope's value key, a JSON object such as `{"kind":"week","date":"2026-09-20"}` |
| `arlesh_kb` | `list_people`, `get_person(id)`, `list_events`, `list_threads` |
| `arlesh_tasks` | reads: `get(id)`, `containment_conflicts(node, time_scope)`; writes: `create(parent_type, parent_id, title, brief?, time_scope?, plan?, on_scope_exit?, asynchronous?, dependencies?, tags?, block_reasons?, delegate?)`, `update(id, title?, brief?, backlog?, time_scope?, plan?, on_scope_exit?, asynchronous?, compound?, add_dependencies?, remove_dependencies?, add_tags?, remove_tags?, block_reasons?, delegate?)`, `set_status(id, expected, status)`, `move(id, parent_type, parent_id)`, `archive(id)`, `unarchive(id)`. See *Writing tasks* below |
| `arlesh_flows` | `get(id)`, `recurrence(flow_id)`, `completion_count(flow_id)`, `origins(nodes)` |
| `arlesh_waits` | `raise(task_id, title, note?, question?)`, `ask(task_id, title, note?)`, `raise_review(task_id, title, summary, links?, hand_tests?)`, `release(id, answer?, verdict?)`, `get(id)` — agentic waits under an Agentic Task the MCP can write: a question for the user, a review for their verdict, or a wait on something else, released by the agent (a question only with its answer, a review only with the user's verdict) and polled with `get`; `watch(ids)` and `get_many(ids)` for being notified instead. See *Agentic waits* below, and *Being told a wait resolved* |
| `arlesh_infos` | `create(task_id, body, details?)` — a write: an Info (a note) under an Agentic Task the MCP can write. See *Notes* below |
| `arlesh_agents` | `attach(session_id, pin \| token, name?, account?, subtree?)` — the only call an unattached session may make; `status`, `claim(subtree)`, `pause`, `resume`, `release`, `lock`, `unlock`, `report_usage(windows)` — this session's own identity, Claim and account usage. See [Agents](agents.md) |

**One flat input schema per tool** (2026-09-25). Each tool takes an `operation`-tagged union, and
Claude Code reads a top-level `oneOf` by merging its branches' parameters while keeping
`operation` as the first branch's single `const`, so every other operation existed only in prose.
The served schema is therefore one object: `operation` an **enum** of every operation, every
parameter of every operation declared with its type and required only where every operation
needs it, and one line per operation in the tool's description naming the parameters it takes
(`?` for optional). A missing parameter is refused server-side, naming it. No property carries a
`"default": null`: a parameter left out means **unchanged**, and `null` means **clear** — a client
that filled in null defaults would otherwise clear every field it did not mention. That is how an
`update`'s `brief` fields read: omit a field to keep it, `null` to clear it.

**Every node comes back with its ids**: `id`, `short_id` and `full_id`, on snapshot rows, on
`arlesh_tasks.get` and every task write, on every `arlesh_waits` answer, and on the Info
`arlesh_infos.create` returns. An agentic wait's
fields have one name everywhere — `agentic_note`, `question`, `answer` — in the snapshot and in
every `arlesh_waits` operation, `get` returning the same row.

**Domain-table parents.** Aspect, Project, Domain and Tag are subtypes of one table. A parent
reference to one is stored and reported **one way**, `domain`, whatever its subtype (Task 13c,
migration 0096) — the only spelling the tables' constraints allow. The parent's own subtype is on
its row in `domains`, and it is what the parenting rules read. On input, any of the four subtype
names is accepted for a domain-table parent — they name the same table, so none is wrong — and the
row is written as `domain`. A name of another kind (`goal` for a domain row) is not a domain-table
name and is resolved as that kind.

`arlesh_snapshot.load` is the entry point and covers the common case. The other reads
exist for what it does not carry: the knowledge base, scope resolution, a task's dependency-derived
block reasons, and a Habit's stored recurrence configuration as opposed to its derived iterations —
its repetition and its **clock** (`clock` `window` or `interval`, and a Window's `miss_policy`
`archive`, `overdue` or `owed`; see [*Clocks*](habits.md#clocks)), and a Window Habit's
cooldown (`cooldown_n` `cooldown_kind` units, both null for none; see [*Cooldown*](habits.md#cooldown)).
A Habit iteration's root blocked by that cooldown carries a derived block reason
(`"derived": "cooldown"`, with `until`, the instant it lifts).

A Commitment arrives with its `verdict` (`unresolved` / `kept` / `broken`) and its derived
lifecycle. The verdict is recorded, never inferred, and `unresolved` means the user has not said
rather than "not done" — an agent that reads it as an unfinished task has misread the board.

An Expectation — a wait tasks can depend on — arrives in its own `expectations` section, with its
`status` (`pending` / `released`), its `archival` and its optional `check_every` (a count and a
kind), `check_starting` and `last_check_at`. The section holds **every** wait, stored and derived
alike (ADR 0008, [Derived nodes](virtual-nodes.md)): the wait an `asynchronous` task's completion
spawned (`origin` `{"kind": "spawned_wait", "task_id": …}`) and a delegated task's wait
(`{"kind": "delegation_wait", …}`) are ordinary rows of it, with a UUID `id`, `parent_type` `task`
and their Task as `parent_id`. So is each occurrence of a Flow's **wait item** (`origin`
`{"kind": "habit", …, "item_type": "flow_expectation"}`), released on its own; a **Commitment
item**'s occurrence is a row of `commitments` the same way (`"item_type": "flow_commitment"`), with its
own verdict. The template items themselves arrive in the `flow_commitments` and `flow_expectations`
sections (Task b66): a Commitment item with its `verdict_window`, a wait item with its `check_every`
and `first_check` (`{"kind": "day", "index": 3}` — the start of the third day of each occurrence's
window; `null` is the window's start), each with `id`, `short_id` and `full_id` like every node, and
`tag_ids`. They are read-only here; no MCP write makes or changes one. A derived wait is read **as it is edited**: its title, window, Check
every and Starting, privacy, tags and agent fields are what its template (or its Task) draws them
as, under whatever was written to that one wait in the app — its overlay (`expectation_overlays`)
and its tag differences — exactly as a Habit occurrence reads. Its checks are Task rows in `tasks`
(`origin` `{"kind": "check", …}`) under it, and its lifecycle is in `lifecycles` under its own id,
as a stored wait's is. The task's own `async_template` rides on the task. A spawned wait exists
only while its Task is done; un-completing the Task drops it from the snapshot, and completing it
again brings the same wait back, with everything written to it.

An agent reaches a derived wait as it reaches a stored one: `arlesh_waits.get` reads it by its full
or short id, and `arlesh_waits.release` releases it when it is **agentic** — which a spawned wait
becomes the way any wait does, by the user setting it in the app — and hangs under a Task the agent
can write. The release lands in the wait's own state, never in its template. A delegated task's wait
is released only by its Task being done, so releasing one is refused. `raise` and `ask` create a
stored wait, as before; the MCP writes nothing else to a derived wait.

Tasks, Goals and Commitments carry `time_scope` and `plan` as boundary **scope ids**, and a scope's
id is its value key — `{"kind":"week","date":"2026-09-20"}`, `{"kind":"part_of_day","date":"2026-09-23","part":"morning"}` (see
[*Scopes are derived*](time-scopes.md)) — so the dates are in the snapshot itself and reading it needs no
round trip. `arlesh_scopes` is for what a key does not spell out: `get` adds the label and the
inclusive end date, and `resolve` / `resolve_many` the half-open datetime window (a Day runs
02:00 → 02:00) and whether it is active, all against a single reference instant. None of them
touches the database.

## Reading the snapshot

The tool's own description is kept short, because clients truncate long ones; these are the
details an agent reads the payload by.

- **Occurrences are rows.** A Habit's occurrences are ordinary rows of their kinds, in `tasks`,
  `goals` and `commitments`. Every node carries an `origin`: `{"kind": "manual"}` for a stored one,
  `{"kind": "habit", "habit_id": …, "iteration_scope": …}` for a Habit's, whose `id` is then a
  UUID string rather than a number. A node hung on an occurrence names it as its `parent_id`.
- **Scope keys.** `time_scope` and `plan` are boundary scope ids, and a scope id is its value key:
  `{"kind":"week","date":"2026-09-20"}` is the week whose Sunday is the 20th;
  `{"kind":"part_of_day","date":"2026-09-23","part":"morning"}`,
  `{"kind":"exact","start":…,"end":…}`. The dates are right there; `arlesh_scopes` adds labels,
  end dates and datetime windows.
- **Own and effective Plan** (Task `065b`, see [*Plan inheritance*](time-scopes.md#plan-inheritance)).
  A Task's `plan` is its **own**. Every Task row in the snapshot, and the Task `arlesh_tasks.get`
  returns, also carries `effective_plan`: the Plan it reads, its own or the one it inherits from
  the nearest planned node above it, clipped to its Time Scope. It is `null` when it reads none.
  An inherited one names its source by short id in `plan_inherited_from`. A Task breaking a plan
  rule carries `plan_conflict`: `parent_plan` when its own Plan leaves the one it inherits, `empty`
  when the Plan above it does not meet its window. The Start filter reads `effective_plan`'s
  position.
- **Commitments** carry a `verdict`, `unresolved`/`kept`/`broken`, recorded and never inferred:
  `unresolved` means the user has not said, not "not done".
- **Expectations** are waits: `pending` blocks the tasks depending on it, `released` frees them. A
  `check_every` schedules check tasks beneath it (`origin` `{"kind": "check", …}`). An
  `asynchronous` task's spawned wait (`{"kind": "spawned_wait", …}`) and a delegated task's wait
  (`{"kind": "delegation_wait", …}`) are expectations too. An agentic wait carries `agentic_note`,
  `question`, `answer` and, on a review, `review` (see *Agentic waits*).
- **Delegation.** A task's `delegate_to` is `null` or `{"kind": "person", "id": N}` (read the
  Person with `arlesh_kb`), independent of `agentic`; `arlesh_tasks` writes it (`delegate`, see
  *Writing tasks*). There is no Agent delegate (removed 2026-10-01): an agent holds a Task as
  `on_agent`. A delegated Task is not archived: the filter's `delegated` pill decides where it
  shows.
- **Statuses.** A task's `status` names its model and its value: `{"kind": "ordinary", "status":
  "todo" | "in_progress" | "started" | "done"}`, or — for a Task that reads as Agentic —
  `{"kind": "agentic", "status": "todo" | "on_agent" | "review" | "doing" | "done"}`. `review` is
  derived on every read: an `on_agent` Task with a pending agentic **question** beneath it reads
  `review`, and reads `on_agent` again once the question is released. The snapshot, `get` and
  every write's echo all report it so.
- **Parents.** A node under a domain-table row names its parent `project` (a Project) or `domain`
  (any other subtype), derived from the parent row; its subtype is on that row in `domains`.

## Filtering a read

`load` takes an optional `filter`, and it is the **same** filter the top bar sets, answered by the
same definition — not an approximation assembled from `lifecycles`. `{"preset": "start"}` answers "what can I begin now?" by the rules the
user's own view applies: Plan minus windows that have lapsed or have not begun yet (a wait still
ahead taking its check tasks with it), minus in-progress tasks with nothing left under
them to start, minus Habit flows, minus blocked subtrees, minus Tasks whose Plan has not begun
yet (see [*Mindmap*](mindmap-view.md)). `all`, `plan`, `start`, `do` and
`backlog` are the presets; `unblock` rides beside them as a flag rather than replacing one, exactly
as the List View stores it — beside them in shape, but not in effect: while the flag is set the
list's rows are the blocked ones and the preset does not answer for them (see
[*List View*](list-view.md)). The Archived, Backlog and Delegated pills (`archived`, `backlog`,
`delegated`: `inactive`, `include` or `exclude` — a delegated Task is not archived; see
[*Filtering Logic*](filtering-logic.md#delegated-pill)), the tag filters, the Info/Flow toggles
and Private Mode are all carried too, and so is the Plan preset's **scope narrowing** —
`plan_scope`, a scope key, and `scope_match`, `contained` (the default) or `overlapping`, the
app-wide setting the UI fills in (see [*Mindmap*](mindmap-view.md)) — and `start_hides_checked_waits`,
whether **Start** hides a pending wait that has a Check every (`false`, the default, shows it; the
UI fills it in from its app-wide setting, see [*Expectations*](resources.md)) — each defaulting to what the
app's own filter defaults to —
so `{"preset": "all"}` is the app's neutral filter, where omitting `filter` entirely applies no
filter at all. "Everything, unfiltered" and "everything the neutral filter shows" are different
requests, and the presence of the field is what tells them apart. Private nodes are the exception:
the MCP never sees them whatever the filter says, Private Mode included (see *Access* above), so
the filter's Private toggle changes nothing an agent can see.

The rules live in `src-tauri/src/filters/`. The frontend does **not** call into them: its filter
pass is synchronous and runs per render, and a Tauri round trip in front of every selection move
would be a regression. What holds the two evaluators together is `conformance/preset-filters.json`
— a corpus of boards, filters and verdicts, written from this specification and generated by
neither side, which the Rust tests and the frontend tests both replay. A rule changed in one
language and not the other fails the other language's build.

A filtered read narrows the **real-node** sections — domains, goals, tasks, commitments, infos —
and cuts the sections derived from them (lifecycles, block reasons, dependencies) to match, so
nothing in the payload names a node the payload no longer carries. The **flow** sections are never
narrowed: a Flow's subtree and a Habit's occurrences are assembled from several rows rather than
being rows, so there is nothing there for a preset to judge, and inventing a thinner Flow node to
judge would be the second definition this exists to avoid.


**The List View's own questions** ride in the same filter (Task 122, phase 4, 2026-10-03). `kinds`
is the kind selector — `task`, `commitment`, `expectation`, every kind when omitted — and `pills`
holds the List View's pill dimensions, each a list of `{value, mode}` with `mode` `any`, `all` or
`exclude`, combined as the tag filters are: `antecedent` (Under: node ids, matched against every
ancestor), `dependency` (Depends on: node ids, a Task's own dependency targets, met or not),
`task_status`, `goal_status` and `project_status` (the Task's own, its nearest Goal's and its
nearest Project's), `verdict` (a Commitment's; an unrecorded one reads `unresolved`),
`scope_state` (`unscoped`, `active`, `overdue`, `lapsed`, `planned`, `unplanned`), and the yes/no
flags `blocked`, `agentic`, `asynchronous` and `private`, which combine as one group (an Any among
them is an Any across them). A node id here is spelled as the board keys it — `task-12`, `goal-3`,
`domain-1`, `expectation-4`. A Commitment answers only Under, Scope, Private and Verdict, and a wait
only Under, Scope and Private: a dimension that does not apply to a kind passes it rather than
failing it. A filter that sets either asks a question only a list of rows can answer, so the read is
narrowed as the List View narrows it: to the Task, Commitment and Expectation rows that pass —
preset, Unblock or the Expectations option, tags, toggles and pills, each by the List View's rule
(see [*List View*](list-view.md)) — together with every ancestor of one, the chain the row hangs
from. Notes and Flows are not rows, and drop. Without a pill and with every kind, the read is
narrowed as the Mindmap narrows it, as above. The rules are `crate::filters::pills`, held to the
frontend's by the same conformance corpus.

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

A third follows from filtering: **pass the same `filter` on every page**. The boundaries a cursor
names are boundaries in the *filtered* payload, so changing the filter partway through a walk is no
different from the board changing underfoot.

Pages are derived independently rather than from a cached payload, so a board edited mid-walk can
produce a cursor that no longer lands anywhere; the server says so and the walk restarts. For one
local user a few seconds apart, that is rarer than the cost of holding server-side state would be
worth.

## Agentic tasks

An **Agentic** Task (see [*Tasks*](resources.md)) carries its **brief** in the snapshot's task rows as
`agentic_brief` — `priority` (`"MW"`, `"A"`, `"B"` or `"C"`, most urgent first, or null), `spec`, `design`, `acceptance`, `notes` — or
null when it has none. It is what an agent reads in place of `bd show`, and the server's
instructions say so. A Task that reads as Agentic **cannot be claimed without a Spec**; the write
tools change a status through the same rule, so an agent asking to claim one gets the same refusal
the app gives.

**Its status is a model of its own** (Task 68f, 2026-10-01; see [*Agentic statuses*](resources.md#agentic-statuses)):
`todo` (ready to claim) → `on_agent` (the agent holds it) → `done`, with `review` — `on_agent` and
a question of the agent's open — derived, and `doing` meaning the **user** is on it. The work
cycle an agent follows: claim it (`set_status` `todo` → `on_agent`), work, and to hand anything to
the user raise a question (`arlesh_waits.ask`: a spec question) or, for finished work, a review
(`arlesh_waits.raise_review`: a summary, links, hand tests); the Task reads `review` until the user
answers, then `on_agent` again, and the agent reads the answer — or `approved` /
`changes_requested` with the user's note — with `arlesh_waits.get`. A wait on something non-human (`question: false`, CI)
leaves it `on_agent`. Finish with `done`, or hand it back unstarted with `todo`. The `start` preset
still offers `todo` Agentic Tasks to claim; an agent at capacity blocks every one of its Claim not `done`.

**Asking for them.** `load` takes an `agentic` query beside `filter` (added to `Arlesh-rz0`,
2026-09-24): `{}` narrows the board to the Tasks that **read as Agentic** — their own flag or their
nearest flagged ancestor's, by the one resolver the app and the write rules share, stored rows and
Habit occurrences alike — and `{"max_priority": "A"}` to those at A or more urgent (MW and A), a Task with no
priority then left out. The rows each match hangs from come along for context, as do the waits and
notes directly under a match; everything else goes, the Flow sections whole. The `tasks` section
comes most urgent first (no priority last), context rows after, and every task row carries
`reads_agentic` — `true` for a match, `false` for a context row. It is the MCP's own narrowing,
applied after the roots and after `filter`, and deliberately **not** a field of the shared
`BoardFilter`: it ranks by priority and keeps the waits and notes under a match, which no List View
pill does, so the conformance corpus is untouched. (The List View's own Agentic pill is in the
filter, as `pills.agentic`; see *Filtering a read*.)

## Writing tasks

`arlesh_tasks` carries the agent's task writes (`Arlesh-rz0`, 2026-09-24): `create`, `update`,
`set_status`, `move` and `archive` (Habit occurrences only). Nothing is ever deleted.

- **`create`** makes a Task under a parent the MCP can see that can hold one — a Domain or
  Project, a Goal, a Task, a Commitment, or a Habit occurrence — except under a Task explicitly
  marked **Not agentic**. The new Task is **always Agentic**, its own flag set, and may carry its
  brief from the start.
- **`update`** changes a Task's title, its brief — each brief field given replaces that field, the
  rest stay — and whether it is set aside in the **Backlog**.
- **`create` and `update` carry the rest of the Task** (2026-09-26), so an agent can keep its work
  in Arlesh as it would in `bd`: its **Time Scope**, **Plan** and **due** (`due_scope`; scope ids,
  the shape `containment_conflicts` takes; the due within the Time Scope, added 2026-09-30),
  `on_scope_exit` (`keep` — **Keep Overdue** — or `archive`), `asynchronous`, its
  explicit **block reasons** (the ordered list, replaced whole), its **tags** (by Tag id) and its
  **prerequisites** — the Tasks, Goals or waits it comes after. "X after Y" is X depending on Y.
  `create` takes `dependencies` and `tags` as lists; `update` takes `add_dependencies` /
  `remove_dependencies` and `add_tags` / `remove_tags`, removals applied first. On `update` a
  field left out is unchanged and `null` clears it (`time_scope`, `plan`, `due_scope`,
  `block_reasons`). A Habit occurrence's `on_scope_exit` is its Habit's and is refused; its
  `due_scope` may be set, landing in its overlay and winning over the due its Habit's clock
  derives (see [*Clocks*](habits.md#clocks)). Each lifecycle entry in the snapshot carries `overdue: true` when the item is
  flagged Overdue; `resolution` is only ever `completed` or `missed`.
  Each goes through the same backend write the app's own command uses (`nodes::write` —
  `update_task`, `add_dependency`, `remove_dependency`, `set_tag`, `set_block_reasons`), so its
  rules are the app's: a Plan outside the Time Scope or outside the Plan it inherits, a window
  outside an ancestor's, or a write that leaves any Task with no Plan inside its window (naming the
  Tasks) is `containment_violated` — there is no clamp prompt over the MCP, so a Plan the Tasks below
  would fall outside of is refused rather than clamped — a backlogged Task given a Plan leaves the Backlog, a Task set aside while
  planned is `needs_confirmation` (resend with `plan: null`), and a dependency that would close a
  cycle — a Task after itself included — is `invalid_request` with the app's reason. The Task must
  be writable; a **prerequisite or Tag need only be visible** (inside the roots, not private), and
  one that is not is `not_permitted`. A prerequisite id is matched among Tasks, Goals and waits
  together, a Tag id among domain-table rows, so a row id shared by two visible nodes of those kinds
  is `ambiguous_id`.
  **One transaction**: every id is read before anything is written, the row is written, then its
  relations; a refusal anywhere writes none of it, and a success announces one board change. Not
  exposed: the Agentic flag (what an agent creates is always Agentic, and it cannot un-flag
  anything), `is_private` and an Asynchronous Task's wait
  template. On a **Habit occurrence** each lands in its overlay; its Time Scope is its
  iteration's and a change is refused, and `on_scope_exit` — its Habit's to decide — is refused
  as `invalid_request` before anything is written.
- **Delegation** (2026-10-01). `create` and `update` take **`delegate`**, in the snapshot's own
  `delegate_to` shape: `{"kind": "person", "id": N}`, or — on `update` —
  `null` to take the delegation back (left out, it is unchanged). It is written through the app's
  own `update_task`, under the ordinary access rule (a Task that reads as Agentic, or one the agent
  is creating), in the same transaction as the rest of the call; `create` writes the row and then
  its delegate. Its refusals: a Person id that names no Person is **`not_found`**, checked before
  anything is written (any existing Person will do — visibility does not apply, since a Person is
  visible exactly when a visible Task is delegated to them, which this write makes so); a wait's
  **check task** is refused as the app refuses it ("a check on a wait is yours to make, and cannot
  be delegated", `invalid_request`); a **Habit occurrence** takes a delegate of its own into its
  overlay, as an edit to one occurrence does, so it is not refused. A Task the agent may not
  write is `not_permitted`. The **delegation wait** a delegated Task carries is named on the MCP
  as the app draws it — `"<name> finish: <title>"` — in the
  snapshot's `expectations` and in `arlesh_waits.get`, while its title is still its Task's.
- **`compound`** on `update` switches a Task's **Compound** (see
  [*Compound*](resources.md#compound)): `true` makes its status derived from its sub-items,
  `false` switches that off and keeps the status it showed, in the same write. A Habit occurrence
  cannot be made compound (`invalid_request`). The Task an update returns, and `get`, carry the
  derived status, as the snapshot does.
- **`set_status`** on a compound Task is refused as `invalid_request` — its status follows its
  sub-items; change them, or switch compound off.
- **`set_status` `done`** is refused as `invalid_request` while a counted sub-item of the Task is not
  Done — a Backlogged child, a pending wait or an Unresolved Commitment included — with the number
  open (see [*A parent reads what its sub-items say*](resources.md#parent-status)). An Agentic
  Task's status is **not derived** from its sub-items, but this rule holds for it: complete or
  archive what is left first. A Compound Task that reads as Agentic shows On Agent or Review as its
  items say ([*Compound with Agentic items*](resources.md#compound-agentic)).
- **`set_status`** is a **compare-and-set**: it names the status the agent last saw (`expected`)
  and the one to set. The session holds SQLite's single writer lock from before the compare until
  the write commits, so the two are one step: if the Task's status is no longer `expected`, the
  call is refused as `status_changed`, naming the current status in `details.current`, and nothing
  is written. Two agents both expecting `todo` cannot both win. The MCP writes only Agentic Tasks,
  so both `expected` and `status` are the **Agentic** vocabulary, a param type of its own
  (`AgenticStatusParam`): `todo`, `on_agent`, `review`, `doing`, `done` — no `in_progress`, no
  `started`. `expected` may name any of them, `review` included: it is compared with the status the
  board reads, derived Review and all, so an agent expecting `on_agent` while its question is open
  is refused as `status_changed` with `details.current` `review`. `status` may be **`on_agent`** —
  claiming the Task, from `todo` only, which needs a Spec as in the app — **`todo`** or **`done`**;
  `doing` (the user's) and `review` (derived: raise a question instead) are refused as
  `invalid_request`, and so is a claim from anything but `todo`.
- **`move`** re-parents a Task. It needs write on the Task and create permission at **both** its
  old and its new parent, so a Task can leave a subtree only for one it could have been made in.
- **`archive`** never deletes. On a **stored** Task it is the app's hand archive (Task 269,
  2026-10-03): the Task's stored Archival becomes `archived`, and it and everything beneath it
  read as archived until it is unarchived (see [*Archive*](resources.md#archive)) — one write, and
  the snapshot then carries `archival: "archived"` on it. On a **Habit occurrence** it archives as
  the app archives one — tombstoned in its overlay, still on the board, and a status brings it
  back.
- **`unarchive`** makes a stored Task archived by hand Live again; its subtree comes back as it
  was. It is refused as `invalid_request` on a Task that is not archived by hand (a backlogged one
  included) and on a Habit occurrence, which a status brings back. The MCP writes only Agentic
  Tasks, so it neither archives nor unarchives a Commitment.

Every write but `create` needs a Task that reads as **Agentic**, stored or derived — resolved by
the one resolver the app uses. A write to a **Habit occurrence** lands in its overlay, exactly as
the user's own edit would, and the template is untouched; an occurrence cannot `move` (its Habit
decides where it hangs). A write the rules refuse is `not_permitted`, and writes nothing.

**Undo.** MCP writes are not undoable from the app, deliberately: each is journaled under the `mcp`
source, as `arlesh_waits` is, so it never enters the user's Undo Stack, is not a
Gesture of its own, and never lands inside a Gesture the user has open — Ctrl+Z after an agent's
write undoes the user's last action, not the agent's. The journal still records the write, and
every open window is told the board changed.

A known edge, left as it is: moving a stored wait onto a Habit occurrence **in the app** and making
it agentic in the same write checks the agentic rule against its old parent. The MCP never moves or
flags a wait, so it cannot reach it.

## Short ids

**Every node id is a string** (settled with the user on 2026-09-25). Each tool parameter naming a
node is typed `string`; a JSON number is accepted too and read as its decimal string. Nothing is
stored for ids. A node's **full id** is a UUID-v5 in the one namespace every derived row's id
already lives in: a derived row keeps the UUID it has, and a stored row's is the UUID-v5 of
`{kind}:{row id}` — deterministic, so it never needs keeping.

**Resolving.** A string is matched against everything the MCP can see, two ways at once, and the
matches are pooled: (a) any node whose **row id** in decimal equals the string exactly, and (b) any
node whose **full id** starts with it — 3 characters or more, hyphens optional. An exact full id
wins outright. Only nodes of the kind the parameter names count (a `task_id` counts Tasks); when
none does but a node of another kind would, the refusal says which. One match is that node.
**None** is `not_permitted`, as any node outside the roots. **Several** — row 269 and a Task whose
full id starts `269`, say — are refused as `ambiguous_id`, with `details.candidates` listing each:
its current unique short id, its full id, its kind, its title and a short path such as
`Growth › CODE › ARLESH`, the form the instructions name roots in. Only nodes the MCP can see are
matched, listed or counted, so a hidden node never makes an id ambiguous and is never named.

**Short ids.** A node's **short id** is the shortest prefix of its full id's hex digits, **three
at least**, that no other visible node's full id shares **and** that is not any visible node's row
id in decimal — so a short id can never be taken for a row id. It is worked out at each read from a
sorted list over **everything inside the roots**, never over one page, filter or query result, so a
node goes by the same short id in every view. It may be all digits (`269`); the row-id check
lengthens one only when it collides, which on a board of a few hundred nodes is rare. Every node
the MCP returns carries `id`, `short_id` and `full_id`.

The trade-off, accepted with the user: a short id is unique **now**, not forever — a prefix an
agent saw earlier can become ambiguous as nodes are added. It is then refused and the candidates
listed, never read as the wrong node. An agent that needs an id to stay good holds the full one.

## Agentic waits

`arlesh_waits` is how an agent waits — the replacement for `bd human`. Every operation takes ids as
row ids or short ids.

- **`raise(task_id, title, note?, question?)`** creates an Expectation with `agentic: true`
  directly under the Agentic Task the agent is working, titled with what it waits for and with the
  question or context in `agentic_note`. `question` (default `true`) says it is **waiting on the
  user**; `false` says it waits on something non-human, like CI. **`ask`** is `raise` as a
  question, kept as the short form.
- **`raise_review(task_id, title, summary, links?, hand_tests?)`** hands finished work back for a
  verdict: an agentic wait with `question: true` and a `review` object. `summary` (what changed)
  is the wait's `agentic_note`; `links` is a list of `{label, url}` (a PR, a doc, a build; a PR
  link makes the user's approval their word to merge it); `hand_tests` is a list of strings, one
  per thing the user can try by hand. The Task reads `review` until the user answers.
- **`release(id, answer?, verdict?)`** releases an agentic wait under a Task the agent can write. A
  **question** wait needs a non-blank `answer` — one the agent got from the user in its own
  session — and is refused (`invalid_request`) without one, writing nothing. A **review** needs
  `verdict`, `approved` or `changes_requested`, with the user's note as `answer` (optional): what
  an agent releasing a review itself must supply is the verdict the user gave it in its own
  session, never one of its own — an agent has no business approving its own work. A `verdict` on
  a wait that is not a review is refused. A wait that is neither needs nothing. A wait that is not
  agentic is refused as `not_permitted`.
- **`get(id)`** returns one visible wait's `status`, `question`, `note` and `answer` (with its
  short and full id), so an agent can poll for the user's answer without loading the snapshot. A
  **review** also carries `review: {links, hand_tests, verdict?}`: its presence is the kind (a
  review when `review` is present, a question when `question` is true without it, a wait on
  something else when `question` is false), and `verdict` appears once the user has answered.

`raise` and `release` need **write** access to the Task: an Agentic Task inside an MCP root, or the
call is refused as `not_permitted`. Like every MCP write they are transactional and journaled as the
**agent's** write, so they never enter the user's Undo Stack, and every open window is told.

**A question or a review is how an agent hands a Task to the user.** A pending question or review
under an `on_agent` Task makes it read `review` (see *Agentic tasks*); a wait with `question: false`
does not. The user answers in the app **on the Task** — the Review card or row, or the Task editor —
which stores the **answer** (a review: the **verdict** and the note) and releases the wait in one
write, and the Task reads `on_agent` again whichever the verdict; the app refuses a release without
an answer (a review: without a verdict), from every release path. The agent reads the reply with
`get`, or off the snapshot's `expectations`, which carry `question`, `answer` and, for a review,
`review.verdict`. After `approved` the agent merges the PR and sets the Task `done`; after
`changes_requested` it fixes what the note says and raises a new review. **The app draws no agentic
wait** — not in the Mindmap, List, Start, Do or Zen — so it exists for agents alone; a filtered
snapshot keeps an agentic wait whenever it keeps the Task it hangs under. A wait blocks nothing
unless a Task depends on it.

## Being told a wait resolved

An agent that raised a wait is **told** when it changes, instead of polling `get`. The decision and
its reasons are in [ADR 0013](../adr/0013-notifying-agents-when-a-wait-resolves.md); this is the
server's side. The notifier itself is the `arlesh-notify` Claude Code mod (`plugins/arlesh-notify/`),
which an agent's session may or may not have.

**Two event routes**, on the MCP endpoint's own origin (beside `/mcp` in Standalone) or behind the
client's bearer token on `arlesh-server`. In Standalone they share the endpoint's rules: a loopback
`Host` only, and any request carrying an `Origin` refused. Only `/events/changes` is a
Server-Sent Events stream; the wait route is a long poll (the Server-Sent Events form was dropped
on 2026-11-06, Task `688`: only its own tests followed it, the mod long-polls).

- `GET /events/changes`: `board-changed` with the board's revision after every committed write.
  Today's live-sync stream under its new name (see [HTTP API](http-api.md), *Live sync*).
- `GET /events/expectations?after=<revision>&epoch=<epoch>&wait=<seconds>[&agentic=true]`: the
  changes to the waits inside the asking agent's Claim (it needs the agent's token in
  `X-Arlesh-Agent-Token`, and is refused `401` without one; see [Agents](agents.md)), as **one JSON answer** (the mod's `$.http.fetch` resolves
  only once the body is read); `agentic=true` keeps only the agentic ones. It answers
  `{"revision", "epoch", "changes": [...]}` as soon as a change stamped after `after` exists, else
  with no changes once `wait` seconds have passed (25 by default, 30 at most; `wait=0` answers at
  once). Each change is `{"change", "wait_id", "short_id", "task_id", "task_short_id", "status",
  "archived", "question", "deleted", "revision", "epoch"}`, where `change` is `created`,
  `released`, `reopened`, `archived`, `unarchived` or `deleted` (deleted, or no longer inside the
  roots: indistinguishable by design, as `not_permitted` is). A status change comes before an
  archival change. **An edit to a pending wait's title or note is no change.** The client polls
  again with the `revision` it got, one request at a time. With `after` missing or 0, an `epoch`
  that is not this run's, or an `after` the server's short log (the last 1000 changes) no longer
  reaches, it answers `{"revision", "epoch", "changes": [], "reset": true}` at once: read the waits
  (`get_many`), then poll from that `revision`. The server keeps the log lazily, per filter, and
  only once a poll asks. In `arlesh-server` the route is FastAPI's own (`ExpectationsRouter`,
  behind the bearer token), and the core computes the answer through
  `db.expectations_poll(agentic, after, epoch, wait)`.

The app reads the waits again every 2 seconds as well as on each agent write, since a window's own
writes do not announce to the endpoint; `arlesh-server` hears of every write and does not poll.

**Two operations on `arlesh_waits`:**

- **`watch(ids)`** starts watching waits: it checks that each id names an agentic wait the MCP can
  see and answers each one's current state (`wait_id`, `short_id`, `task_id`, `task_short_id`,
  `status`, `archived`, `question`). It writes nothing. An id that names no visible wait, or a wait
  that is not agentic, is refused. Whether anyone is *notified* depends on the session, not the
  server: the instructions say so, and the mod picks the ids off the result.
- **`get_many(ids)`** reads several waits at once. An id that no visible wait answers to comes back
  `gone: true` instead of failing.

**What the instructions tell an agent** is protocol only, and says nothing about whether a mod is
present: what `watch` does, and "if your session says Arlesh notifications are on, rely on them;
otherwise don't wait on a wait". Whether they are on is the mod's own line at SessionStart.

## Notes

`arlesh_infos.create(task_id, body, details?)` hangs a new **Info** directly under an Agentic Task
the agent can write — for instance the full wording of a Task whose title the agent shortened
with `arlesh_tasks.update`. `body` is the Info's one-line text, its title, and `details` the
optional longer text beneath it; a blank `body` is refused as `invalid_request`. The Info is
placed last among the Task's children and is not private. It comes back as the snapshot's `infos`
carry it, with its `id`, `short_id` and `full_id`. The Task may be a Habit occurrence, in which
case the Info hangs on that one occurrence, as the user's own would.

It needs **write** access to the Task — an Agentic Task inside an MCP root — or is refused as
`not_permitted`, writing nothing; a private Task is not visible, so it is refused the same way.
Like the other writes it is transactional and journaled as the **agent's** write, so it never
enters the user's Undo Stack, and every open window is told the board changed.

Creating is the whole surface: an agent neither edits, moves nor deletes an Info.

## Issue links

*Removed* (ruled by the user, 2026-10-01, Task 661). A Task, Goal, Commitment or Project could carry
the id of the `bd` issue tracking it, set only through an `arlesh_beads` tool. bd is retired — work is
tracked on the Arlesh board — so the tool, the field and its column are gone; the ids that were set
are kept in the `retired_beads_ids` table (resources.md, *Beads id*).

## Agent capacity

Ruled with the user on 2026-09-30 and revised on 2026-10-01 (`cdd`): "it essentially acts like a
dependency of agentic tasks. When it's on, these tasks are derived blocked. The rest of the logic
should follow." Revised on 2026-11-07 (Task `7a0`): capacity belongs to an **agent and its
account**, and on 2026-11-08 the **app-wide lock was removed** — the `agent-capacity.json` file, the
`arlesh_capacity` tool, `GET`/`PUT /capacity`, the `agent_capacity` and `set_agent_capacity`
commands, the `agent-capacity-changed` event, the Settings switch and the `at_capacity` parameter
of the board load. A client that still calls `arlesh_capacity` is answered `tool not found`.

An agent is **at capacity** while it is locked by hand, its account is locked by hand, or a limit
window of its account sits at 100% before its reset. The windows are reported with
`arlesh_agents.report_usage` and kept per account; the state is derived from the reports and `now`
on every load, so it lifts at the reset by itself. An agent that cannot take on more work locks
itself with `arlesh_agents.lock` and clears it with `unlock`; the user locks an agent or an account
in Settings → Agents. See [Agents](agents.md).

**What it does.** Every **Agentic Task not yet Done** — To Do, Started or In Progress; its own flag
or inherited, by the rule the board is drawn by — inside the **active Claim of an agent at
capacity** is **blocked**, with the derived reason **Agents at capacity**. Other agents' Tasks and
the Tasks outside every Claim are not. Everything blocked already does follows, here and in the
app alike: the snapshot's `block_reasons` section carries the reason (marked
`"derived": "agent_capacity"`), `arlesh_tasks.get` lists it among the task's block reasons, Start
drops the task with its subtree, Unblock lists it, and the app shows the stop-sign and refuses to
start it. **Agentic waits** are not Tasks and are never blocked by it. A paused, shadowed or
unreachable Claim blocks nothing. See [*Tasks*](resources.md), *Blockers*.

**One derivation.** `capacity::blocks` runs **inside the board load** (`mindmap::load_blocked`)
and appends the reasons to its `block_reasons` (`derived: "agent_capacity"`), once every status is
final and **before** a Compound Task's own derived block (`derived: "compound"`) reads "blocked" —
so a Compound whose open items an agent's capacity blocks is blocked too. Every reader of "blocked"
loads it so: the app's `load_mindmap`, the snapshot, and the board every `arlesh_tasks` /
`arlesh_waits` / `arlesh_infos` call reads (before the roots cut it, since whether a Task reads as
Agentic can come from above them). The filters, the snapshot and the app never learn about agents
here; they see a block. Neither the lifecycles nor `BoardFilter` change.

**Agents may carry on.** `arlesh_tasks.set_status` has never checked blocks and still does not:
an agent that already holds work may move it along — into In Progress included — while it is at
capacity. Only the app refuses to start a blocked Task, as it does for any block.

**In the app.** Settings → Agents lists each agent with its capacity cause and has the locks;
**Show agent status in the top bar** (on by default, app-wide; ruled by the user, 2026-10-01) sits
in the same section.

**The agents' status in the top bar** (ruled by the user, 2026-10-01, from mock 3, "Row under the
head", with the padlock and no counts). A small **bot head**, in the top bar's icon colour like the
gear, sits just before the Filter button, with a tiny row of icons under it. With **Show agent status in the top bar** off the head never shows. With it on, the head shows **only
while at least one of these holds** — whether or not the MCP endpoint is listening, since the waits
and work are facts of the board either way:

- an agent is at capacity, **for any reason** — locked by hand, its account locked, or a plan limit
  used up until its reset (2026-11-08) — an amber **padlock** (`--agent-capacity`);
- an Agentic Task reads **Review** — its agent has a question open for the user — a red **!**
  (`--ask`);
- a pending agentic wait is on something else, CI say — a blue **hourglass** (`--wait`);
- an Agentic Task is **On Agent** — the app's **On Agent** glyph (a bot head in the ring), in the
  bar's icon colour.

(Ported with Task 68f, 2026-10-01: the row first counted pending questions and Agentic Tasks In
Progress; with the Agentic status model those are Review and On Agent.)

The row shows only what applies, in that order, and **no counts**. The tooltip and the accessible
name spell out each line with its count — *2 agents at capacity. 1 agentic task waiting for your
review. 2 agent waits. 3 agentic tasks on an agent. Click for details.* A click opens a small menu
with one line per thing that applies: the capacity line has **Open**, which opens Settings on the
Agents section, scrolled to the agent's row when exactly one agent is held back (the row is
briefly highlighted); **Show** on the others — Review opens the List View under Do (where Review
leads) with the Agentic pill, the waits open it under its Expectations option, and On Agent opens
it under Do with the Agentic pill and the On Agent pill on. `Escape` or a click outside
closes it. Each glyph is its own component, so the Review and the other waits can be merged into
one icon by swapping two files for one.

The task counts cover the **whole board**, not the tab's subtree. They come from the load every
view already makes: after each load, `use-mindmap-data` counts them over the whole tree it built
(`agent-activity`) and hands them to an app-wide store the top bar reads — no request of its own.
The capacity line reads the agents list (`list_agents`), kept fresh on `agents-changed` and
`board-changed`, and again when the soonest plan limit resets. Every edit, every other window's
change and every MCP write ends in that reload, so the row is live.

## What writes

`arlesh_tasks`, `arlesh_waits` and `arlesh_infos` write to the board, and `arlesh_agents` writes
the Agent tables (attach, Claim, lock, usage): journaled under source `mcp` like the rest, so off
every stack, while the user's own Settings edits to them are Gestures on the user's stack (see
[Undo](undo.md)); every other tool is annotated
`read_only_hint = true` and writes nothing at all.
`arlesh_snapshot` used to be the exception: deriving a Habit's iterations minted the scope rows
their windows landed on, and it had to commit them or the payload would name ids that no longer
existed. Scopes are derived now (ADR 0009), so the snapshot reads in a read-only session like
everything else.

## What is deliberately absent

- **Every write command but the writes above**, including `start_flow` and any hard delete.
- **`valid_targets`** — it only reads, but it
  answers "where could this Flow be started?", a question nothing on this surface can act on while
  starting a Flow is a write. It returns alongside `start_flow`.

## Errors

A tool that fails returns a result flagged as an error carrying the same structured `WireError` the
frontend receives across the Tauri boundary, including its stable `kind` — `not_found`,
`containment_violated`, `invalid_request`, `needs_confirmation`, `needs_time_scope`,
`not_permitted`, `ambiguous_id`, `status_changed`, `database`, `internal` — so an agent branches on the discriminant rather than
parsing a message. (`needs_confirmation` reaches an agent only from `arlesh_tasks.update`
setting a planned Task aside; `needs_time_scope` is raised only by writes this surface does not
expose.)

`not_permitted` is the MCP's own: the request names a node the MCP may not touch — outside every
root (or, for an attached session, outside its Claim), private, or (for a write) not an Agentic Task — or one that does not exist, which it
deliberately cannot tell apart. It is also what a session that has not attached is told by every tool
but the attach tool, what a wrong or lapsed PIN or token gets, and what a Claim that is outside the
roots or overlaps another agent's gets (the overlap names the holder). The fix is the user's, on the *Agents* page; an agent that
gets one should say what it needs rather than retry. The app's own commands never raise it.

`ambiguous_id` and `status_changed` are the MCP's too (see *Short ids* and *Writing tasks*): the
first lists the candidates a short id matched, the second names the status a compare-and-set found.
