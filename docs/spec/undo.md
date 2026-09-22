# Undo

*One area of the [Arlesh design specification](../../SPEC.md).*

Ctrl+Z reverses a **Gesture** — one thing the user did — and Ctrl+Shift+Z reapplies it. There is
**one stack for the whole app**, not one per view or window: there is one board and one history of
changes to it, and a per-view stack could undo past another view's newer edit. Both stacks are
**session-scoped** and empty on launch.

That answer was already the right one when a second window arrived, and it is why a
[board-changed](window-tray.md) event needs to do nothing to the stacks at all. The stacks live in
backend memory, one pair for the whole application, so an edit made in one window is on the same
stack a Ctrl+Z in another window pops — which is exactly what the paragraph above asks for. Ctrl+Z
anywhere reverses the most recent thing the user did anywhere; a new Gesture in one window clears
the Redo Stack another was about to use, for the same reason it clears it within one window. The
board-changed event is a signal to reload and nothing more, and a window reloading on receipt
neither pushes nor pops anything.

One consequence is worth saying out loud. The **name** a Gesture was opened with is held
frontend-side, keyed by Gesture id, because only the frontend knows the user called it "paste 5
nodes" — so it is held in the window that opened it. Undoing that Gesture from *another* window
finds no name and falls back to the row counts: "Undid: update 1 item" rather than "Undid: paste 5
nodes". The step reversed is the right one and the toast still says something true; it says less.
Moving the names into the backend would mean giving a Gesture id a sentence the database has
nowhere to put, which is the trade this design already declined.

## The journal

The record undo works from is a **row-level journal written by SQL triggers**, not by the commands.
Three triggers per journaled table — insert, update, delete — write a `undo_journal` row carrying
the changed row's **before image**, its **after image**, or both, as JSON. Rows are journaled, so
undo speaks in rows: it restores what a row was, not what the user meant by changing it. That is
why the toast names the gesture ("Undid: delete 4 items") rather than describing column changes.

The alternative — an inverse per command — was rejected because there are 83 mutating commands and
an inverse is an obligation met 83 times and again by every command written afterwards, while a
trigger cannot be forgotten by a command that does not know it exists. ADR 0006 weighs that against
whole-database snapshots and `sqlite3session` changesets, and says why neither is available here.

**Not every table is journaled.** Derived and materialised rows are excluded, or undo would fight
the code that regenerates them. The exclusion list is part of the design rather than an
optimisation, and today it is exactly `scopes` — a scope row is the calendar, instantiated on
demand and never deleted, so undoing its creation would delete a row the next read recreates and,
where another item still references it, fail against the foreign keys — plus the journal's own two
tables. Everything else on the board is journaled, including the link and dependency tables that a
foreign-key cascade removes without any command naming them.

A table added later is **not journaled until its triggers are written**, and that is the one
obligation this design does not remove. It is guarded by a test that enumerates the schema from
`sqlite_master`, fails when a table that is not on the exclusion list has no triggers, and fails
again when a *column* of a journaled table is missing from its triggers —
`scripts/generate-undo-triggers.sh` writes the replacements.

## Gestures

A Gesture is not a command: pasting five nodes issues five commands and is one Ctrl+Z. The boundary
is therefore **opened by the caller**, through the `open_gesture` and `close_gesture` commands, and
the frontend is the layer that knows which commands belong together. Opens **nest and join** — a
nested open joins the gesture already running rather than starting a second, the same rule ADR 0004
gives transactions — so the intended shape is a gesture around every invoked command plus an
explicit outer gesture around the runs that belong together.

This is the weak seam in the design, and it fails in one direction only:

- a multi-command gesture that forgets its outer open **degrades to per-command undo**;
- a write made with no gesture open at all is journaled **ungrouped** and is never offered as an
  undo step.

Nothing here can make Ctrl+Z reverse something the user did not ask about; the cost of forgetting
is a change that undo declines to touch. The seam narrows on its own as command logic moves into
Rust, after which most gestures are one backend call and the protocol is vestigial.

On the frontend, that shape is one module: `src/api/gesture.ts` is the only file that imports
Tauri's `invoke`, and everything in `src/api/` goes through its wrapper, which opens a Gesture
around **every** command. A lone command is therefore its own undo step without anyone remembering
to ask for it — the same argument the trigger journal makes against per-command obligations — and
a lint rule refuses a direct import so a new api file cannot quietly fall outside the stack. Runs
that belong together are wrapped once more, by `withGesture(name, run)`, which opens the outer
Gesture the per-command opens then join: a paste, a multi-select delete, an insert-parent (a create
and a move), and a drag reparent that clamps scoped descendants before moving. Both wrappers close
their Gesture in a `finally`, because a command that throws having already written something must
still be a step the user can reverse.

