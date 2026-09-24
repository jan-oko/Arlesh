# Derived nodes

*One area of the [Arlesh design specification](../../SPEC.md).*

A node is **stored** or **derived**. A stored node is a row of its kind's table, made by hand (or by
starting a plain Flow, which makes ordinary copies). A derived node exists because something else
does: a Habit's occurrence exists because the Habit recurs. Either way it is **an ordinary row of its
kind** — a derived Task is a Task, and goes wherever a Task goes: the Mindmap, the List View, the
Plan View, the Steps View, the filters, the editor on `E`, the context menu, the MCP snapshot. The
decision and its alternatives are [ADR 0008](../adr/0008-virtual-node-tables.md); how a Habit decides
*which* occurrences exist is [Habits](habits.md).

## One row shape, one id type

Every node of a kind is read through that kind's **virtual table**: its stored rows merged with the
rows its templates derive. The virtual table is a Rust-level source rather than a SQL view, because
derivation follows recurrence rules that live in Rust, and every reader goes through it — the board
load, the filters and the snapshot all see derived rows, and none of them has a second code path
for them.

A derived row's **id** is a **UUID-v5** of its value key, hashed under the app's node namespace
(`0d75ff4b-9652-4596-9d2f-1909230b662b`, the one the frontend mints display keys under). A stored row
keeps its integer id. On the wire a row's `id` is therefore a number or a string, and every request
that names a node takes either: a request naming a derived row goes into its overlay, one naming a
stored row where it always went. The backend keeps a lookup from UUID back to value key, filled as
derived rows are served; an id it has not served yet is answered by deriving again.

Every row carries an **`origin`**, a union discriminated on `kind`:

- `{"kind": "manual"}` — a stored row.
- `{"kind": "habit", "habit_id": …, "iteration_scope": {…}, "item_type": …, "item_id": …,
  "cycle_id": …}` — a Habit's occurrence. `iteration_scope` carries the iteration's ordinal, the date
  its window starts, its exclusive end, its anchoring scope's key, the Habit's window kind and the
  iteration's derived state; `item_type` is `flow_root` for the iteration's root and `flow_goal` /
  `flow_task` for an item's occurrence.

The few rules that genuinely differ for a derived row key off `origin` and nothing else:

- **It cannot leave its iteration.** Moving it under another parent, or giving it another window, is
  refused out loud. A request that merely repeats its current parent and window — a full editor save
  — is not a move. This is deliberate, not a gap: there is **no detach**. An occurrence exists
  because its Habit recurs, so it has nowhere else to be; turning one into a free-standing stored row
  would leave the Habit with a hole in an iteration and the row with a history it no longer has. To
  put the work somewhere else, make a stored Task there (or copy the template item); to change when
  occurrences fall, edit the template's cycle pairs. Reordering it among its siblings is not a move.
- **It cannot change kind.** Retyping it is refused; retype its template item instead.
- **It is never deleted.** `Delete` archives it, as manual archival of a stored node would, and
  giving it a status again brings it back. Archiving takes what it holds with it, as archiving any
  node does: an archived iteration root sets the whole iteration aside, and an archived occurrence
  the occurrences nested under it. Everything set aside reads as archived and no longer has to be
  done for the iteration to resolve — so under Blocking Consumption an iteration whose root was
  archived stops withholding the Habit, without anything in it being recorded as done. Nothing is
  written to what it holds, and nothing is taken from the template. The Mindmap asks for the delete with the same
  confirmation as any other.
- **It is not copied, and nothing is copied onto it.** A copy is a stored row made under a stored
  parent. A node *moved* onto an occurrence (cut and paste, drag) is hung on that one iteration, as
  one created there is.
- **It is not a Flow target**, since a target is a stored row the flow's instances hang under.
- An iteration root's title is drawn with its iteration's label after it ("Exercise W22"); the row's
  own title is the Habit's (or its own override), and that is what its editor edits.

Everything else is the same as for a stored row of the kind, on every surface: the status glyph and
its completion guard, the flags (Backlog, Agentic, Asynchronous), the verdict controls, the Plan, the
editor on `E` — whose window field shows the occurrence's window and says it stays with the
iteration — tags, block reasons, dependencies in either direction, and children of every kind its
kind holds except the Habit's own template kinds (a Flow, a flow item).

## Value keys

A Habit occurrence's value key is **(template item, iteration scope, cycle pair)** — the template
item being the flow itself for an iteration's root, or one of its items, and the iteration scope
being the **scope key** its window is anchored on ([Time scopes](time-scopes.md)). It is spelled as
one canonical string, `flow_task:12:day:2026-09-20:3` (item type, item id, scope key, cycle pair —
`0` for the root and for an item that declares no pairs), which is what the UUID is hashed from, what
the overlay tables generate as their `node_key` column, and what the relation tables store. A scope
key is a value, not a row, so the key is true without anything being written to name it; an Exact
iteration scope's key is registered in `exact_scopes`, as every stored Exact key is.

## Overlays

What makes one derived row differ from its template lives in its kind's **overlay** — one table per
kind (`task_overlays`, `goal_overlays`, `commitment_overlays`, migration 0060) mirroring that kind's
columns. Every column is nullable and **NULL inherits the template's value**; where NULL is itself a
value (no Plan, no delegate, no beads id) a `*_set` flag marks the column overridden **to** NULL. An
overlay row whose every column inherits says nothing and is deleted rather than kept, so an occurrence
nobody touched has no row at all and storage stays proportional to divergences
([ADR 0002](../adr/0002-flow-habit-instance-materialization.md)).

