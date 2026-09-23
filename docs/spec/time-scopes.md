# Time Scopes & Planning

*One area of the [Arlesh design specification](../../SPEC.md).*

## The day boundary

**A Day runs 02:00 → 02:00, and the whole ladder runs with it.** Season, Month, Week and Day all start and end at 02:00 local wall-clock: a Week is Sunday 02:00 to the next Sunday 02:00, a Month the 1st at 02:00 to the next 1st at 02:00. Only the canonical kinds are defined this way; a Part of Day keeps its own band and an Exact scope its own two datetimes.

The reason is containment: **a scope contains exactly its own parts.** Night runs 22:00–02:00 and belongs to the Day it starts on, so a Day ending at midnight did not contain its own Night — for the two hours after midnight the part-of-day model said "still yesterday" while the Day scope said "already today", and everything derived from Day bounds (habit iteration generation and archival, Timing, Resolution, Archival, every *is this in scope now* test) turned over at midnight while the parts said the day had not ended. 02:00 is not a new seam: it is where Night already ends and Premorning already begins.

Moving only the Day was rejected. It removes the contradiction at the Day boundary and reproduces it at the Week boundary — Saturday's Night would run two hours into Sunday's week while belonging to the old one. One rule, applied to every canonical kind, is the point.

Two consequences worth stating plainly:

- **"Today" at 00:30 is the previous calendar date.** The Day that is still running began yesterday, so that is the Day scope an item is planned into, the cell the Scope Picker outlines, and the date a new Recurrence starts on by default.
- **Nothing is stored differently.** A canonical scope row stores its inclusive `start_date`/`end_date` as dates and derives its interval on read; only an Exact scope stores datetimes. Every existing row keeps its date and simply resolves to a window shifted two hours later — no migration, no backfill.

## The week across New Year

**A Week runs Sunday to Saturday and is never split.** A week that spans 31 December to 1 January is one scope, part in each year.

Its **label** is `Week N YYYY`, where N is `week_number()` (`src-tauri/src/scopes/mod.rs`) of the **date that created the row**: 1-based Sunday-to-Saturday weeks counted from 1 January of that date's year, so a year runs to week 53, or 54 when a leap year starts on a Saturday. A week that spans New Year therefore reads **"Week 53 YYYY" or "Week 1 YYYY+1"**, depending on which of its days was touched first. That dependence is known and deliberate for now; re-examining it is `Arlesh-8zf`.

## Time Scope (relevance)

Every Task and Goal has an optional **Time Scope** — the window during which it is relevant. It takes one of two forms:

- **Boundaries** — an explicit start and end Scope of the same kind, forming an inclusive range (e.g. W33–W35, or a single scope used as both endpoints). An endpoint may be an exact datetime, in which case the other endpoint must also be supplied.
- **Duration** — a start anchor (defaulting to the current scope) plus a length of N of a scope kind.

Both forms resolve to a concrete inclusive `[start, end]` window. For a standalone item the Duration form is **snapshotted** to a fixed window at save time, while persisting its duration parameters (anchor, N, kind) so views and edits stay duration-shaped. (Inside Flow templates the Duration/cycle scope instead stays *relative*; see *Flows*.)

A **null** Time Scope means *inherit the nearest scoped ancestor's window*. An item is truly **Unscoped** (always active) only when no ancestor is scoped.

An item is **active** when its (own or inherited) Time Scope is active.

### On-exit behavior (Timing, Resolution, and Archival)

Configuring an explicit Time Scope also sets an explicit **On-exit behavior** — how an unfinished item is treated once its window has fully passed:

- **Keep** → the item's Resolution reads **Overdue**.
- **Archive** → the item's Resolution reads **Missed**. This is the single-occurrence form of a Habit's **Consumption** root (Archive = Destructive, Keep = Accumulating).

The value is present **iff** the item is explicitly scoped (a DB invariant); an inherited-scope item inherits the ancestor's behavior along with its window.

Three independent axes, all **derived** on read — a pure function of `(effective window, on-exit behavior, status, now)` in local wall-clock, never a stored-status mutation, and all auto-reverse if the scope is later widened:

- **Timing** — the item's window position: **Pending** (before its window), **Active** (within its window, or Unscoped), or **Lapsed** (window has fully passed). Purely about window position, independent of whether the item is finished.
- **Resolution** — only meaningful once Timing is **Lapsed**: **Completed** (the item was Done/Achieved by the time its window lapsed), **Missed** (unfinished, Archive-on-exit), or **Overdue** (unfinished, Keep-on-exit).
- **Archival** — the item's *effective* archived/frozen/live state, driving the status row's archive-box badge (see [*Mindmap*](mindmap-view.md)) and the Mindmap's **Archived** filter ([Filtering Logic](filtering-logic.md)). Every item may carry a manually-set Archival of its own: a Goal/Project through its status (**Frozen** / **Archived**), a Task through its **Backlog** flag (see [*Tasks*](resources.md)) — a Task is never manually **Archived**. A **Commitment** carries none at all: its Archival is derived from its Verdict and its **Verdict Window** (see [*Commitments*](resources.md)), and nothing about it is ever set aside by hand. A **Completed** or **Missed** Resolution unconditionally forces the *effective* Archival to **Archived** regardless of what is stored, even overriding a manually-set **Frozen** *or* **Backlog**; when it does, the status-row badge flags the resulting **conflict**. **Overdue** never forces anything: the item stays whatever is stored. Backlog and Frozen lose to a forced Archived on identical terms — chosen deliberately over letting Backlog win, so that setting a scoped Task aside does not quietly exempt it from its own window.

