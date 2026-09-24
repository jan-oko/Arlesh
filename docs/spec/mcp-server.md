# MCP Server

*One area of the [Arlesh design specification](../../SPEC.md).*

Arlesh serves a [Model Context Protocol](https://modelcontextprotocol.io) endpoint while the app is
running, so an agent — Claude Code, Claude Desktop — can read the board without being told its
contents by hand. It sees only the parts of the board the user has opened to it as **MCP roots**,
and nothing at all until they open one (see *Access* below). It is read-only with two deliberate
exceptions: an agent can set an Agentic Task's `bd` issue link, and it can raise an **agentic
wait** under one — "the agent is waiting on you" — and nothing else. It cannot create,
rename, complete or delete a Task, Goal, Flow, Domain or knowledge-base entry.

The endpoint is hosted by the app itself, not a separate process, so there is only ever one writer
to the database and the agent sees exactly what the open window sees. The cost is that it answers
nothing while Arlesh is **not running** — which, since closing the window only hides it to the tray
([Windows & Tray](window-tray.md)), now takes a deliberate Quit rather than a reflexive click on the
close button.

**Address.** `http://127.0.0.1:4747/mcp`, overridable with the `ARLESH_MCP_PORT` environment
variable. It binds loopback only and rejects any request carrying an `Origin` header, so a page in
a browser cannot reach it. If the port is already taken the app logs a warning and runs without the
endpoint rather than refusing to start.

**Connecting.** `claude mcp add --transport http arlesh http://127.0.0.1:4747/mcp`

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

**Private stays private.** A private node is hidden from the MCP even inside a root, together with
its whole subtree — the rule Private Mode applies, and one the roots do not relax. A root that is
itself private, or sits under a private node, therefore opens nothing. This was agreed before the
model was simplified and was not revoked by it.

**Only stored nodes are roots.** A root names a row — a Domain (any of the four domain-table
subtypes), Goal, Task, Commitment, Expectation, Info, Flow or flow item — keyed by its table and its
row id, the way the node's own table keys it. A **derived** row (ADR 0008 — a Habit occurrence, a wait's check
task, a delegated Task's wait, a spawned wait, each an ordinary row of its kind with a UUID id and
an `origin`) is never a root and never writable by the MCP: it is visible exactly when it is not
private and the nearest **stored** row above it is visible, climbing through derived parents (an
occurrence under its iteration's root) to get there. A stored row hung on an occurrence is a stored
row like any other, visible by the roots above the Habit's host its columns name.

**Storage.** The roots are rows of the board (`mcp_roots`), not a per-window preference: the board
is what they describe, and every window and the MCP endpoint read the same list. They are
**journaled**, so adding or removing a root is an ordinary Gesture and **Ctrl+Z reverses it**. A
root belongs to its row: deleting the node drops the root in the same Gesture, and undoing the
delete brings both back — otherwise SQLite reusing the freed row id would open an unrelated node.
Retyping a node (which re-creates it in another table) therefore drops its root too.

**Where the user sets them.** On the *MCP access* page of the settings modal (see
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
- **`arlesh_beads.set` needs write**: the item must be an Agentic Task inside a root. Anything else
  — a Goal, Commitment or Project, a Task that is not Agentic, one outside the roots — is refused
  with `not_permitted`.
- **The knowledge base** hangs on no node, so no root contains it. A Person, Event or Thread is
  visible exactly when a node the MCP can see points at it: a Task delegated to the Person, or a
  Task or Goal linking the entity.
- **Scopes** are the calendar, not the board, and carry nothing a root protects; `arlesh_scopes` is
  unaffected.
- **The Flow sections travel with their Flow**: a Flow's derivation outcome (`habits`), cycles and
  intra-flow dependencies are there exactly when the Flow is. Its occurrences are rows of the kind
  sections, filtered like every derived row.

The write tools of `Arlesh-rz0` are deliberately not built yet; they follow `Arlesh-9o1` and
`Arlesh-pnn`, and will apply the same rule — write needs an Agentic Task inside a root.

## Tools

Seven tools rather than one per backend command, because an MCP client pays context for every tool
definition it loads.

| Tool | Operations |
| --- | --- |
| `arlesh_snapshot` | `load(now, sections?, cursor?, filter?)` — the whole planning graph: domains, goals, tasks, **commitments**, notes, flows, flow items, cycles, dependencies, block reasons, materialised instance nodes, every item's derived lifecycle, each flow's habit iterations and statuses, and which occurrence each **added child** hangs on. Paged; see below |
| `arlesh_scopes` | `get(id)`, `resolve(id)`, `resolve_many(ids)` — `id` is a scope's value key, a JSON object such as `{"kind":"week","date":"2026-09-20"}` |
| `arlesh_kb` | `list_people`, `get_person(id)`, `list_events`, `list_threads` |
| `arlesh_tasks` | `get(id)`, `containment_conflicts(node, time_scope)` |
| `arlesh_flows` | `get(id)`, `recurrence(flow_id)`, `completion_count(flow_id)`, `origins(nodes)` |
| `arlesh_waits` | `ask(task_id, title, note?)` — raises an agentic wait under an Agentic Task the MCP can write, the question in `note`. See *Agentic waits* below |
| `arlesh_beads` | `set(node_type, node_id, beads_id)` — a write; `node_type` is `task`, `goal`, `commitment` or `project`, and the item must be writable (an Agentic Task inside a root). See below |

`arlesh_snapshot.load` is the entry point and covers the common case. The other reads
exist for what it does not carry: the knowledge base, scope resolution, a task's dependency-derived
block reasons, and a Habit's stored recurrence configuration as opposed to its derived iterations.

A Commitment arrives with its `verdict` (`unresolved` / `kept` / `broken`) and its derived
lifecycle. The verdict is recorded, never inferred, and `unresolved` means the user has not said
rather than "not done" — an agent that reads it as an unfinished task has misread the board.

An Expectation — a wait tasks can depend on — arrives in its own `expectations` section, read-only,
with its `status` (`pending` / `released`), its `archival` and its optional `check_every` (a count
and a kind), `check_starting` and `last_check_at`. The day each checked wait's next check is due is
in `expectation_checks`. An `asynchronous` task may carry an `async_template`; while such a task
is done, the wait it spawned is in `spawned_waits`, keyed by the task, with its own lifecycle
entries (`spawned_wait`, `spawned_check`). The derived nodes the views draw — a wait's check task, a delegated task's wait,
a spawned wait — are not rows of their own: they are read off these sections and the task rows. Querying waits is `Arlesh-rz0`'s.

Tasks, Goals and Commitments carry `time_scope` and `plan` as boundary **scope ids**, and a scope's
id is its value key — `{"kind":"week","date":"2026-09-20"}`, `{"kind":"part_of_day","date":"2026-09-23","part":"morning"}` (see
[*Scopes are derived*](time-scopes.md)) — so the dates are in the snapshot itself and reading it needs no
round trip. `arlesh_scopes` is for what a key does not spell out: `get` adds the label and the
inclusive end date, and `resolve` / `resolve_many` the half-open datetime window (a Day runs
02:00 → 02:00) and whether it is active, all against a single reference instant. None of them
touches the database.

## Filtering a read

`load` takes an optional `filter`, and it is the **same** filter the top bar sets, answered by the
same definition — not an approximation assembled from `lifecycles`. `{"preset": "start"}` answers "what can I begin now?" by the rules the
user's own view applies: Plan minus lapsed windows, minus in-progress tasks with nothing left under
them to start, minus Habit flows, minus blocked subtrees, minus Tasks whose Plan has not begun
yet (see [*Mindmap*](mindmap-view.md)). `all`, `plan`, `start`, `do` and
`backlog` are the presets; `unblock` rides beside them as a flag rather than replacing one, exactly
as the List View stores it — beside them in shape, but not in effect: while the flag is set the
list's rows are the blocked ones and the preset does not answer for them (see
[*List View*](list-view.md)). The Archived and Backlog pills, the tag filters, the Info/Flow toggles
and Private Mode are all carried too, each defaulting to what the app's own filter defaults to —
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
`agentic_brief` — `priority` (0–4 for P0–P4, or null), `spec`, `design`, `acceptance`, `notes` — or
null when it has none. It is what an agent reads in place of `bd show`, and the server's
instructions say so. A Task that reads as Agentic **cannot be started without a Spec**; the write
tools that follow `Arlesh-pnn` will change a status through the same rule, so an agent asking to
start one gets the same refusal the app gives.

## Agentic waits

`arlesh_waits.ask` is how an agent says it is **waiting on the user** — the replacement for `bd
human`. It creates an Expectation with `agentic: true` directly under the Agentic Task the agent is
working, titled with what it is waiting for and with the full question in `agentic_note`. It needs
**write** access: the Task must be an Agentic Task inside an MCP root, or the call is refused as
`not_permitted`. Like `arlesh_beads` it is transactional and journaled as the **agent's** write, so
it never enters the user's Undo Stack, and every open window is told.

The user answers by writing the answer into the note, beneath the question, and **releasing** the
wait. The agent reads the answer off the wait in the snapshot's `expectations` — `status:
released` and the note — and nothing else is needed to close it. A wait blocks nothing unless a
Task depends on it.

## Issue links

A Task, Goal, Commitment or Project can carry the id of the `bd` issue tracking it, and `arlesh_beads.set` is
the **only** way that field is ever given a *value* — and, under *Access* above, only on an Agentic
Task inside an MCP root, so a Goal, Commitment or Project keeps whatever link it already has: the one Tauri command that touches the column
(`clear_beads_id`) writes null and nothing else, and the editor modals render the id as text with no
control but an × that stages the drop for their Save. So an issue id shown in Arlesh always arrived over MCP.
Passing `null` clears the link. Setting one on an item that does not exist is an error
(`not_permitted`, like any node outside the roots) rather than a silent no-op, and only the
`project` subtype of Domain accepts a link — an Aspect, Domain or Tag is refused.

## Nothing but `arlesh_beads` writes

Every tool other than `arlesh_beads` and `arlesh_waits` is annotated `read_only_hint = true` and
writes nothing at all.
`arlesh_snapshot` used to be the exception: deriving a Habit's iterations minted the scope rows
their windows landed on, and it had to commit them or the payload would name ids that no longer
existed. Scopes are derived now (ADR 0009), so the snapshot reads in a read-only session like
everything else.

## What is deliberately absent

- **Every write command**, including `retype_node` and `start_flow`.
- **`valid_targets`** — it only reads, but it
  answers "where could this Flow be started?", a question nothing on this surface can act on while
  starting a Flow is a write. It returns alongside `start_flow`.
- **The List view's own pill dimensions** — Antecedent, Dependency, Task/Goal/Project status, Verdict,
  Scope, Blocked, Agentic and Asynchronous. They read values a flattened row carries rather than facts a node
  has, so they belong with the flattening, which is frontend-side. The status presets are no longer
  absent; see *Filtering a read* above.

## Errors

A tool that fails returns a result flagged as an error carrying the same structured `WireError` the
frontend receives across the Tauri boundary, including its stable `kind` — `not_found`,
`containment_violated`, `invalid_request`, `needs_confirmation`, `needs_time_scope`,
`not_permitted`, `database`, `internal` — so an agent branches on the discriminant rather than
parsing a message. (The two `needs_*` kinds are raised only by writes this surface does not
expose.)

`not_permitted` is the MCP's own: the request names a node the MCP may not touch — outside every
root, private, or (for a write) not an Agentic Task — or one that does not exist, which it
deliberately cannot tell apart. The fix is the user's, on the *MCP access* page; an agent that
gets one should say what it needs rather than retry. The app's own commands never raise it.
