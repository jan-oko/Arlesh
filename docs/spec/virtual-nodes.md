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
  its window starts, its exclusive end, its anchoring scope, the Habit's window kind and the
  iteration's derived state; `item_type` is `flow_root` for the iteration's root and `flow_goal` /
  `flow_task` for an item's occurrence.

The few rules that genuinely differ for a derived row key off `origin` and nothing else:

- **It cannot leave its iteration.** Moving it under another parent, or giving it another window, is
  refused out loud. A request that merely repeats its current parent and window — a full editor save
  — is not a move.
- **It cannot change kind.** Retyping it is refused; retype its template item instead.
- **It is never deleted.** `Delete` archives it, as manual archival of a stored node would, and
  giving it a status again brings it back.
- An iteration root's title is drawn with its iteration's label after it ("Exercise W22"); the row's
  own title is the Habit's (or its own override).

## Value keys

A Habit occurrence's value key is **(template item, iteration start date, cycle pair)** — the template
item being the flow itself for an iteration's root, or one of its items. It is spelled as one
canonical string, `flow_task:12:2026-09-20:3` (item type, item id, date, cycle pair — `0` for the root
and for an item that declares no pairs), which is what the UUID is hashed from, what the overlay tables
generate as their `node_key` column, and what the relation tables store. The key holds a **date**,
not a scope row id, so it stays true when scopes stop being rows (`Arlesh-9o1`).

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
them by migration 0060 and dropped. Each of its rows carried across under its iteration scope's start
date. Where two rows met on one key — a Habit whose window kind changed kept its old rows beside the
new ones — the row keyed on the kind the Habit generates today won. A goal's `done` became `achieved`,
a commitment's `kept`/`broken` became its verdict (a stale `done` is not a verdict), and a `deleted`
tombstone became `archived`.

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

## Horizon

A kind's virtual table holds **every past iteration** since the Habit began — resolution,
Lapsed/Missed and catch-up read the past. Of the future it holds only the iteration open now, any
later iteration that carries an overlay, a relation or an attached child (so an edit made to a future
occurrence is never lost), and any window a caller explicitly names (the Plan View filling next
month). Such a not-yet-begun iteration's occurrences are **Pending**.

---
