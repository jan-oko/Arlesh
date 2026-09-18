# Undo is a trigger-written row journal, not inverse commands

Ctrl+Z reverses the last thing the user did to the board. The obvious implementation is to give
each mutating command an inverse. We journal row images from SQL triggers instead, because there
are 83 mutating commands and an inverse written per command is a correctness obligation that has to
be met 83 times and then met again by every command written afterwards. A trigger on a table cannot
be forgotten by a command that does not know it exists.

## Status

accepted

## Context

Nothing in Arlesh is undoable today. A delete cascades through a subtree, a retype rewrites a node
across tables, a paste writes a subtree — and all of them are final.

Two facts about the backend shape the options. First, only **29 of 83** commands open a transaction
(ADR 0004); the other 56 run pooled, so "the transaction" is not yet a boundary that exists for most
writes. Second, sqlx's bundled SQLite is built without the session extension, so `sqlite3session`
changesets — which would otherwise be exactly the right tool, since they invert natively — are not
available without maintaining a custom build of the driver.

The unit of undo is a **Gesture**, not a command: pasting five nodes issues five commands today and
must be one Ctrl+Z. So whatever captures the before-state has to be groupable across several
commands, which rules out anything that treats one command as one step.

## Considered options

- **An inverse per command.** Semantically the best undo — it knows that the inverse of "move" is
  "move back" rather than "rewrite these four columns". Rejected on the arithmetic: 83 inverses to
  write and keep correct, each one a place where a new column silently stops being restored. The
  failure is invisible until someone undoes and quietly loses a field.
- **Instrument the resource operators in Rust.** Capture before-images inside the 11 repositories'
  ~84 methods. Plain Rust, no SQL codegen, no recursion edge cases. Rejected because the obligation
  is still per-method: a new operator method that forgets to capture is not undoable and nothing
  says so. It trades 83 obligations for 84.
- **Snapshot the whole database file per gesture.** The board is ~240 KB, so fifty steps is about
  12 MB and nothing can be missed. Genuinely tempting for a personal app. Rejected on two counts:
  the cost scales with the size of the board rather than the size of the change, so it degrades
  exactly as the app succeeds; and restoring a snapshot would also roll back any MCP write that
  landed during the gesture, silently discarding an agent's work.
- **A `sqlite3session` changeset per gesture.** The native answer, with inversion built in.
  Rejected as unavailable: it needs `SQLITE_ENABLE_SESSION` in the driver build, which sqlx does not
  provide, and vendoring a patched `libsqlite3-sys` is a larger and longer-lived commitment than the
  feature is worth.

## Consequences

- **Every write is covered the day this lands**, including writes by commands nobody has written
  yet. That is the whole point of the choice and the reason it beats the two per-site options.
- The cost is **roughly 45 generated triggers** — three per journaled table — living in a migration.
  They are mechanical, and wrong ones fail loudly (a trigger that references a dropped column is a
  migration error), but the migration is long and must be regenerated whenever a table is added.
  **A new table is not journaled until someone adds its triggers**, which is the one obligation this
  design does not remove; a test that asserts every non-excluded table has its three triggers is the
  intended guard.
- **Undo must not journal itself.** Applying an inverse is a write like any other and would be
  caught by the same triggers. The journal therefore carries a suppression flag that the undo path
  sets for the duration of its own transaction.
- **Not every table is journaled.** Derived and materialized rows — resolved scope rows, the
  journal itself — are excluded, or undoing a gesture would fight the code that regenerates them.
  The exclusion list is part of the design, not an optimization.
- **Rows are journaled, so undo speaks in rows.** It restores what the row was, not what the user
  meant. For every operation in this app that is the same thing, but it is why the toast names the
  gesture ("Undid: delete 4 items") rather than describing the row changes.
- **Writes are tagged with their source.** An MCP write is journaled but never enters the undo
  stack: an agent setting a `beads_id` is not something the user did, and Ctrl+Z reversing it would
  be indefensible. The journal stays a faithful history; the stack is a history of *the user*.
- **The gesture boundary is opened by the frontend**, which is the weak seam in this design — a
  multi-command gesture that forgets to open one degrades to per-command undo. It degrades rather
  than corrupts, and it gets better as command logic moves into Rust (`Arlesh-32r`, `Arlesh-tgf`),
  after which most gestures are one backend call and the protocol is vestigial.
- **One stack for the whole app**, not one per tab. There is one board and one history of changes to
  it; a per-tab stack could undo past another tab's newer edit.
- The stack is **session-scoped** and cleared on restart, so the journal table needs no retention
  policy beyond a depth limit and a truncate at startup.
