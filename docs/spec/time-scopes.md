# Time Scopes & Planning

*One area of the [Arlesh design specification](../../SPEC.md).*

## The day boundary

**A Day runs 02:00 → 02:00, and the whole ladder runs with it.** Season, Month, Week and Day all start and end at 02:00 local wall-clock: a Week is Sunday 02:00 to the next Sunday 02:00, a Month the 1st at 02:00 to the next 1st at 02:00. Only the canonical kinds are defined this way; a Part of Day keeps its own band and an Exact scope its own two datetimes.

The reason is containment: **a scope contains exactly its own parts.** Night runs 22:00–02:00 and belongs to the Day it starts on, so a Day ending at midnight did not contain its own Night — for the two hours after midnight the part-of-day model said "still yesterday" while the Day scope said "already today", and everything derived from Day bounds (habit iteration generation and archival, Timing, Resolution, Archival, every *is this in scope now* test) turned over at midnight while the parts said the day had not ended. 02:00 is not a new seam: it is where Night already ends and Premorning already begins.

Moving only the Day was rejected. It removes the contradiction at the Day boundary and reproduces it at the Week boundary — Saturday's Night would run two hours into Sunday's week while belonging to the old one. One rule, applied to every canonical kind, is the point.

Two consequences worth stating plainly:

- **"Today" at 00:30 is the previous calendar date.** The Day that is still running began yesterday, so that is the Day scope an item is planned into, the cell the Scope Picker outlines, and the date a new Recurrence starts on by default.
- **Nothing is stored differently.** A canonical scope is named by its start date and derives its interval on read; only an Exact scope names datetimes. See *Scopes are derived* below.

## The week across New Year

**A Week runs Sunday to Saturday and is never split.** A week that spans 31 December to 1 January is one scope, part in each year.

Its **label** is `Week N YYYY`, where N is `week_number()` (`src-tauri/src/scopes/rules/derive.rs`) of the week's **Sunday**: 1-based Sunday-to-Saturday weeks counted from 1 January of that Sunday's year, so a year runs to week 53, or 54 when a leap year starts on a Saturday. A week that spans New Year therefore always reads **"Week 53 YYYY"** (or 54) — the year it starts in. It used to depend on which of its days was touched first, because the label was stored on a row created from that day; a derived scope has only its Sunday to go on. Whether it *should* read "Week 1 YYYY+1" instead is `Arlesh-8zf`, still deferred.

## Scopes are derived

**A scope is never stored.** Season, Month, Week, Day, Part of Day and Exact windows alike are computed from their value on every read — label, dates and bounds are arithmetic over the kind and the start date, the band of a Part of Day, the two datetimes of an Exact window. Nothing is written when a view, a Habit's iterations or the MCP snapshot needs a scope nobody has used before. See ADR 0009.

**A scope's id is its value key**, a small JSON object tagged by `kind` that names the scope's own start:

| Kind        | Key                                                                         |
|-------------|-----------------------------------------------------------------------------|
| Season      | `{"kind":"season","date":"2026-09-01"}` — the season's first day            |
| Month       | `{"kind":"month","date":"2026-09-01"}` — the month's first day              |
| Week        | `{"kind":"week","date":"2026-09-20"}` — the week's Sunday                   |
| Day         | `{"kind":"day","date":"2026-09-23"}`                                        |
| Part of Day | `{"kind":"part_of_day","date":"2026-09-23","part":"morning"}` — the day the band starts on, then the band |
| Exact       | `{"kind":"exact","start":"2026-09-23T14:00:00","end":"2026-09-23T15:30:00"}` — half-open start and end, whole seconds |

A key that does not name its own start — a week keyed by a Wednesday — is refused, not snapped; so is an Exact window that does not end after it starts. Finding the scope *containing* a date is a separate operation. Keys travel as JSON objects on the wire and are stored as their **canonical text** — `kind` first, the fields in the order above, no whitespace — which is produced in one place on each side and re-derived from the parsed value on every write, so comparing the stored text compares scopes. Every column and wire field that references a scope holds this key, which is why a Task's window reads as dates in a database dump or an MCP snapshot without resolving anything.

