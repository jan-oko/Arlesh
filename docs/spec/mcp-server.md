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
- **`arlesh_infos.create` needs write** on the Task it hangs the note under.
- **`arlesh_tasks` writes** follow the two rules above: `create` needs `may_create_task_under`
  at the parent, and every other write needs a Task that reads as Agentic. See *Writing tasks*.
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


## Tools

Eight tools rather than one per backend command, because an MCP client pays context for every tool
definition it loads.

| Tool | Operations |
| --- | --- |
| `arlesh_snapshot` | `load(now?, sections?, cursor?, filter?, agentic?)` — `now` is a local date-time string (`"2026-09-25T09:00:00"`) and defaults to the server's current time; the whole planning graph: domains, goals, tasks, **commitments**, notes, flows, flow items, cycles, dependencies, block reasons, materialised instance nodes, every item's derived lifecycle, each flow's habit iterations and statuses, and which occurrence each **added child** hangs on. Paged; see below |
| `arlesh_scopes` | `get(id)`, `resolve(id)`, `resolve_many(ids)` — `id` is a scope's value key, a JSON object such as `{"kind":"week","date":"2026-09-20"}` |
| `arlesh_kb` | `list_people`, `get_person(id)`, `list_events`, `list_threads` |
| `arlesh_tasks` | reads: `get(id)`, `containment_conflicts(node, time_scope)`; writes: `create(parent_type, parent_id, title, brief?)`, `update(id, title?, brief?, backlog?)`, `set_status(id, expected, status)`, `move(id, parent_type, parent_id)`, `archive(id)`. See *Writing tasks* below |
| `arlesh_flows` | `get(id)`, `recurrence(flow_id)`, `completion_count(flow_id)`, `origins(nodes)` |
| `arlesh_waits` | `raise(task_id, title, note?, question?)`, `ask(task_id, title, note?)`, `release(id, answer?)`, `get(id)` — agentic waits under an Agentic Task the MCP can write: a question for the user or a wait on something else, released by the agent (a question only with its answer) and polled with `get`. See *Agentic waits* below |
| `arlesh_infos` | `create(task_id, body, details?)` — a write: an Info (a note) under an Agentic Task the MCP can write. See *Notes* below |
| `arlesh_beads` | `set(node_type, node_id, beads_id)` — a write; `node_type` is `task`, `goal`, `commitment` or `project`, and the item must be writable (an Agentic Task inside a root). See below |

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
reference to one is reported **one way**, derived from the parent row rather than from whatever
was stored: `project` when the parent is a Project, `domain` for any other subtype — the spelling
the Task, Goal and Commitment tables' constraints allow and the app writes. The parent's own
subtype is on its row in `domains`. On input, any of the four subtype names or `domain` is accepted
for a domain-table parent — they name the same table, so none is wrong — and the row is written
with that one spelling. A name of another kind (`goal` for a domain row) is not a domain-table
name and is resolved as that kind.

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
- **Commitments** carry a `verdict`, `unresolved`/`kept`/`broken`, recorded and never inferred:
  `unresolved` means the user has not said, not "not done".
- **Expectations** are waits: `pending` blocks the tasks depending on it, `released` frees them. A
  `check_every` schedules check tasks beneath it (`origin` `{"kind": "check", …}`). An
  `asynchronous` task's spawned wait (`{"kind": "spawned_wait", …}`) and a delegated task's wait
  (`{"kind": "delegation_wait", …}`) are expectations too. An agentic wait carries `agentic_note`,
  `question` and `answer` (see *Agentic waits*).
- **Delegation.** A task's `delegate_to` is `null`, `{"kind": "person", "id": N}` (read the Person
  with `arlesh_kb`) or `{"kind": "agent"}`, independent of `agentic`.
- **Parents.** A node under a domain-table row names its parent `project` (a Project) or `domain`
  (any other subtype), derived from the parent row; its subtype is on that row in `domains`.

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
and Private Mode are all carried too, and so is the Plan preset's **scope narrowing** —
`plan_scope`, a scope key, and `scope_match`, `contained` (the default) or `overlapping`, the
app-wide setting the UI fills in (see [*Mindmap*](mindmap-view.md)) — each defaulting to what the
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
instructions say so. A Task that reads as Agentic **cannot be started without a Spec**; the write
tools change a status through the same rule, so an agent asking to start one gets the same refusal
the app gives.

**Asking for them.** `load` takes an `agentic` query beside `filter` (added to `Arlesh-rz0`,
2026-09-24): `{}` narrows the board to the Tasks that **read as Agentic** — their own flag or their
nearest flagged ancestor's, by the one resolver the app and the write rules share, stored rows and
Habit occurrences alike — and `{"max_priority": "A"}` to those at A or more urgent (MW and A), a Task with no
priority then left out. The rows each match hangs from come along for context, as do the waits and
notes directly under a match; everything else goes, the Flow sections whole. The `tasks` section
comes most urgent first (no priority last), context rows after, and every task row carries
`reads_agentic` — `true` for a match, `false` for a context row. It is the MCP's own narrowing,
applied after the roots and after `filter`, and deliberately **not** a field of the shared
`BoardFilter`: the List View's Agentic pill reads a flattened row's value, which the presets do not,
so the conformance corpus is untouched.

## Writing tasks

`arlesh_tasks` carries the agent's task writes (`Arlesh-rz0`, 2026-09-24): `create`, `update`,
`set_status`, `move` and `archive` (Habit occurrences only). Nothing is ever deleted.

- **`create`** makes a Task under a parent the MCP can see that can hold one — a Domain or
  Project, a Goal, a Task, a Commitment, or a Habit occurrence — except under a Task explicitly
  marked **Not agentic**. The new Task is **always Agentic**, its own flag set, and may carry its
  brief from the start.
