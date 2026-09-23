# Virtual node tables: a derived node is an ordinary row of its kind

A node that is **derived** rather than stored — today, a Habit's iterations and their items; later,
an Expectation's check-by Task and a delegated Task's Expectation — is an **ordinary row of its
kind**. Each kind (Task, Goal, Commitment, Expectation, …) is read through its own **virtual
table**: the kind's stored rows merged with its derived rows, each derived row being its template
with a per-kind **overlay** applied. The normal editor sends a normal update request for either;
the backend routes a write to a derived row into the overlay. Nothing about a derived node is a
second kind of node.

## Status

accepted (design, 2026-09-23; not yet built — `Arlesh-pnn`, built together with `Arlesh-9o1`)

## Context

ADR 0002 made Habit instances virtual so that storage stays proportional to divergences rather
than iterations, with an overlay (`habit_instance_modifications`) holding what differs. The overlay
was right; the surface built on it was not. Occurrences reached the frontend as their own wire
types (`HabitIteration`, `HabitInstance`) and were special-cased at about 110 sites in 26 files, so
every Task behaviour had to be re-added to them one at a time — and each gap (no editor on `E`, no
context menu, a subset editor, an iteration root that could not be edited) was a place that
special-casing had not reached yet. #72 went further down that road with a separate occurrence
editor and was closed unmerged in favour of this decision.

## Decision

1. **One virtual table per kind, with that kind's own schema.** Not one polymorphic table. A
   node-kind lookup (id → kind) may be exported if it simplifies references.
2. **Identity.** A derived row's id is a **UUID-v5** of its value key — `(template item, iteration
   start date, cycle pair)` — so every row has one opaque id type, stable across restarts and
   across derived scopes (`Arlesh-9o1`), since it holds a date rather than a scope row id. Stored
   rows keep their integer ids behind the same lookup. The UUID is computed in Rust: SQLite has no
   SHA-1, and a function registered from Rust would break any other client opening the database.
3. **Overlay shape.** One overlay table per kind, **mirroring that kind's columns**, keyed by the
   value key. Every column is nullable and NULL means *inherit from the template*; a column where
   NULL is itself a value (a Plan deliberately unplanned, no delegate) carries a `*_set` flag
   meaning *overridden to NULL*. `habit_instance_modifications` is split into these and dropped.
4. **Relations.** Stored nodes keep today's relation tables unchanged. A derived row's relations
   live in parallel overlay tables storing **add/remove differences against the template** — the
   shape `habit_instance_dependencies` and `habit_instance_children` already have. A dependency
   edge that crosses stored ↔ derived stores the derived end's key as real columns; a unified
   endpoint key may be a SQLite `VIRTUAL` generated column (a canonical string such as
   `flow_task:12:2026-09-20:3`), from which Rust derives the UUID.
5. **The template carries its kind's full schema.** A template item (a flow task today stores only
   a title, a parent and a position) gains every column and relation of its kind, and is edited in
   the normal editor. An occurrence inherits field by field, so a template edit reaches every
   occurrence that has not overridden that field. Only what is inherently per-occurrence stays
   derived: its time scope (the iteration's window) and its status.
6. **An edit to an occurrence writes that occurrence only.** To change every occurrence, edit the
   template node. Setting a field back to the template's value clears the override.
7. **No detaching.** An occurrence cannot leave its iteration or change kind; moving it out or
   retyping it is refused out loud. Moving it within its iteration is an overlay position change.
   It is never deleted: `Delete` archives it, as manual archival of a real node does.
8. **Horizon.** A kind's virtual table holds every past iteration since the Habit began (resolution,
   Lapsed/Missed and catch-up need them); of the future, only the current iteration, any future
   iteration with overlay data, and any window a query explicitly names.
9. **Wire shape.** A derived row travels as an ordinary row of its kind. At the business-logic
   layer every node gains a discriminated-union **`origin`**: `{"kind": "manual"}` for a stored
   node, `{"kind": "habit", "habit_id": …, "iteration_scope": …}` for a Habit's, with further
   variants as other derivations arrive. The few rules that genuinely differ key off `origin`.

## Considered options

- **Keep the special occurrence surface and extend it field by field (#72).** Rejected: it
  duplicates the Task model on a second code path that has to be kept in step forever, and every
  missed site is a bug.
- **Copy-on-write — materialize an occurrence into a real row on its first write.** Rejected: it
  is the materialize-on-first-touch hybrid ADR 0002 already turned down, and a full copy stops
  following template edits to the fields it did not change. The overlay keeps inheritance by
  construction.
- **A literal SQL `VIEW`.** Rejected: derivation follows recurrence rules that live in Rust
  (Consumption, catch-up, Lapsed/Missed, verdict windows, the 02:00 day boundary) over an unbounded
  future. The virtual table is a Rust-level source that every reader goes through.
- **One `nodes` lookup table that every relation table points at.** Rejected for now in favour of
  keeping today's relation tables for stored nodes and adding parallel difference tables.
- **Detach an occurrence into a real row on move or retype.** Rejected by the user: an occurrence
  belongs to its iteration.

## Consequences

- Every read of a kind goes through its virtual table: the board load, the filters, the MCP
  snapshot, the editors. The habit-specific wire types and most `virtual`/`habitItem` branches in
  the frontend are deleted.
- Every request that names a node accepts the UUID of a derived row as well as a stored id.
- Template items grow to their kind's full schema — a wide migration of the flow tables.
- ADR 0002 stands on *virtual rather than materialized* and on *storage proportional to
  divergences*; this ADR replaces how a virtual instance is represented, keyed and edited.
- Sequencing: built as two PRs, `Arlesh-9o1` (derived scopes) first and `Arlesh-pnn` branching
  from it, so that value keys are dates from the start.