Inherently per-occurrence state is the overlay's own and never inherited: the **status** (a Goal's
status, a Commitment's verdict) with when it was resolved, and a **tombstone** (`archived`, or
`missed`). The Time Scope is not an overlay column at all: an occurrence's window is its iteration's,
or its Cycle Scope's within it.

**An edit to an occurrence writes that occurrence only.** To change every occurrence, edit the
template. Setting a field back to its template's value **clears** the override rather than pinning a
copy, so the occurrence goes back to following the template.

`habit_instance_modifications`, the single polymorphic overlay that preceded these, was split into
them by migration 0060 and dropped. Each of its rows carried across under its own iteration scope
key, into the overlay of the kind its row draws. A goal's `done` became `achieved`, a commitment's
`kept`/`broken` became its verdict (a stale `done` is not a verdict), a `deleted` tombstone became
`archived`, and a block reason became the occurrence's own one-reason list. A row that carried
nothing its kind can read was not kept. `habit_instance_dependencies` and `habit_instance_children`
became `derived_dependencies` and `derived_children` the same way.

## Relations

A stored node keeps today's relation tables. A derived node's relations live in parallel tables of
**differences against its template**, keyed by its canonical node key:

- `derived_tags` — `added = 1` puts a tag on the occurrence, `added = 0` takes one of its template's
  off.
- `derived_block_reasons` — an occurrence reads its template's block reasons until it has a list of
  its own (its overlay's `block_reasons_set`), which may be empty.
- `derived_dependencies` — an edge with at least one derived end. Each end is a stored row or a
  derived key, never both; a stored↔derived edge stores the derived end's key as a real column. The
  generated columns `dependent_node` and `target_node` are the unified endpoint keys (`task:42`, or
  the derived key) the edge's uniqueness is over. `added = 0` removes one of the template's own edges
  from one occurrence.
- `derived_children` — a stored node hung on a derived one. The child's own parent columns name the
  Habit's host, since a derived node has no integer id for them to hold; this attachment is what makes
  the occurrence its parent, and the virtual table reads the child's parent as the occurrence. A child
  whose occurrence is not derived keeps its stored parent, so it stays on the board beside where it was
  rather than vanishing.

## Templates

**What "the full field set" means.** Every occurrence is a copy of a template drawn afresh on each
read, so anything an occurrence shows before you touch it has to come from somewhere — the template.
Before migration 0061 a template item held only a title, its cycle pairs and its dependencies, so an
occurrence could have a delegate, a tag or a block reason only by being edited one iteration at a
time. Now a template holds **every field its kind has that is not per-occurrence by nature**: set a
tag or a delegate on the template once and every occurrence has it; set one on an occurrence and
only that occurrence differs. What stays per-occurrence is what only one repetition can say — its
status and when it was resolved, and its archive.

A template item — a Flow's own row for the iteration root, a `flow_goals` or `flow_tasks` row for an
item — carries the **full schema of its kind** (migration 0061): a task template its delegate, Agentic
and Asynchronous flags, Backlog state and beads id; a goal template its beads id; both their tags
(`template_tags`) and block reasons (`template_block_reasons`). Every occurrence reads them unless its
overlay says otherwise. They are edited in the flow item's editor, beside the item's cycle pairs and
dependencies. An Expectation template (the wait an Asynchronous Task spawns) is not part of a Habit
template; an occurrence cannot carry one of its own either.

**Changing an item's cycle pairs keeps every pair that survives.** A pair whose Cycle Scope is still
there keeps its id, so its occurrences keep what they recorded. A change that would drop a pair some
occurrence recorded something on is refused with the Habit editor's own question — **Archive & new**
(the change lands on a copy of the Habit, the original stops recurring and keeps its history) or
**Discard & regenerate** (the recorded edits are cleared) — and the whole item save is one undo step
that follows the copy.

## A wait's derived rows

A wait's **check tasks**, the wait an Asynchronous Task's completion **spawned**, and the wait a
**delegated** Task has on its delegate are derived rows too, with origins of their own:

- `{"kind": "check", "wait_kind": "stored" | "spawned", "wait_id": …, "due_at": …}` — a Task row
  under its wait, one per check made (done) and one for the check due now. Its key is
  `check:{wait_kind}:{wait_id}@{due_at}`, so a check is one row from due to done. What one check
  task changes lives in `task_overlays` under that key (`origin = 'check'`), and its tags and block
  reasons in the relation tables with no Habit; its status is the check itself (`wait_checks`).
- `{"kind": "spawned_wait", "task_id": …}` — an Expectation row under the Task, drawn from its
  Expectation template, its status and archive in `spawned_waits`.
- `{"kind": "delegation_wait", "task_id": …}` — an Expectation row under a delegated Task that is not
  done, released only by the Task being done.

What they refuse is what their derivation fixes: a check task keeps its wait and its day and is not
delegated; a spawned wait's title, tags, window and Check every are its template's; nothing is
written to a delegation wait; none of the three is deleted or copied.

## Horizon

A kind's virtual table holds **every past iteration** since the Habit began — resolution,
Lapsed/Missed and catch-up read the past. Of the future it holds only the iteration open now, any
later iteration that carries an overlay, a relation or an attached child (so an edit made to a future
occurrence is never lost), and any window a caller explicitly names (the Plan View filling next
month). Such a not-yet-begun iteration's occurrences are **Pending**.

---