- **`update`** changes a Task's title, its brief — each brief field given replaces that field, the
  rest stay — and whether it is set aside in the **Backlog**.
- **`set_status`** is a **compare-and-set**: it names the status the agent last saw (`expected`)
  and the one to set. The session holds SQLite's single writer lock from before the compare until
  the write commits, so the two are one step: if the Task's status is no longer `expected`, the
  call is refused as `status_changed`, naming the current status in `details.current`, and nothing
  is written. Two agents both expecting `todo` cannot both win. Starting a Task that reads as
  Agentic needs a Spec, as in the app.
- **`move`** re-parents a Task. It needs write on the Task and create permission at **both** its
  old and its new parent, so a Task can leave a subtree only for one it could have been made in.
- **`archive`** never deletes, and for now takes **only a Habit occurrence**, archived as the app
  archives one — tombstoned in its overlay, still on the board, and a status brings it back.
  Archiving a **stored** Task by hand is not in the model yet (its Archival follows its scope), so
  the call is refused as `not_permitted`, saying manual archival is not supported yet, and nothing
  is written. Manual archival is tracked as `Arlesh-dbh` (the user's ruling, 2026-09-25).

Every write but `create` needs a Task that reads as **Agentic**, stored or derived — resolved by
the one resolver the app uses. A write to a **Habit occurrence** lands in its overlay, exactly as
the user's own edit would, and the template is untouched; an occurrence cannot `move` (its Habit
decides where it hangs). A write the rules refuse is `not_permitted`, and writes nothing.

**Undo.** MCP writes are not undoable from the app, deliberately: each is journaled under the `mcp`
source, as `arlesh_beads` and `arlesh_waits` are, so it never enters the user's Undo Stack, is not a
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
- **`release(id, answer?)`** releases an agentic wait under a Task the agent can write. A
  **question** wait needs a non-blank `answer` — one the agent got from the user in its own
  session — and is refused (`invalid_request`) without one, writing nothing. A wait that is not a
  question needs none. A wait that is not agentic is refused as `not_permitted`.
- **`get(id)`** returns one visible wait's `status`, `question`, `note` and `answer` (with its
  short and full id), so an agent can poll for the user's answer without loading the snapshot.

`raise` and `release` need **write** access to the Task: an Agentic Task inside an MCP root, or the
call is refused as `not_permitted`. Like `arlesh_beads` they are transactional and journaled as the
**agent's** write, so they never enter the user's Undo Stack, and every open window is told.

The user answers a question wait in the app by writing the **answer** in its editor and releasing
it; the app refuses the release without one, from every release path. The agent reads the answer
with `get`, or off the snapshot's `expectations`, which carry `question` and `answer`. A wait blocks
nothing unless a Task depends on it.

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

A Task, Goal, Commitment or Project can carry the id of the `bd` issue tracking it, and `arlesh_beads.set` is
the **only** way that field is ever given a *value* — and, under *Access* above, only on an Agentic
Task inside an MCP root, so a Goal, Commitment or Project keeps whatever link it already has: the one Tauri command that touches the column
(`clear_beads_id`) writes null and nothing else, and the editor modals render the id as text with no
control but an × that stages the drop for their Save. So an issue id shown in Arlesh always arrived over MCP.
Passing `null` clears the link. Setting one on an item that does not exist is an error
(`not_permitted`, like any node outside the roots) rather than a silent no-op, and only the
`project` subtype of Domain accepts a link — an Aspect, Domain or Tag is refused.

## What writes

`arlesh_tasks`, `arlesh_beads`, `arlesh_waits` and `arlesh_infos` write; every other tool is annotated
`read_only_hint = true` and writes nothing at all.
`arlesh_snapshot` used to be the exception: deriving a Habit's iterations minted the scope rows
their windows landed on, and it had to commit them or the payload would name ids that no longer
existed. Scopes are derived now (ADR 0009), so the snapshot reads in a read-only session like
everything else.

## What is deliberately absent

- **Every write command but the writes above**, including `retype_node`, `start_flow` and any
  hard delete.
- **`valid_targets`** — it only reads, but it
  answers "where could this Flow be started?", a question nothing on this surface can act on while
  starting a Flow is a write. It returns alongside `start_flow`.
- **The List view's own pill dimensions** — Antecedent, Dependency, Task/Goal/Project status, Verdict,
  Scope, Blocked, Agentic and Asynchronous (the snapshot's own `agentic` query, under *Agentic
  tasks*, answers the Agentic question for an agent). They read values a flattened row carries rather than facts a node
  has, so they belong with the flattening, which is frontend-side. The status presets are no longer
  absent; see *Filtering a read* above.

## Errors

A tool that fails returns a result flagged as an error carrying the same structured `WireError` the
frontend receives across the Tauri boundary, including its stable `kind` — `not_found`,
`containment_violated`, `invalid_request`, `needs_confirmation`, `needs_time_scope`,
`not_permitted`, `ambiguous_id`, `status_changed`, `database`, `internal` — so an agent branches on the discriminant rather than
parsing a message. (The two `needs_*` kinds are raised only by writes this surface does not
expose.)

`not_permitted` is the MCP's own: the request names a node the MCP may not touch — outside every
root, private, or (for a write) not an Agentic Task — or one that does not exist, which it
deliberately cannot tell apart. The fix is the user's, on the *MCP access* page; an agent that
gets one should say what it needs rather than retry. The app's own commands never raise it.

`ambiguous_id` and `status_changed` are the MCP's too (see *Short ids* and *Writing tasks*): the
first lists the candidates a short id matched, the second names the status a compare-and-set found.