`withGesture`'s `name` is the human name of the Gesture, and it is set when the Gesture opens
because only the frontend knows the user called it "paste 5 nodes". The backend has nowhere to put
it — a Gesture id is minted by the database and the summary it returns carries counts and table
names, not a sentence — so the names are held frontend-side, keyed by Gesture id, and read back
when an undo returns that id.

### An editor's Save

An editor's Save is **one Gesture, and all or nothing**. A Task save issues an update, a set of
block reasons, one call per tag added or removed, one per dependency added or removed, and the
staged clear of the `bd` link — so it used to be several undo steps, and *how many* depended on
which fields the user happened to have touched. It is one press now, under a name of its own:
**edit a task**, **edit a goal**, **edit a commitment**, **edit a project**. The Gesture is opened
by the editor rather than by the save handler behind it, because the staged `bd` clear is the
editor's own call and belongs inside the same boundary; the clamp-or-cancel prompt a narrowed
Time Scope raises stays outside it, having written nothing yet and being a wait of indefinite
length.

All-or-nothing is the part the protocol did not already have. `withGesture` closes in a `finally`,
which **commits**: a paste that got five nodes in and was refused the sixth has done five things
the user can see, and one Ctrl+Z over them is the right answer. A form is not like that. Its fields
are one thing the user filled in, so a save that writes the title and the tags and is then refused
a dependency leaves a state nobody asked for, and "one undo step containing a half-save" answers
the wrong question. So a save that throws **aborts**: `abort_gesture` closes the Gesture and
replays its entries in reverse through the same engine Ctrl+Z uses — one transaction, foreign keys
deferred, applied whole or not at all — and then drops those entries from the journal. The
reversal is written with journalling suppressed, so entries left behind would have the journal
asserting changes the board no longer carries, with nothing after them to say they were taken back.

An aborted Gesture reaches **neither stack**. It is not an undo step, because there is nothing left
to undo; and it does not clear the Redo Stack, because the board never moved on, so a redo the user
still had is still theirs. The one exception is a reversal that itself fails: the writes stand, and
the Gesture is then put on the Undo Stack after all — a change the user can still take back by hand
is better than one stranded outside both stacks — and the error says so.