A Task's Done status and a Goal's Achieved status are themselves untouched by any of this — Resolution and Archival are additive, derived layers on top, not a replacement. (Formerly, a resolved item was exempt from all of the above — the deliberate goal **Archived** status and scope-Lapsing were treated as unrelated concepts. They're now unified: any scoped item whose window has passed, resolved or not, is effectively archived.)

## Plan (scheduling)

A **Task** (not a Goal) may be **planned** into a single Scope. The Plan must be wholly contained within the task's Time Scope (the same scope or a subscope).

## Containment invariants

Evaluated as interval containment on resolved datetime boundaries:

- `Plan ⊆ TimeScope`
- `child.TimeScope ⊆ parent.TimeScope`
- `child.Plan ⊆ parent.Plan`

**Enforcement:** a local edit that exceeds a bound (a child or Plan set too wide) is rejected at write time. A parent-narrowing or reparent that would orphan descendants prompts the user to *clamp descendants to the intersection* or *cancel*.

## Scope Picker

Scopes are chosen in a calendar-like picker (date-picker-style). It can be bounded (e.g. can't browse outside a season when the item is season-scoped). Double-click descends into a scope (week → days); single-click selects. Three selection modes: **range** (first click = start, second = end, third resets; drag an endpoint to adjust), **single** (each click replaces; click selected to deselect), **multiple** (each click adds; click to remove — used for flow cycle scopes). Calendar views per kind: seasons (year of four squares), months (season of three / year of twelve), weeks (month grid, Sunday-start numbering), days (week of seven), parts of day (day → part), exact (clock, browsable days).

### Opening view

The picker opens on **the narrowest view that can display the scope it was given, showing the period that scope names** — a Day-scoped item opens on the day view, on that day's week; a Week, Month or Season scope opens on its own view, on its own period. The rules for the cases a single cell doesn't cover:

- **A range** opens at its endpoints' granularity, anchored on the earlier endpoint. The endpoints' own view is the only one that can draw the range, so a range is never widened to a coarser view to fit both ends on screen; the user browses instead.
- **Endpoints of different kinds** open on the coarser of the two views — the narrowest one that can display both.
- **An Exact window** has no view of its own; it opens on the day view, on the day holding its start.
- **No scope** (or a stored scope that names no cell) leaves the field's own default: Month for a Time Scope, Day for a Plan.

The opening view is derived from the scope every time the picker opens; nothing about the last view is remembered.

### Seeded selection

The picker opens with the scope it was handed **selected**, not merely shown: the cell the opening rule lands on is the cell Apply would commit. A picker opened on a scoped item and applied untouched therefore re-applies the scope that was already there.

- **A single scope** seeds both endpoints of the range on that one cell. **A range** seeds its two endpoints, earliest first. Either way a seeded range is **closed** — both endpoints set — so, by the third-click rule, the first click after opening starts a new range rather than extending the seeded one. There is no gesture that extends a stored range; you re-draw it.
- **Selected and current are different marks.** Selected cells fill solid; the cell holding the present is outlined. The opening view is not a mark of its own — it is only where the calendar sits, and the cell it lands on is drawn selected because it *is* the selection.
- **The span between seeded endpoints is tinted**, exactly as for a range the user just clicked. Endpoints of different kinds seed both cells but no span, because no view draws both; the picker opens on the coarser view and Apply still re-applies the window.
- **A value with a row that names no calendar cell seeds nothing.** Seeding the one drawable endpoint of a two-endpoint window would silently narrow it, so an undrawable window is left unanswered instead.
- **Re-opening re-seeds.** Cells clicked and then abandoned by closing the picker do not survive; each opening starts from the stored value again.

### Apply and Clear

**Apply** commits the selection and closes. An empty selection means *unanswered*, not *no scope* — Apply with nothing selected changes nothing. Once the selection is seeded that case is only reachable for an item that has no scope at all, or a stored scope that names no cell; it is a second guard on the same rule rather than a gesture with a meaning of its own. Apply never clears.

**Clear** is the only way to remove a Time Scope or a Plan. It sits in the field's summary row beside the edit button, shown only when there is a value to remove, and asks for no confirmation — the same call as the beads-id row in the editors: nothing is written until the editor is saved, and a saved clear is undone with Ctrl+Z.

### Current period

The cell holding the present is outlined. In every view but parts of day that is the cell whose dates contain **the current Day** — which, by the 02:00 boundary above, is the previous calendar date between 00:00 and 01:59. A part of day is a function of the instant, the displayed date **and** the part: exactly one part is current, and only on the date that part belongs to. Because Night runs 22:00–02:00 and belongs to the day it starts on, between 00:00 and 01:59 the current part is the **previous** calendar date's Night — on the date the clock reads, no part is outlined at all.

---