**The calendar conventions are code.** Sunday-start weeks, December–February Winter and the 02:00 day boundary are applied at read time, so changing one would reinterpret every past window at once rather than only new ones. They are constants; making any of them configurable means revisiting ADR 0009.

## Time Scope (relevance)

Every Task and Goal has an optional **Time Scope** — the window during which it is relevant. It takes one of two forms:

- **Boundaries** — an explicit start and end Scope of the same kind, forming an inclusive range (e.g. W33–W35, or a single scope used as both endpoints). An endpoint may be an exact datetime, in which case the other endpoint must also be supplied.
- **Duration** — a start anchor (defaulting to the current scope) plus a length of N of a scope kind.

Both forms resolve to a concrete inclusive `[start, end]` window. For a standalone item the Duration form is **snapshotted** to a fixed window at save time, while persisting its duration parameters (anchor, N, kind) so views and edits stay duration-shaped. (Inside Flow templates the Duration/cycle scope instead stays *relative*; see *Flows*.)

A **null** Time Scope means *inherit the nearest scoped ancestor's window*. An item is truly **Unscoped** (always active) only when no ancestor is scoped.

An item is **active** when its (own or inherited) Time Scope is active.

### On-exit behavior (Timing, Resolution, Archival, and the Overdue flag)

Configuring an explicit Time Scope also sets an explicit **On-exit behavior** — how an unfinished item is treated once its window has fully passed, and so what its default **due** is (see [*Due scope and the Overdue flag*](#due-scope-and-the-overdue-flag) below):

- **Keep Overdue** → the item stays live with **no Resolution**, and its default due is its Time Scope, so once the window has passed unfinished it is flagged **Overdue**. (Called **Keep** until 2026-09-30, when Overdue stopped being a Resolution; see below.)
- **Archive** → the item's Resolution reads **Missed** and it is archived. Its default due is none, so it is never Overdue unless a due was set on it explicitly — and not even then once its lapse has archived it. This is the single-occurrence form of a Habit's **Consumption** root (Archive = Destructive, Keep Overdue = Accumulating).

The value is present **iff** the item is explicitly scoped (a DB invariant); an inherited-scope item inherits the ancestor's behavior along with its window. **Keep Overdue is still stored and sent as `keep`** (the database column, the IPC and the MCP's `on_scope_exit`): only its label changed, so renaming the value would have cost a migration that rewrites every scoped row and a wire change for every client, for no difference in meaning.

Three independent axes and one flag, all **derived** on read — a pure function of `(effective window, on-exit behavior, due, status, now)` in local wall-clock, never a stored-status mutation, and all auto-reverse if the scope is later widened:

- **Timing** — the item's window position: **Pending** (before its window), **Active** (within its window, or Unscoped), or **Lapsed** (window has fully passed). Purely about window position, independent of whether the item is finished. It reads the **effective** window, so an item with no window of its own is Pending while its nearest scoped ancestor's window has not begun — it is not in scope yet, in the same sense that a Lapsed one is no longer in scope (ruled by the user, 2026-09-27). The **Start** preset hides a Pending item exactly as it hides a Lapsed one (see [*Mindmap*](mindmap-view.md)). An **Expectation** is the one kind whose window is its own: with none, it is Pending while the window of what it hangs under has not begun, and otherwise Active — never Lapsed for that window passing, since a wait outlives the work it hangs under (see [*Expectations*](resources.md)). A wait's check task is timed by the Day its check fell due, which has always begun, and a Habit occurrence by its own window, as before.
- **Resolution** — how a lapse **settled** the item, and so only ever present once Timing is **Lapsed**: **Completed** (the item was Done/Achieved by the time its window lapsed) or **Missed** (unfinished, Archive-on-exit). An **unfinished Keep Overdue item whose window has lapsed has no Resolution** (ruled with the user's 2026-09-30 split of Overdue out of the axis): the lapse settled nothing — the work is still open, still live, and carries the **Overdue** flag instead. Absent Resolution on a Lapsed item therefore reads *unfinished and kept*, exactly as absent Resolution on an Active item reads *not over yet*.
- **Archival** — the item's *effective* archived/frozen/live state, driving the status row's archive-box badge (see [*Mindmap*](mindmap-view.md)) and the Mindmap's **Archived** filter ([Filtering Logic](filtering-logic.md)). Every item may carry a manually-set Archival of its own: a Goal/Project through its status (**Frozen** / **Archived**), a Task through its stored Archival — **Backlog**, or **Archived** by hand (Task 269; see [*Archive*](resources.md#archive)). A **Commitment** carries a hand archive too, beside the Archival derived from its Verdict and its **Verdict Window** (see [*Commitments*](resources.md#commitments)). **A hand archive is inherited**: everything beneath a Task or Commitment archived by hand reads as effectively **Archived**, on every board load, though nothing below it is written — so unarchiving it brings the subtree back as it was. A **wait** archives itself once released with its window passed, or at once when released with none (see [*Expectations*](resources.md)). A **Completed** or **Missed** Resolution unconditionally forces the *effective* Archival to **Archived** regardless of what is stored, even overriding a manually-set **Frozen** *or* **Backlog**; when it does, the status-row badge flags the resulting **conflict**. No Resolution forces nothing: a lapsed Keep Overdue item stays whatever is stored. Backlog and Frozen lose to a forced Archived on identical terms — chosen deliberately over letting Backlog win, so that setting a scoped Task aside does not quietly exempt it from its own window.

- **Overdue** (a flag, not a Resolution) — the item is **unfinished**, its effective Archival is **not Archived**, and **now is past the end of its due**. A **delegated** Task can be Overdue: delegation has its own pill in the filters and is not the Archival axis, and work someone else holds can still be late. Anything archived by hand, or beneath a hand archive, is never Overdue. So can a **Backlogged** Task that carries an explicit due. Timing and the flag are independent: a due ends at or before the window's end, so an Active item can already be Overdue.

A Task's Done status and a Goal's Achieved status are themselves untouched by any of this — Resolution and Archival are additive, derived layers on top, not a replacement. (Formerly, a resolved item was exempt from all of the above — the deliberate goal **Archived** status and scope-Lapsing were treated as unrelated concepts. They're now unified: any scoped item whose window has passed, resolved or not, is effectively archived.)

### Due scope and the Overdue flag

Ruled by the user, 2026-09-30 (Task #243, part 1 of #241).

A **Task** has an optional **due scope** — its **due**: the window whose end makes it **Overdue**. Only its end matters to the flag; it is stored as a Plan is, a start and an end scope key (`due_scope_start_id`, `due_scope_end_id`, migration 0085), equal for a single scope, and travels as `due_scope`, the Time Scope shape without a duration.

**The due is derived unless set.** In order:

1. **An explicit due** set on the Task wins.
2. Otherwise a **backlogged** Task has **none**: work deliberately set aside is not late. An explicit due still holds on one.
3. Otherwise the due follows the **effective On-exit behavior**, inherited with the window: **Keep Overdue** makes the **effective Time Scope** the due; **Archive** leaves none; an Unscoped item has none.

So a **child** with no window of its own derives its due from the window it inherits, under the on-exit value it inherits with it; a child with its own window derives its due from that. A parent's *explicit* due is not inherited — only its window and on-exit are. A **Goal** has no explicit due; it takes only the default, which keeps a Keep Overdue Goal flagged Overdue past its window as it was before. A **Commitment** is never Overdue: it is judged by its Verdict. A **wait** is judged against its own window — a pending wait whose window has passed is flagged Overdue, with no Resolution, and a released one whose window has passed archives itself — and so is a wait's check task, whose window is the day it fell due. A **Habit occurrence** takes its default due from its Habit's **clock** (Task #245, see [*Clocks*](habits.md#clocks)): Window + Archive none; Window + Owed its own window; Window + Overdue its own window, or the first missed window for the iteration carrying a run of missed ones; Interval its window, none when Unscoped. An explicit due set on the occurrence lands in its overlay and wins, held within the occurrence's relevance; a backlogged occurrence has no default, as a backlogged Task has none.

**`Due ⊆ Time Scope`, at write time.** An explicit due must lie within the Task's **effective** Time Scope — its own window, else the nearest scoped ancestor's — checked with the other containment rules on every create and update, against the Task as the write leaves it: a write that narrows the window past its due is refused (`due is not within the task's time scope`) until the due moves or is cleared with it. An **Unscoped** Task, with no window above it either, may carry a due of its own, unbounded. The check is the Task's own write's; narrowing an **ancestor's** window does not yet re-check a descendant's explicit due, which then simply stays where it was (the clamp prompt offers Time Scopes only).

**Every consumer of the old Overdue Resolution now reads the flag.** The derivation (`tasks/rules/lifecycle.rs`: `effective_due`, `derive_overdue`) sends it on each lifecycle entry as `overdue: true` (omitted when false), beside `resolution`, which can now only be `completed` or `missed`:

- the **Plan exemption** — the backend's containment check, the Task editor's Plan picker, the `P` quick picker and the Plan View's pre-check (see *Containment invariants* below);
- the **amber overdue border** (`--overdue`) — the one sign of Overdue on screen, drawn on every Overdue item in every view: the Mindmap node, the List View row, and the Steps, Plan and Zen View cards (ruled by the user, 2026-09-30: "leave the amber border everywhere"; in Zen it can be turned off, see [*Zen View*](zen-view.md), and so can it in the List View, see [*List View*](list-view.md)). The status-icon row's red exclamation that used to flag it too was removed ("border is enough"). The List View's is the row's whole border, not a stripe: a List row is a bordered, rounded card of its own with space between rows and no separator lines, so a full border does not crowd anything, and it reads the same as the Mindmap's and the cards'. **Against the other outlines:** the selection wins over the amber everywhere, but an item **both selected and Overdue** draws its selection in a colour of its own, `--overdue-selected` — a brighter amber in the dark theme, a vivid orange in the light one, apart from both the ordinary selection accent and the unselected amber — so it still reads as the selection without losing the one sign that it is Overdue (ruled by the user, 2026-09-30, first for the Mindmap, then for every view). Each view keeps its own selection treatment and changes only its colour: the Mindmap's 2px stroke, the List row's and Zen card's border and outer ring, the Steps card's border and inset ring, the Plan card's border. The rule lives in two halves, one per rendering technology: `nodeStrokeColor` (`src/utils/node-visuals.ts`) for the Mindmap's SVG stroke, and `src/styles/overdue-outline.module.css` for the HTML cards, whose Overdue class sets a `--card-selection` variable each card's selection rule reads. In Zen, with the border switched off, a selected Overdue card takes the ordinary selection colour; a drag's drop-target accent wins over the amber on the Mindmap; the hover highlight of a List row or a Zen card shows over it while the pointer is there; blocked (a glyph) and the focus exemption (dimming) draw no outline and simply combine with it. Because colour is now the only visible signal, every Overdue item also says **Overdue** in its accessible description (`aria-describedby`), in every view, whether or not the border is drawn;
- the List View's **Overdue** scope-state filter token, which the flag now earns ahead of Unscoped / Active / Lapsed — an Unscoped Task past a due of its own, or a scoped one past a due inside its open window, reads Overdue;
- the **MCP** snapshot's `lifecycles` section, and each Task's `due_scope` in the snapshot and `arlesh_tasks.get`. `arlesh_tasks.create` and `update` write `due_scope` (`null` on update clears it back to the default).

The **presets**: Plan shows an Overdue item because it is not archived. **Start shows Overdue items** (ruled by the user, 2026-09-30; Task #244): it reads the flag and keeps an Overdue item although its window has lapsed, where it used to hide every Lapsed one by its Timing; a Task Overdue by an explicit due inside its still-open window shows there as any item in its window does. Blocked, backlogged and delegated items, a Task rescheduled into a Plan still ahead, and Missed ones (never Overdue) still drop — see [*Mindmap*](mindmap-view.md). Under Start the List View also gathers Overdue work into an **Overdue section** at its top, and its amber border can be switched off on the List page — see [*List View*](list-view.md). The "W2 from W1" label is #245's.

**The editor.** The **Due** field is a Plan-shaped picker held to the Task's effective Time Scope, with **Clear** to go back to the default and a summary naming that default while there is no explicit due — *The time scope (default)* under Keep Overdue, *None* under Archive, while backlogged, or unscoped. Where it sits depends on whether the Task has a window of its own (ruled by the user on review, 2026-09-30, over two rounds: a row of its own below the Plan throughout, then back beside the pills whenever a Time Scope is set):

- on a Task with a Time Scope of its **own**: **beside the Keep Overdue / Archive pills**, on their row under the Time Scope, held to that window — no row of its own;
- on an **Unscoped** Task — one with no window of its own and none above it — **its own row, directly below the Plan**, unbounded. There are no pills there to sit beside, since an Unscoped Task has no window to exit, and its due is the only thing that can make it Overdue;
- on a Task that **inherits** its window, it derives its due from it, so the field is hidden — unless the Task already carries an explicit due, when it shows as **its own row below the Plan**, held to the inherited window, so the due can be seen and cleared;
- on a **Habit occurrence**, **always** — beside the pills when it carries a window of its own, else its own row below the Plan — naming *By its Habit's clock (default)*, since its default comes from its Habit's clock rather than its on-exit (see [*Clocks*](habits.md#clocks));
- **not at all** on a wait's **check task**, whose window is the day it fell due.

## Plan (scheduling)

A **Task** (not a Goal) may be **planned** into a single Scope. The Plan must be wholly contained within the task's Time Scope (the same scope or a subscope) — unless the task is **Overdue** (below).

### Plan inheritance

Ruled by the user, 2026-10-03 (Task `065b`). It replaced an interim, filter-only rule (`Arlesh-zwm` / `Arlesh-67y`) under which only the Start preset read an unplanned Task by its nearest planned ancestor Task's Plan.

**The effective Plan.** A Task with a Plan of its own reads it. One without reads the Plan it **inherits**: its parent's effective Plan, **clipped to its own Time Scope**. So it is the nearest planned node's Plan above it, narrowed by every window in between. It is derived on every load and never stored, as an inherited Time Scope is. Setting an own Plan overrides it. There is **no opt-out**: no "deliberately unplanned" state; a Task has its own Plan or inherits one, and is unplanned only when nothing above it is planned either.

- **The chain climbs through everything.** Goals, Commitments, Projects and Domains carry no Plan and pass the one above them down, a Goal's or a Commitment's own window clipping it on the way. **Waits** pass it down too, unclipped, and a wait's **check task inherits fully**: its window is the day its check fell due, not a relevance anyone chose, so it does not clip what it inherits. The user accepted the consequence: Start hides a check due today under a Task planned ahead ("Inherit fully").
- **Clipping.** A Plan inside the window is kept as it is, and a window inside the Plan is taken. A partial overlap reads as a range of Days when both ends fall on the 02:00 day boundary, which every canonical scope does, and otherwise as the two scopes whose ends bound it. An **Overdue** Task does not clip: its Plan may leave its window (see *The Overdue exemption* below), so the one it inherits may too.
- **Empty.** When the inherited Plan and the Task's own window do not meet, it reads no Plan, and is flagged.

**Every reader uses it.** The rule is one pure function in the rules layer (`tasks::rules::plan_inheritance`), read over the whole board on every load (`mindmap::rules::plans`) and sent with the board's facts (`inherited_plan`, `plan_source`, `plan_source_short_id`, `plan_conflict`). The frontend keeps no copy of it. What reads it:

- **Start** reads where the effective Plan stands, which the backend derives onto each Task's lifecycle (`plan_timing`) — see [Filtering Logic](filtering-logic.md);
- the List View's **planned / unplanned** scope-state pill;
- the [Plan View](plan-view.md), which places a Task by its effective Plan;
- the **badges**: a calendar badge for an own Plan, and a **fainter** one for an inherited Plan, whose tooltip names where it comes from;
- the **Task editor**: its Plan field shows an inherited Plan read-only, with its source's short id ("W41 — inherited from 9e3"), beside the control that sets an own Plan; the picker is held to the inherited Plan;
- the **MCP**, which carries both: a Task's `plan` is its own, `effective_plan` the one it reads, with `plan_inherited_from` naming the source (see [MCP Server](mcp-server.md)).

**Containment.** A Task's own Plan must sit inside the Plan it inherits — its parent's effective Plan clipped to its own window — and nothing may be left with an **empty** effective Plan. A write that breaks either is **refused, naming the Tasks**, and nothing of it is kept. A write can break a rule below the row it touches, so after the write, inside its transaction, the backend reads the board's plan rules once (`mindmap::plan_guard`) and refuses any rule broken within the write's **reach**: the nodes it wrote, everything beneath them, and the Habits hung there — the only nodes whose effective Plan it can have changed. The board holds no violation to begin with (the user cleared the only ones before this shipped, 2026-10-03), so whatever the check finds there is the write's own. That covers:

- a child's own Plan outside the one above it;
- narrowing a child's window away from the Plan it inherits;
- narrowing or moving a parent's Plan away from a child's window, or past a child's own Plan;
- moving a Task under a planned node it does not fit;
- narrowing a Goal's or a Commitment's window between them;
- a Habit's template or recurrence that would put its occurrences outside (see [Habits](habits.md#plan-inheritance)).

The writes it guards are a Task created with a Plan or a window; a Task's Plan, window or place changed; a Goal's or a Commitment's window or place changed; and a Habit's Flow, recurrence or cycles edited. A status change is not guarded, though finishing an Overdue Task makes its window clip again.

**A violation that arises outside the writer is flagged.** A few things change a Plan's reading without passing the guard: a status change (finishing an Overdue Task makes its window clip what it inherits again), an undo or redo, which replays rows as they were, and data written outside the app. So the board still checks every load: a Task breaking a rule draws its calendar badge in the danger colour, the editor says which rule under its Plan field, and the MCP carries `plan_conflict` (`parent_plan` or `empty`). Nothing is rewritten. Any later write whose reach covers it — its own, or its parent's — must leave it resolved, or is refused. A read-only copy of the user's board, taken 2026-10-03, held three: Tasks 188, 189 and 190, planned into October under a parent (187) planned into the week of 4 October. The user fixed those before this shipped.

**The clamp-or-cancel prompt.** Narrowing or moving a Task's Plan, when Tasks below hold their own Plans that the new one would leave outside, gets the prompt Time Scope uses, before anything is written. The writers that ask are the editor's Save, the `P` quick picker and the Plan View. It names those Tasks, nearest first, and offers three ways on:

- **Clamp**: each is planned to the part of its own Plan inside the new bound, or to the bound itself where they do not meet;
- **Clear**: each has its Plan cleared, and inherits;
- **Cancel**.

The backend works the list out (`plan_containment_conflicts`), each one read as if the ones above it had been clamped already. The answer rides the write (`update_task_settling_plans`), which settles them in the same transaction after the parent: **one Gesture, one Ctrl+Z**. Only that write reads the board before writing, to know what to settle; every guarded write reads it once after. A batch is asked once, over every Task it would leave outside. An **empty** effective Plan is not offered: clamping cannot fix a window, so the write is refused, naming the Tasks. The MCP has no prompt: such a write is refused there.

## Containment invariants

Evaluated as interval containment on resolved datetime boundaries:

- `Plan ⊆ TimeScope`
- `child.TimeScope ⊆ parent.TimeScope`
- `child.Plan ⊆ parent.Plan`: a Task's own Plan within the Plan it inherits, its parent's effective Plan clipped to its own window (see *Plan inheritance* above), and no Task with an empty effective Plan
- `Due ⊆ TimeScope` — an explicit due, within the effective window (see *Due scope and the Overdue flag* above)

**The Overdue exemption** (ruled by the user, 2026-09-26; re-keyed onto the flag 2026-09-30). `Plan ⊆ TimeScope` does not bind a Task flagged **Overdue** — unfinished, not effectively archived, and past the end of its due, judged over its **own** window on the task as the write leaves it at the moment of the write. Under the default due that is exactly the old rule: its own window has fully passed, it is not Done, and it is Keep Overdue. With an explicit due it holds from the due's end, which may be inside the window: work that is late needs rescheduling whether or not its window has closed. A due that has passed can only refuse now and later, which is exactly where overdue work has to be rescheduled to. The exemption lifts that one bound and nothing else: the task's **Time Scope is not changed or widened** (a window is an editing decision), `child.TimeScope ⊆ parent.TimeScope` still holds, and so does `child.Plan ⊆ parent.Plan` — an overdue task is planned inside the Plan it inherits like any other (an Overdue task does not clip that Plan to its passed window). A task that lapsed **Done** (Completed) or **Missed** is not exempt. A **Habit occurrence** flagged Overdue by its Habit's clock or its own due is exempt as a Task is (Task #245): its Plan may leave its window; one that is not Overdue stays within its window. Only a task's **own** Time Scope bounds its Plan in the first place, so an inherited window has nothing to lift. Descendants stay coherent without a rule of their own: a child's own window sits inside the overdue parent's, so an unfinished Keep Overdue child is Overdue too and may follow its parent into a later Plan, while a Done child keeps its window's bound. The backend lifts the bound on the way in, and the [Plan View](plan-view.md)'s pre-check and the Task editor's Plan picker lift it with it.

**Enforcement:** a local edit that exceeds a bound (a child or Plan set too wide) is rejected at write time. A parent-narrowing or reparent that would orphan descendants prompts the user to *clamp descendants to the intersection* or *cancel*. For Plans the prompt also offers to *clear* the descendants' Plans so they inherit, and a write that would break a plan rule anywhere on the board is refused, naming the Tasks (see *Plan inheritance* above). Both prompts are drawn **once, at the root of the app**, and asked from whichever view the write starts in — the Mindmap, the List View, the Plan View or the Steps View, from an editor or a drag. Until 2026-10-03 the Time Scope prompt was drawn by the Mindmap alone, so a narrowing saved from the List View or the Plan View waited on a prompt nothing showed, and the save never finished (fixed with Task `065b`).

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

**Clear** is the only way to remove a Time Scope or a Plan. It sits in the field's summary row beside the edit button, shown only when there is a value to remove, and asks for no confirmation: nothing is written until the editor is saved, and a saved clear is undone with Ctrl+Z.

### The quick Plan picker (`P`)

Bare **`P`** on the Mindmap, the List View and the Steps View sets the selected Task's Plan **without opening the editor** (ruled by the user, 2026-09-27). It opens **the same Scope Picker** the editor's Plan field uses, as a small popover drawn at the selected node, row or card, and it opens the same way — on the stored Plan, seeded with it, and held to the Task's Time Scope, except an **Overdue** Task's, whose Plan may leave its passed window. It opens with the keyboard in its grid (see [*The keyboard*](#the-keyboard) below): the arrows move the highlight, **Space** picks, **Enter** steps into a scope. **Ctrl+Enter**, the Apply button or a click outside applies the selection, and with nothing selected just closes; **Esc** closes and writes nothing; **Clear**, offered while there is a Plan to remove, removes it. Plain Enter is not an apply here, because it drills in. While it is open it holds the keyboard, so the view's own letters stay quiet.

The pick is written exactly as the editor's Save writes a Plan — `update_task` with the new `plan`, one Gesture, one Ctrl+Z — so every rule above holds unchanged: `Plan ⊆ TimeScope` (Overdue excepted), `child.Plan ⊆ parent.Plan`, a Habit occurrence's Plan landing in its overlay, and a backlogged Task coming **out of the Backlog**, which a toast names. A refusal comes back from the backend and is shown as a toast carrying its reason.

- **Only a Task holds a Plan** — a stored Task or a Habit occurrence. Any other node, a wait's drawn check task, a folded run of Habit history, or the Steps View's board card is **refused by name** in a toast rather than the key going quiet.
- **A Mindmap multi-selection is planned whole**, in one Gesture: the picker is drawn at the selection's lead, opens on the lead's Plan and is held to the lead's Time Scope, and the pick is written to every Task in the selection. Selected nodes that hold no Plan are left alone and **counted in the toast**; a Task the backend turns away does not take back the ones it accepted, and the toast counts it too — the Plan View's batch rule. The List View and the Steps View select one row or card at a time.
- **Not in the Plan View.** There bare `P` already means *fill parts of the day* with nothing selected and *plan into the P-initialled subscope* (Premorning) with a selection; planning is what that view's own keys do.

### The keyboard

Every Scope Picker — the editors' Time Scope and Plan fields, the top bar's Plan scope, the `P` quick picker — answers the same keys while the focus is in it (ruled by the user, 2026-09-27). The grid holds the focus and a **highlight** marks one of its cells; the keys are declared once (`src/utils/hotkeys/scope-picker-keys.ts`), which is also what the cheat-sheet's *Scope pickers* section lists.

- **← → ↑ ↓** move the highlight over the cells as the grid draws them (four to a row), stopping at the edges. It starts on the selection, else on the current period, else on the first cell; a cell the Time Scope rules out can be walked over but not picked.
- **`[` / `]`** show the previous / next period and **`\`** goes up one level — the Plan View's own scope keys, meaning the same here. Going up lands the highlight on the cell you came out of; stepping a period keeps its place in the grid.
- **Space** picks the highlighted cell, exactly as a click does: in a range picker the first pick starts a range, the second closes it, a third starts a new one.
- **Enter** steps *into* the highlighted cell, as a double-click does (a month → its weeks, a week → its days). At parts of the day there is nothing further in, and it does nothing.
- **Ctrl+Enter** applies, where the picker has an Apply (the Time Scope and Plan fields, the quick picker).
- **Esc** belongs to whatever holds the picker: the quick picker closes, an editor closes itself.

While the focus is in a picker it claims `[` `]` `\` and `Ctrl+Enter` (and every arrow, Enter, Space and Esc) from the view's own bindings, through the same `data-owns-keys` mark the Filter menu uses — so in the top bar, `]` browses the picker instead of stepping the Plan View's scope.

### Current period

The cell holding the present is outlined. In every view but parts of day that is the cell whose dates contain **the current Day** — which, by the 02:00 boundary above, is the previous calendar date between 00:00 and 01:59. A part of day is a function of the instant, the displayed date **and** the part: exactly one part is current, and only on the date that part belongs to. Because Night runs 22:00–02:00 and belongs to the day it starts on, between 00:00 and 01:59 the current part is the **previous** calendar date's Night — on the date the clock reads, no part is outlined at all.

---