A **nested** abort takes nothing back, because the outermost open owns the boundary and a caller
inside someone else's Gesture cannot declare the whole of it failed. Nothing reaches an editor save
from inside another Gesture, so that is the shape written down rather than a case with behaviour of
its own. The refusal itself is reported the way [the Mindmap's refusal policy](mindmap-view.md)
requires: the editor stays open and names the backend's own reason on its save error line, beside
the fields that would answer it. And a save that changed nothing writes nothing, so it closes a
Gesture with no user entries and — as for every such Gesture — no press is ever spent on it.

## What the user sees

**Every press says something.** A Gesture that comes back raises the app's existing anchored
notice, naming what was reversed: **"Undid: paste 5 nodes"** from the name the Gesture was opened
with, or **"Undid: update 1 item"** from the row counts when nobody named it. A redo says
**"Redid: …"** of the same phrase — the toast names the Gesture, not the direction of travel. The
board then reloads the way every other mutation already ends.

The other two outcomes also speak, and the three must not look alike:

| outcome | undo | redo | reloads |
|---|---|---|---|
| applied | `Undid: paste 5 nodes` | `Redid: paste 5 nodes` | yes |
| empty stack | `Nothing to undo` | `Nothing to redo` | no |
| refused apply | `Couldn't undo: …` | `Couldn't redo: …` | no |

An **empty stack** is not a failure: nothing was wrong, there was simply nothing there, and the
message is a statement of fact about the board. A **refused apply** is a failure — the whole replay
runs in one transaction, so the board is untouched and the Gesture is **still on the stack**, and
the same press will work once whatever blocked it is gone. The anchored notice has one class and
one tone, with no severity channel of its own, so the wording is the only thing holding those two
apart: the refusal names a reason after a colon and says something could not be done, while the
empty stack states a fact and carries no reason because there is none.

Only a Gesture that was actually applied redraws anything. `undo_status` exists to label and
disable a control and is never consulted before a keystroke; the backend handles an empty stack
itself, so asking first would buy nothing but a round trip and a window for the answer to go stale.

> An earlier draft of this design had the empty stack produce nothing at all, on the reasoning that
> Ctrl+Z with nothing to undo is not a mistake and should not flash like one. That was revised in
> review: a press that produces no response at all is indistinguishable from a dead key or a
> shortcut that never registered, which is a worse failure than the one the silence avoided. The
> distinction the silence was protecting is now carried by the wording instead.

Both bindings are declared in the shared hotkey registry for **both views**, so the cheat-sheet
lists them without being told twice, and they are suppressed exactly as every other view binding
is — inside a text field, where Ctrl+Z means the field undo the browser already gives, and behind
any modal or inline editor, through the same input-capture registry. `Ctrl+Y` is a hidden alias of
the redo binding: dispatchable, but not a second cheat-sheet row.

## Sources, and not undoing undo

Every entry carries the **source** of its write. An MCP write is journaled but never enters the
user's stack: an agent setting a `beads_id` is not something the user did, and Ctrl+Z reversing it
would be indefensible. The journal stays a faithful history; the stack is a history of *the user*.
The source is an enum rather than a boolean and the column carries no CHECK constraint, so a third
source later is a code change and not a migration.

Applying an undo or a redo is itself a write, and would be caught by the same triggers. The journal
therefore carries a **suppression** flag the undo path sets for the duration of its own
transaction. Both the flag and the source live in a single ambient row every connection shares; what
makes that safe is that setting either is a write, so the transaction that sets it holds SQLite's
single writer lock until it commits.

The database runs in **WAL** journal mode, which leaves that argument standing. WAL changes how a
reader and a writer coexist — a reader takes a snapshot instead of waiting — not how two writers
do: SQLite still admits one write transaction at a time, database-wide, and that is the whole of
what the flag relies on. No second write can be in flight to be journalled under someone else's
flag, and a concurrent reader is no loophole either — it reads the last committed snapshot, so it
sees the flag clear, and it writes no journal entries to mis-attribute in any case.

What did have to change is *when* the lock is taken. A transaction the session factory opens is now
**immediate**, holding the writer lock from its `BEGIN` rather than from its first write. Before
that, a transaction that read anything before setting the flag could be refused the upgrade to
writer outright — the failure `Arlesh-odd` reported. It is the same claim as above, made true from
one statement earlier.

The journal is truncated at startup and capped at a fixed number of gestures, so a long session
cannot grow it without bound. An ungrouped entry counts as one gesture for that cap.

## The two stacks

The Undo Stack and the Redo Stack live in **backend memory**, one pair for the whole application,
beside the session factory — not in the frontend, which has several views onto one board and would
give each of them a private history, and not in the database, which would outlive the session they
are scoped to. Launching Arlesh is an empty history; nothing has to clear them.

A Gesture reaches the Undo Stack when `close_gesture` ends it, carrying **only its `user` journal
entries**. The filter is per entry rather than per Gesture, because the ambient context is one row
for the whole application: an agent writing while the user's Gesture happens to be open is
journaled under that Gesture's id, and the `source` column is what tells the two apart. A Gesture
that wrote nothing the user can undo never reaches a stack at all, so a press is never spent on a
step with no effect.

**Undo** takes the Gesture on top of the Undo Stack and applies the inverse of each of its entries
in reverse order — the inverse of an insert is a delete of that row, of a delete an insert of the
before image at its **original rowid**, and of an update a write of the before image back over
every column — then moves the Gesture to the Redo Stack. **Redo** does the same in the other
direction. Restoring by rowid is why the feature is row-level rather than command-level: a deleted
goal that comes back at a new id comes back as an orphan, with its children, tags, dependencies and
block reasons pointing at nothing.

It is **one transaction**, with journalling suppressed and foreign keys deferred to the commit. The
deferral is what lets a subtree be rebuilt in whatever order it was taken apart — what has to hold
is the end state, not every step towards it — and a violation that is real still fails at the
commit and rolls the whole thing back. There are exactly two outcomes: the Gesture is applied
whole, or nothing changed and the user is told which Gesture could not be applied, with it still on
the stack to try again.

**A new user Gesture empties the Redo Stack**, so redo can never reapply rows onto a board that has
moved on. An MCP write does not, because it never enters either stack.

Undo with an empty stack is a **silent no-op**, not an error: a keystroke with nothing to act on is
not a mistake the user made. `undo` and `redo` return what they applied, or nothing; `undo_status`
reports what each press would do so a control can be labelled and disabled, and is never a
precondition for calling them.
