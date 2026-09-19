# Arlesh — Design Specification

## Overview

Arlesh is a knowledge-base and task management desktop app integrating with Obsidian via the local-rest-api plugin. It is data-management-first: it manages resources and their linkages, with some resources corresponding to Obsidian notes.

**Primary focus:** task management as a first-class feature. Knowledge-base entity management supports filtering and sorting of tasks. Future directions include structured KB entity management and graph visualizations.

**Platform:** Cross-platform desktop-first native app (Tauri 2.0 + React + TypeScript). Mobile is a future nice-to-have; Tauri 2.0 supports iOS/Android via the same web frontend.

**Storage:** SQLite.

---

## Resources

### Domains

Domains are organizational containers for Tasks and Goals. A Domain has a title, description, and a nullable parent Domain.

There are four domain subtypes:

**Aspects** — six built-in, color-coded top-level domains. Not user-managed. Fixed roots of the domain tree.

| Name   | Color      | Focus                                                                 |
|--------|------------|-----------------------------------------------------------------------|
| Red    | Red        | Physical needs: health, physical pursuits                             |
| Purple | Purple     | Psychological needs: social activities                                |
| Green  | Green      | Fulfillment needs: hobbies, knowledge, creative/technical construction|
| Blue   | Blue       | Moral duty: activities for others, social activism                    |
| Gray   | Gray       | Flow-state needs: finance, cleaning, bureaucracy                      |
| Steel  | Light gray | Self-determination: introspection, goal-making, task management       |

**Projects** — large domains (hobby, habit, workplace, etc.). Parent must be an Aspect or another Project. May be linked to a knowledge-base directory. Status: **Active / Achieved / Frozen / Archived**. May carry a **beads id** (see *Beads id* below).

**Domains** — general-purpose organizational containers. Can parent Goals, Tasks, Tags, or other Domains.

**Tags** — flat leaf nodes used as resource markers. Each Tag has a title and a `domain_id` parent. Tags cannot parent other Tags. Tags appear in filtering as a first-class primitive.

### Knowledge Base

The knowledge base is externally managed (Obsidian). Arlesh manages specific note types as structured entities.

**People** — represent persons. Fields: name (= note title), aliases (list of strings), linked note. Person notes are discovered by recursively searching configured directories.

**Scopes** — time range entities. Not manually created; lazily instantiated on first reference and stored as rows. Canonical kinds:

| Kind        | Definition                                      |
|-------------|-------------------------------------------------|
| Season      | Three-month period (Autumn: Sep–Nov, Winter: Dec–Feb, Spring: Mar–May, Summer: Jun–Aug) |
| Month       | Calendar month                                  |
| Week        | Sunday–Saturday, custom 1–52 numbering (not ISO 8601) |
| Day         | Single date; corresponds to an Obsidian note at `{yyyy}/{mm MMMM}/{yyyy-mm-dd}.md` |
| Part of Day | Sub-day band: Morning (06–12), Noon (12–15), Afternoon (15–18), Evening (18–22), Night (22–02), Premorning (02–06). Start inclusive, end exclusive. |

Beyond the canonical hierarchy, an **Exact** scope is defined by two arbitrary datetimes at minute precision (e.g. for a one-off deadline).

Canonical scope containment is hierarchical: Part of Day ⊂ Day ⊂ Week ⊂ Month ⊂ Season. **Night (22:00–02:00) crosses midnight and is parented to the Day it starts on.** Every scope resolves to concrete datetime boundaries (a cached backend function does the resolution); Parts of Day and Exact scopes carry a time-of-day component.

A scope is **active** when it contains the current datetime.

**Containment-based filtering** is evaluated as interval containment on resolved datetime boundaries: filtering by a scope returns every item whose own scope window is wholly contained within it. This works uniformly for canonical, multi-week, and exact scopes. (Denormalized `week_id`/`month_id`/`season_id` may remain as a canonical-vs-canonical optimization.)

**Events** — represent events. Fields: datetime or scope, title, optional linked note.

**Threads** — concretized trains of thought. Fields: title, linked note. Discovered by recursively searching configured directories.

### Goals

Goals represent desired states. Fields: title, parent (Project / Goal / Domain), tags (list), KB resource links (People, Events, Threads, Scopes), status, blockers, beads id.

**Status:** Active / Achieved / Frozen / Archived

Goals are never List View *rows*; they appear instead as a segment of a row's **path header** there (see List View below). Goals can be depended on by Tasks; a Goal-dependency blocks a Task until the Goal is Achieved.

### Tasks

Tasks represent action items. Fields: title, parent (Project / Goal / Domain / Task), tags (list), KB resource links, status, blockers, dependencies, delegation, beads id.

**Status:** To Do / In Progress / Done

**Blockers:** A Task (and a Goal) can carry an **ordered list of explicit block reasons**, edited in its editor (add / remove / reorder rows). A Task is **additionally** blocked *virtually* by any dependency on a non-Done Task or non-Achieved Goal, with reason `"Blocked by {kind} {id} ({title})"`. The two combine: a Task/Goal reads as **blocked** on the canvas (red stop-sign) when it has **any** reason — explicit or virtual. Explicit reasons live in their own `block_reasons` table (polymorphic `owner_type`/`owner_id`, ordered by `position`); virtual reasons are derived at read time from the dependency edges, never stored. Cross-table type conversion copies the explicit reasons to the new node.

**Dependencies:** Tasks can depend on other Tasks or Goals. Circular dependencies are rejected at write time.

**Delegation:** A Task can be delegated to a Person.

**Time Scope & Plan:** A Task carries a **Time Scope** (relevance window) and an optional **Plan** (a single scope it is scheduled into). Goals carry a Time Scope but no Plan. See *Time Scopes & Planning* below.

**Backlog:** A Task may be put in the **Backlog** — deliberately set aside, not in play now, kept for later. It is the Task-side answer to what **Frozen** already does for a Goal or Project, and it is a stored **Archival** value (`live` / `backlog`) rather than a fourth status: status keeps meaning *where the work stands*, Archival *whether it is in play at all*, so a backlogged Task that was In Progress still says so when it is pulled back, and the Enter status cycle is untouched. **Frozen** stays Goals/Projects-only and **Backlog** Tasks-only; they are separate states and neither maps to the other on retype (a Frozen Goal retyped to a Task arrives as a plain To Do Task, as before; a backlogged Task retyped to any other kind comes back into play, and the dropped Backlog is named in the retype confirmation prompt alongside every other lost field — see *Retyping (backend)* below). A backlogged Task is hidden from **Plan** and **Start** together with its whole subtree, shown under **All**, browsable on its own through the **Backlog** preset, and marked with its own status-row badge (not the Frozen snowflake). It is set and cleared from two places that mean exactly the same thing: a **Backlog** switch in the **Task editor**, as a switch rather than a status pill, since it is a separate axis from where the work stands — a backlogged Task keeps whatever status it had; and the bare **B** binding in the Mindmap and List View. The Goal editor has no such control and never gains one: a Goal is set aside by its own **Frozen** status. Backlog is deliberately *not* protective: a scoped backlogged Task whose window lapses unfinished still resolves **Missed** and archives, flagged as a conflict — see *On-exit behavior* below.

**Invariant: a Task is never both backlogged and planned.** Enforced at write time, asymmetrically, because the two directions differ in how much they throw away: backlogging a Task that has a Plan is **refused pending confirmation**, prompting with the option to clear the Plan and backlog in one action (declining leaves both untouched); setting a Plan on a backlogged Task simply takes it out of the Backlog, with no prompt — the gesture is unambiguous — and raises a **toast**, so the change is never silent.

A Task's **goal**, **project**, and **aspect** are resolved as the nearest ancestor of each type.

### Beads id

A Task, Goal or Project may carry an optional **beads id** — the identifier of the issue tracking it in `bd` (beads), e.g. `Arlesh-5fs`. It is a mirror of an id `bd` owns, not a value this app authors, and so is **write-restricted**:

- The **MCP server is the only source**. Each resource operator exposes a single setter (`set_beads_id`); `UpdateTaskRequest` / `UpdateGoalRequest` / `UpdateDomainRequest` have no field for it, and no gesture can **author, edit or clear** a beads id from the UI.
- **One named exception to "no Tauri command writes it": duplication.** Copy+Paste's `duplicate_*` commands *propagate* the id a node already carries onto its copy, so the column is written from the UI side — but only ever with a value `bd` issued and the source already had. A source with no link produces a copy with no link. The accepted consequence is that two nodes can show the same issue id, and `bd` holds no record of the second.
- Every read that returns a Task, Goal or Domain carries it.
- The UI shows it **read-only, only where it is set** — as the **Issue** row in the Task, Goal and Project editors, directly under the title. A node with no beads id shows no row at all: no label, no placeholder.

The column lives on `domains` for the Project case, but only the `project` subtype is given one and only a Project surfaces it; Aspects, Domains and Tags leave it null.

---

## Time Scopes & Planning

### Time Scope (relevance)

Every Task and Goal has an optional **Time Scope** — the window during which it is relevant. It takes one of two forms:

- **Boundaries** — an explicit start and end Scope of the same kind, forming an inclusive range (e.g. W33–W35, or a single scope used as both endpoints). An endpoint may be an exact datetime, in which case the other endpoint must also be supplied.
- **Duration** — a start anchor (defaulting to the current scope) plus a length of N of a scope kind.

Both forms resolve to a concrete inclusive `[start, end]` window. For a standalone item the Duration form is **snapshotted** to a fixed window at save time, while persisting its duration parameters (anchor, N, kind) so views and edits stay duration-shaped. (Inside Flow templates the Duration/cycle scope instead stays *relative*; see *Flows*.)

A **null** Time Scope means *inherit the nearest scoped ancestor's window*. An item is truly **Unscoped** (always active) only when no ancestor is scoped.

An item is **active** when its (own or inherited) Time Scope is active.

#### On-exit behavior (Timing, Resolution, and Archival)

Configuring an explicit Time Scope also sets an explicit **On-exit behavior** — how an unfinished item is treated once its window has fully passed:

- **Keep** → the item's Resolution reads **Overdue**.
- **Archive** → the item's Resolution reads **Missed**. This is the single-occurrence form of a Habit's **Consumption** root (Archive = Destructive, Keep = Accumulating).

The value is present **iff** the item is explicitly scoped (a DB invariant); an inherited-scope item inherits the ancestor's behavior along with its window.

Three independent axes, all **derived** on read — a pure function of `(effective window, on-exit behavior, status, now)` in local wall-clock, never a stored-status mutation, and all auto-reverse if the scope is later widened:

- **Timing** — the item's window position: **Pending** (before its window), **Active** (within its window, or Unscoped), or **Lapsed** (window has fully passed). Purely about window position, independent of whether the item is finished.
- **Resolution** — only meaningful once Timing is **Lapsed**: **Completed** (the item was Done/Achieved by the time its window lapsed), **Missed** (unfinished, Archive-on-exit), or **Overdue** (unfinished, Keep-on-exit).
- **Archival** — the item's *effective* archived/frozen/live state, driving the status row's archive-box badge (below) and the Mindmap's **Archived** filter (Filtering, below). Every item may carry a manually-set Archival of its own: a Goal/Project through its status (**Frozen** / **Archived**), a Task through its **Backlog** flag (see *Tasks* above) — a Task is never manually **Archived**. A **Completed** or **Missed** Resolution unconditionally forces the *effective* Archival to **Archived** regardless of what is stored, even overriding a manually-set **Frozen** *or* **Backlog**; when it does, the status-row badge flags the resulting **conflict**. **Overdue** never forces anything: the item stays whatever is stored. Backlog and Frozen lose to a forced Archived on identical terms — chosen deliberately over letting Backlog win, so that setting a scoped Task aside does not quietly exempt it from its own window.

A Task's Done status and a Goal's Achieved status are themselves untouched by any of this — Resolution and Archival are additive, derived layers on top, not a replacement. (Formerly, a resolved item was exempt from all of the above — the deliberate goal **Archived** status and scope-Lapsing were treated as unrelated concepts. They're now unified: any scoped item whose window has passed, resolved or not, is effectively archived.)

### Plan (scheduling)

A **Task** (not a Goal) may be **planned** into a single Scope. The Plan must be wholly contained within the task's Time Scope (the same scope or a subscope).

### Containment invariants

Evaluated as interval containment on resolved datetime boundaries:

- `Plan ⊆ TimeScope`
- `child.TimeScope ⊆ parent.TimeScope`
- `child.Plan ⊆ parent.Plan`

**Enforcement:** a local edit that exceeds a bound (a child or Plan set too wide) is rejected at write time. A parent-narrowing or reparent that would orphan descendants prompts the user to *clamp descendants to the intersection* or *cancel*.

### Scope Picker

Scopes are chosen in a calendar-like picker (date-picker-style). It opens at the highest sensible scope (default Season; the active item's scope kind when narrower) and can be bounded (e.g. can't browse outside a season when the item is season-scoped). Double-click descends into a scope (week → days); single-click selects. Three selection modes: **range** (first click = start, second = end, third resets; drag an endpoint to adjust), **single** (each click replaces; click selected to deselect), **multiple** (each click adds; click to remove — used for flow cycle scopes). Calendar views per kind: seasons (year of four squares), months (season of three / year of twelve), weeks (month grid, Sunday-start numbering), days (week of seven), parts of day (day → part), exact (clock, browsable days).

---

## Flows

A **Flow** is a template for a Goal/Task subtree, materialized on demand (e.g. an "Add Feature" flow of Specify → Implement → QA). It is a new node kind, created via a dedicated mindmap action (not the type cycle), and may be parented under an Aspect, Domain, Project, or Goal.

A Flow has a title, an **Instance Type** (goal or task — what its root and children materialize as), a **Target Node** (where instances are created — **optional**: unset means the Flow's own parent, derived on read rather than stored, so a move carries the instances along, while a stored target is a deliberate override a move leaves alone), and a **Flow Window**. The Flow Window is either a **Span** — a coarse Duration of N of `day`/`week`/`month`/`season` (a relative length, snapshotted against the start anchor) — or a sub-day **Phase** — a fixed time-of-day carried date-free on the template: a part-of-day band (e.g. Evening) or an exact `HH:MM–HH:MM` range. Starting supplies only a date; a Phase window is combined with that date via the part/exact scope constructors. A Habit with a Phase window recurs at the fixed time-of-day, stepping whole days by its Gap. A **task-instance** flow may also carry a **root Cycle Plan** — a relative plan window inside the flow window (like a flow item's Cycle Plan) — resolved into the root Task's Plan on start; goal-instance flows have none (Plan is task-only).

**Flow items** — a Flow's children are flow tasks/goals: ordinary Tasks/Goals plus one or more **(Cycle Scope, Cycle Plan)** pairs. A Cycle Scope is relative — the Nth subscope of the flow scope (null = the whole flow scope); a Cycle Plan is a relative Plan within it. Flow items may declare dependencies on **any other item in the same flow**.

A flow item is created under a flow (or another item) like any child — a flow root spawns items of its Instance Type, a flow item spawns items of its own kind — and edited in a dedicated modal: title, default status, block reason, cycle pairs, and dependencies. Like real Goals/Tasks, a flow item can be **retyped between goal and task** with the type cycle (the flow node itself cannot). Converting a flow-goal that has flow-goal children into a flow-task prompts to reparent or delete those children (they can't live under a task); the item's cycle pairs and dependency edges are preserved across the change. Cycle pairs are stored **relatively**: the Cycle Scope as a `(subkind, index)` (the index-th subkind unit within the flow window; null = whole scope) and the Cycle Plan as a `(subkind, start..end)` range within the cycle scope (null = no plan). These indices are resolved to concrete Time Scopes / Plans only when the flow is started. Existing cycle pairs list as rows; adding or editing one opens a **relative drill-down picker** modelled on the Scope Picker's own navigation (browse a level's cells, click to descend, ↑ to ascend) but labelled in relative terms ("Week 2 › Tuesday › Morning") using nominal subdivision counts (season→month 3, month→week 4, week→day 7, day→part 6) — clicking a cell at the chosen Cycle Scope Kind toggles that occurrence on or off immediately, with no separate confirm step. Part of Day cells are labelled with their real band names (Morning, Noon, …) rather than a nominal index, since that kind's meaning is fixed regardless of anchor. An Unscoped flow's items have no cycles. A **Phase**-windowed flow's items may carry finer **exact-time** cycles (a fixed `HH:MM–HH:MM` sub-range of the band/window) — permitted by design, but since these are absolute times-of-day rather than ordinal offsets they need a time-of-day cycle form and a datetime sub-interval containment check; that backend is deferred until a cycle editor supports exact times.

**Starting a flow** (`s` on a focused flow node, or context menu) opens a modal: title, target node (free-text search combobox; parent path shown in parentheses for duplicates; defaults to the flow's Target Node, or to its parent when it has none), and an **anchor** for the flow window. The anchor is a scope of the **flow-scope kind** (a week-flow anchors on a week, a season-flow on a season; a Duration expressed in days anchors on any day for agility), defaulting to the current such scope. On start:

- The window anchors concretely as `[anchor, anchor + (n−1) flow-kind periods]`. Each (Cycle Scope, Cycle Plan) pair resolves to a real item — **a flow item with N pairs produces N items** (an item with no pairs produces one item with no cycle scope). A Cycle Scope `(subkind K, index i)` resolves **by offset**: the K-scope beginning `i−1` K-periods after the window start (so it is always in range); the Cycle Plan resolves the same way within that cycle scope.
- The flow node materialises as a single **root** of its Instance Type, titled from the modal, with the resolved window as its Time Scope; every item becomes its descendant. An item parented on another item is placed under that parent's **first** instance.
- Intra-template dependencies **remap by fan-in**: each instance of the dependent waits on **every** instance of the blocker (Implement waits on all of this run's Specifies).
- The result is a **real, independent copy** under the target. A `flow_instances` row records the run (originating flow + root), and a `flow_instance_nodes` row records each materialised node with its source flow-item and original parent — so flow-originated nodes are distinguishable from later additions and moves are detectable. The link is a "from flow X" UI indicator only (no cascading edits).
- Instances must satisfy scope containment against the Target Node. The target picker offers only scope-valid targets: at **start**, when the anchor is known, targets whose effective Time Scope window wholly contains the concrete flow window (targets with no scoped ancestor — and any Unscoped flow — are always valid); at **template edit**, before the anchor is known, a coarse necessary filter that hides only targets too small to ever hold the flow window. The backend `start` hard-rejects anything that slips through. Because a flow's materialised instances are ordinary Goals/Tasks, narrowing an ancestor's scope reconciles them through the same clamp-or-cancel prompt as any descendant (Phase 6.5); that prompt annotates flow-originated descendants with their "from flow X" origin (Phase 7.5).

---

## Habits

A **Habit** is a Flow with a **Recurrence** pattern (a flow becomes a Habit when given a Recurrence — stored in a `flow_recurrences` row keyed by the flow, whose presence marks the flow as a Habit; a Habit requires a scoped flow). Its instances are generated automatically and are **virtual**: each is identified by `(instance, iteration scope)` — where an instance is a flow item **or the flow root itself** (the root materializes as a normal Task/Goal, so it is a first-class completable instance, not merely an aggregate of its items; an item-less habit therefore still has one instance, its root) — and rendered from the template, with only divergences (status, edited fields, dependencies, deletion/archival tombstones) persisted as **Modification** rows. The root instance's title reads `{flow title} {start scope}` (e.g. "Exercise W22").

**Recurrence** = **Repetition** + **Consumption**:

- **Repetition** — a Start anchor, an optional **Gap** of N of a scope kind ≥ the habit scope (default: no gap, continuous), and an optional end.
- **Consumption** (per-habit, user-configurable tree):
  1. **Destructive** (unfinished instances lapse when their iteration passes; bounded) vs **Accumulating** (they survive).
  2. If Accumulating: **Overlapping** (new iterations generated regardless) vs **Blocking** (withheld while unresolved instances exist).
  3. If Blocking, the **catch-up policy** when the open iteration completes: *all pending* (every missed iteration, in order), *next* (advance by one), or *latest* (jump to current, recording skipped iterations as missed tombstones).

**Generation.** Iterations are **derived**, never persisted per iteration: a pure function of the Recurrence, the reference day, and the completed iterations (the only persisted facts — a completed instance carries a `resolved_at`). Each started iteration is classified `Active` / `Done` / `Lapsed` (Destructive, passed unfinished) / `Missed` (a Blocking `latest` skip). Only iterations whose window has begun are generated; future ones are the ellipsis. An iteration is *resolved* when every one of its (non-tombstoned) instances is done. Consumption semantics: Destructive lapses any past unfinished iteration and keeps only the current window active; Overlapping keeps every started iteration active until done; Blocking withholds beyond the open iteration and, on completion, advances by **next** (release the next), **latest** (jump to the iteration containing the completion day; skipped ones become Missed), or **all pending** (release the whole backlog up to the completion day as active, blocking again beyond it). A Destructive iteration's virtual instances (root and items alike) map onto the Task/Goal Archival model above once their window has passed — a past-window instance is *effectively archived* regardless of whether it's `Done` or `Lapsed`, so a habit occurrence with some items completed and others missed still archives as a unit, rather than partially lingering visible via its completed siblings.

**Display.** Instances render under the Target Node — the Flow's own when it has one, otherwise its parent (and, only if that parent is not in the rendered tree, the Flow node itself). Active and past instances render directly; an **ellipsis node** stands in for future instances (which can be unbounded under overlapping/open-ended recurrence). Double-click/double-enter the ellipsis to open a search combobox of virtual instances; selected ones are **display-pinned** (still virtual) and render on their own.

**Archiving** a Habit stops recurrence (even if still in scope); existing occurrences survive. **Editing** a Habit's scope or repetition prompts (*archive the old habit and create a new one* vs *delete instances and regenerate*) **only when divergent instances exist**; otherwise it silently regenerates.

---

## Link Inheritance

All link types inherit downward from parent to child. When filtering, a child item matches a filter if it or any ancestor holds the matching link.

Inheritance behavior per link type:

| Link type              | Behavior when child has explicit value |
|------------------------|----------------------------------------|
| Tags                   | Additive — child has both parent's and its own tags |
| KB links (Person/Event/Thread) | Additive |
| Time Scope (relevance) | A null child Time Scope inherits the nearest scoped ancestor's window. An explicit child Time Scope must be wholly contained within the parent's (interval containment); it narrows relevance but the parent window still contains it. |
| Plan (scheduling)      | Task-only. Must be wholly contained within the task's Time Scope and within the parent's Plan. |
| Delegation             | Override — child's explicit delegation replaces the inherited one |

Inherited links are computed on read (ancestor traversal). To be revisited if performance becomes an issue.

---

## Filtering Logic

Filters apply to task/goal lists. Any number of filters can be active simultaneously, each in one of three modes:

- **Any** — item must match at least one Any-mode filter
- **All** — item must match every All-mode filter
- **Exclusion** — item must not match any Exclusion-mode filter

Combined logic: `(union of Any-filters) AND (intersection of All-filters) AND NOT (union of Exclusion-filters)`

Filterable fields: parent domain/task, dependency, status, delegate-to, delegated/undelegated, Person/Event/Thread/Scope, planned scope, Project, Aspect, Goal, Tag.

---

## Views

### Mindmap (Tree View)

A canvas-based mind map editor. Layout: a **balanced tree** whose branches grow along one of two
orientations, toggled by the **Vertical layout** switch in the settings popover and persisted with
the rest of the view state:

- **Horizontal** (default) — the first ⌈n/2⌉ of the root's children go right, the rest left.
- **Vertical** — the same split, rotated: the first half go down, the rest up.

Implemented with a custom SVG renderer using D3's tree layout algorithm. The orientation decides
which axis carries depth and which carries sibling spread; arrow-key navigation follows it, so the
branch axis always walks parent↔child and the other always walks siblings. Flipping the orientation
pans the canvas to keep the selected node (or the display root) in view.

The root of the map is "Arlesh" (top level). Aspect cells are its direct children.

**Keyboard interactions:**
- `Tab` / click — create a child cell
- Arrow keys — move between cells; with **nothing selected**, they pan the canvas instead
- `Shift+arrows` — extend the selection across siblings (on the sibling axis for the current orientation; on the branch axis they navigate as usual)
- `Alt+↑` / `Alt+↓` — move the cell among its siblings
- `Ctrl+↑` / `Ctrl+↓` — cycle the cell's type through: Domain → Project → Goal → Task
- `Enter` — with a node selected: cycle a task's status / toggle a goal's achieved (double-tap enters a container as a subtree); **with nothing selected: focus the current display root**
- `Shift+Enter` — create a sibling cell; `Ctrl+Enter` — insert a parent above
- `F2` / `R` — rename the selected cell
- `E` — open the selected cell's editor; `Double-click` does the same
- `B` — put the selected Task in the Backlog, or take it out (real Tasks only — a virtual Habit occurrence has no row of its own to set aside, so the binding is inactive on one rather than silently doing nothing)
- `Delete` — delete the selection
- `Ctrl+/` — collapse or expand the selected cell
- `Ctrl+X` / `Ctrl+C` / `Ctrl+V` — cut / copy / paste
- `C` — center the view on the selection; `Ctrl+=` / `Ctrl+-` (and numpad `+`/`-`) — zoom
- `S` — start the selected Flow; `F` — convert the selected cell to a Flow
- `Ctrl+O` — search for a node by title
- `Alt+F` — toggle the filter menu; `Alt+A` / `Alt+P` / `Alt+S` / `Alt+D` / `Alt+B` — jump to the **All / Plan / Start / Do / Backlog** status preset (matched by physical key)
- `Escape` — deselect; `Shift+Escape` — go back one level when inside a subtree; `Ctrl+Escape` — go back to the root
- `Alt+L` — switch between Mindmap and List View; `Ctrl+Shift+/` — open the keyboard cheat-sheet
- `Right-click` — context menu (enter subtree, change type, delete, etc.)
- Back button / back-to-top button available in the UI

A shortcut requires exactly the modifiers listed — `Ctrl+E` does not open the editor, only a bare `E` does. Every binding above is declared once in the shared hotkey registry (`src/utils/hotkeys/`), which is also what the cheat-sheet renders, so this list, the overlay, and the handlers cannot disagree. The view-level bindings (Mindmap and List View) are suppressed whenever a modal or an inline rename is on screen; the global ones (`Alt+L`, `Ctrl+Shift+/`) always stay live. That suppression is driven by the modals and inline editors themselves, each registering while it is mounted (`src/stores/use-input-capture-store.ts`), rather than by the views tracking which of their own state flags imply an open modal — a flag can outlive the UI it describes, and a stale one would silently kill every view binding until the view remounted.

**Entering a subtree:** Right-clicking a cell and selecting "Enter" re-roots the map at that cell; `Ctrl+O` does the same from the node search, in either view. Navigation back: back button, back-to-top button, `Shift+Escape` (up one level), or `Ctrl+Escape` (straight back to the root).

The subtree root is **shared between the Mindmap and the List View**, not per-view: entering a subtree in one and switching to the other leaves you in the same place, which is the same reasoning that makes the two views share a tree and a filter rather than drifting apart. The List View honours it by flattening from the subtree root's **children**, so it lists exactly the Tasks beneath it and the subtree root is **trimmed out of the path headers entirely** — inside `CODE`, a header reads `Goal Alpha`, not `CODE › Goal Alpha`. Where you are is named once, by the top bar's subtree indicator, instead of being repeated on every header. Trimming happens by scoping the *walk* rather than editing the paths afterwards: a row's ancestors are just the nodes stepped through to reach it, so the root is never collected in the first place and a header's `segments` and a row's `visibleDepth` go on partitioning those ancestors exactly — an after-the-fact trim would leave the indentation claiming a parent the header no longer names. One consequence: a row whose only ancestor *was* the subtree root now has an empty path and gets **no header at all**, the same handling a task with no ancestors already gets at the true root.

Because the top bar holds no tree of its own, whichever view is mounted resolves the descriptor for it (`src/hooks/use-subtree-nav.ts`) — so the indicator and the pills are correct in both views, rather than only in the one that happens to own the subtree logic.

**Status-icon row:** below each node sits a compact row of status badges (aligned to the node's left edge), each with a hover tooltip. A **clock** marks a Time Scope (tooltip = the window; crossed out once the window has passed); a red **exclamation** flags an **Overdue** item and an **archive box** any item whose *effective* Archival is **Archived** — an explicitly-Archived Goal/Project, or any scoped Task/Goal whose Resolution is **Completed** or **Missed** — tinted as a warning when it's a **conflict** (a manually-Frozen item that scope forced into Archived); a **calendar** marks a Plan (tooltip = the plan window); a **snowflake** a Frozen goal/project and a **tray** (three stacked lines) a Task in the **Backlog** — a badge of its own, since Backlog and Frozen are distinct states, and one that can appear alongside the archive box when a lapsed window has forced Archived over it; an **ellipsis** an Info node carrying a Details description (tooltip = the text); a **wave** a real Start-flow instance and the **cyclical habit glyph** a virtual Habit iteration; and a **tag** icon a node with tags (tooltip = their names). Badges appear only when relevant, so most nodes show few or none. The set of badges is a pure function of the node; scope/plan/tag tooltips resolve their labels on demand.

**Top bar:** a settings **gear** (popover with a **Light mode** switch, a **Keyboard shortcuts** entry, and the two view-scoped display switches — **Vertical layout** on the Mindmap, **Path icons** in the List View — each shown only while its own view is active — persisted, defaults to dark, applies app-wide via a `data-theme` attribute and matching `tokens.css` overrides) at the start edge; a **Mindmap/List** view tab pair (also toggled by `Alt+L`); a **status-preset dropdown** (All/Plan/Start/Do, plus a 5th **Unblock** option while List View is active — see List View below) — a dropdown rather than a segmented control so it stays compact next to the tabs, built as a themed `Select` (listbox popover styled from the app's own tokens, with arrow-key/Enter/Escape keyboard support) rather than a native `<select>`, whose open option list ignores CSS and renders with plain OS chrome; the subtree **back-nav pills** and the **current-subtree indicator** (all shown only inside a subtree — the two pills are the ways out, `↑` to the root and `←` up one level, while the indicator is a static, non-interactive pill carrying a subtree glyph and the title of the subtree you are in, since "here" has nowhere to navigate to; its glyph is `aria-hidden` like the others, so it carries a visually-hidden "Inside subtree:" label to keep a screen reader from hearing three bare titles in a row); and, at the end edge, a **Filter** button (funnel) that opens the filter popover. Below the bar, a wrapping row of **active-filter chips** renders whenever any filter is engaged (empty and takes no space otherwise) — every active tag filter and, while List View is active, every active List-View-exclusive pill filter (see below). A chip shows a mode symbol (∪/∩/∅) and the filter's name; clicking the chip body cycles Any → All → Exclude, and an embedded **×** removes it. A chip's border/symbol color is a muted accent for its mode — a fixed, low-key hue per mode shared across every dimension, blended most of the way toward the neutral border rather than shown at full strength; its background additionally tints toward the value's resolved aspect color where one exists (tags, Parent, Dependency).

A **keyboard cheat-sheet** overlay is available from that settings entry or with `Ctrl+Shift+/`: it lists every binding in the app, grouped into **Global / Mindmap / List View**, with the chords that share an action merged onto one row (so the four arrow keys read as a single `← → ↑ ↓` line). The list is rendered from the same binding registry the keyboard handlers dispatch from, so it tracks the handlers automatically rather than being maintained by hand.

**Mindmap filter:** prunes the displayed tree — a node is hidden unless it matches or has a matching **content** descendant (ancestors of matches stay, keeping the map connected). Info notes are *attachments*: they ride along with a kept node but never keep one (an achieved goal whose only children are notes is still hidden). The **status preset** lives in the top bar (see above); the popover opened from the **Filter** button is a pure **"add a filter"** chooser — active filters never render inside it, only candidates not yet selected (picking one adds it and it disappears from the list, mirroring the top-bar chip it now appears as). Sections group into a few always-expanded clusters rather than one long list or a collapsed "Advanced" toggle:
- **Status preset** (single, in the top bar, not the popover): **All** · **Plan** (hide done tasks, achieved/frozen/archived goals, and anything else whose *effective* Archival is **Archived** — a Task or Goal a forced Resolution archived, regardless of its own stored status) · **Start** (Plan, minus in-progress tasks with no todo child, minus Timing-**Lapsed** items — a strict superset of Plan's Archival exclusion, since it also drops unresolved **Overdue** items that Plan still shows — minus Habit flow nodes; a **blocked** task/goal is dropped together with its whole subtree — it gates what's beneath it, so nothing under it is startable either) · **Do** (only in-progress tasks) · **Backlog** (the inverse of the others: only Tasks deliberately set aside, together with their whole subtrees — see *Tasks* above; available in both views, unlike Unblock). In every filtered mode, structural containers (Aspect/Domain/Project/Tag) appear **only as ancestors of a content match** — an empty or fully-resolved container drops out — **except** in Plan, where an **active** (non-resolved) Aspect/Domain/Project shows on its own so you can plan/create items in an empty one (resolved ones, and Tags, stay ancestor-only). Only a Project can be *given* a status, so a status-less container **inherits the nearest status-bearing ancestor's** status rather than reading as active: the Domains inside an Achieved or Archived Project are resolved along with it and stay ancestor-only, while those inside an Active one still show on their own. A container with no status-bearing ancestor at all reads as **Active**. A **Frozen** or **Archived** Project goes further in Plan/Start: it is dropped **together with its whole subtree** (like a blocked Task/Goal under Start), so unresolved work inside it doesn't hold it on screen — its status says the work is off the table, so nothing under it is plannable or startable either. **Achieved** is deliberately softer and keeps the ordinary ancestor-keeping: finished work can still contain unfinished items worth surfacing. The Archived pill's **Include** still overrides this for the Archived case. **All** shows everything, containers included.
- **"Tags & Type" cluster** — a tag search combobox (candidates only; picking one adds a Tag filter chip, Any/All/Exclusion modes per the Filtering Logic formula, AND-ed with the preset); an **Include flows** subtoggle (shown only in Plan/Start), separate from the global Flow type toggle — both must be on for flows to show; **Node-type visibility** (Mindmap only — Info/Flow toggles hide those subtrees, meaningless in List View since its rows are Tasks only, so this section is hidden there); and the **Private** toggle (both views), i.e. **Private Mode**: off by default, and while it is off every node marked **Private** is hard-hidden together with its whole subtree (dropped outright, not kept as an ancestor); turning it on reveals them. Every node kind carries an `is_private` flag, set from its editor modal. Marking a **flow item** Private is a real stored field that also propagates to that item's instances — the virtual Habit instances inherit it, and starting a flow copies it onto the materialized Goal/Task (the flow root's flag propagates to the root instance likewise).
- **"Advanced" disclosure (Mindmap only)** — collapsed by default (auto-opens when either pill is already engaged), mirroring the editor modals' own collapsible Advanced section. Holds an **Archived** pill that cycles **Inactive → Include → Exclude → Inactive** on click, overriding the status preset's own handling of anything whose *effective* Archival is **Archived** (an explicitly-Archived Goal/Project, or any scoped Task/Goal whose Resolution is **Completed** or **Missed** — the states that render the status row's archive-box badge) independently of achieved/frozen, which stay governed by the preset alone. **Inactive** (default) defers to whatever the active preset already does (Plan/Start hide Archival-Archived items; All shows them). **Include** force-shows archived items even under Plan/Start. **Exclude** force-hides them even under All, hard-hiding the whole subtree so an archived item isn't kept visible merely as the ancestor of an unrelated, ordinarily-visible sibling. Has no effect under **Do** (which already shows only in-progress tasks, never goals/containers, regardless of archived state). Beside it sits a **Backlog** pill with the same three modes and the same relationship to the preset, governing Tasks in the **Backlog** (see *Tasks* above): **Inactive** defers (Plan/Start hide them with their subtrees; All and the Backlog preset show them), **Include** force-shows them under Plan/Start, and **Exclude** force-hides them even under All, subtree and all. The two pills are independent — a backlogged Task whose window has lapsed answers to both.

**Type cycling rules:**
- New cell defaults to parent's type
- Cycle: Domain → Project → Goal → Task (and back)
- Aspects are fixed roots; they are not part of the cycle
- Type-shifting between Goal and Task maps statuses to the closest equivalent with a user-facing warning:
  - Goal → Task: Active → To Do, Achieved → Done, Frozen → To Do, Archived → To Do
  - Task → Goal: To Do → Active, In Progress → Active, Done → Achieved

**Retyping (backend):** every node kind a node can become — Goal, Task, Domain, Project, Tag, and
**Info** — is one `RetypeKind` handled by a single atomic backend command (`retype_node`); nothing
retypes through separate frontend-issued create/reparent/delete calls, Info included. Three rulings
that fell out of giving Info the same treatment as the rest:
- **`Info.details` and `Domain.description` are the same domain concept** — the long-form body
  under a node's one-line title. A retype between an info and a domain/project/tag carries that
  value across (into `description` one way, into `details` the other); a retype between an info
  and a goal/task drops it, since neither has a column for it at all.
- `Info.body` is the one-line title and maps to every other kind's `title`, both ways. `is_private`
  and sort position always carry, to every kind.
- If the target kind's `parent_type` cannot accept the node's current parent (e.g. an info nested
  under another info, retyped to a Goal — a Goal's parent must be a Project, Goal, or Domain), the
  backend climbs to the nearest ancestor it can accept rather than writing a mislabeled polymorphic
  reference. The climb is named in the same confirmation prompt as a stranded child or a dropped
  field, and is only carried out once acknowledged — never silently.

**Copy+Paste duplication:** pasting a **Cut** selection moves it. Pasting a **Copy** deep-clones the
whole selected subtree onto the target instead, leaving the original exactly where it was — copy and
cut then differ only in whether the original survives, which is what the two gestures mean
everywhere else. It is deep by default, with no prompt: the copy is a real, independent subtree, and
editing one side never changes the other. The duplicate **keeps the original's title** (no
`" (copy)"` suffix) and carries everything the original holds — status, tags, notes, Time Scope,
on-exit behaviour, Plan, delegate, block reasons, privacy, position, its **beads id** (see *Beads
id*), and its dependencies. Those dependencies point at the **same targets** the original's did, even
when a target was itself inside the copied subtree: copying a subtree whose members depend on each
other produces a copy whose members still wait on the originals. (That mirrors a plain reparent and
is the conservative reading; Flow instances solve the same problem by remapping per instance, and
that is the model to reach for if this proves wrong.)

Projects, Domains, Tags, Goals, Tasks and Infos are duplicable. Aspects, Flows, flow items and
virtual Habit instances are not — a Flow moves and forks through its own commands — and a Flow
hanging under a copied node is therefore not copied with it. A paste whose selection includes any of
these pastes the rest and reports how many it skipped in a toast. Otherwise a copy is refused exactly
where a move would be, by the same drop-target rule; it lands at the end of the target's children; it
is atomic, so a failure part-way leaves the tree untouched rather than half a subtree; and it leaves
the clipboard intact, so the same subtree can be pasted into several places.

### List View

A compact-card task list, reached via a Mindmap/List tab in the top bar or the `Alt+L` shortcut (both toggle between the two views; view choice persists). Reuses the Mindmap's own loaded tree (flattened to Tasks) rather than fetching independently, so the two views never drift out of sync — a materialized Start-flow task or a virtual Habit instance shows consistently in both.

**Rows are Tasks only** — real, flow-materialized, and virtual Habit instances alike. Goals, Projects, Domains, and every other kind are never list rows — they appear in a row's **path header** instead (see below). A row shows: a status control (click cycles To Do → In Progress → Done, or advances a Habit instance; disabled while the task is blocked, except for Habit instances which always advance), the title (click opens the Task editor; double-clicking anywhere else on the card opens it too, matching the Mindmap's double-click-to-edit gesture), the same status-icon badge row as the Mindmap node (scope/plan/flow/tag badges with tooltips), and the task's **parent label** and **tag pills** — clicking either inline adds it as a filter, per the general Filtering Logic. Each card spans the full row width, with generous padding for a sparse, readable list, and is tinted with its resolved aspect colour — the same fill/opacity derivation the Mindmap node uses — so a task's card matches its node's colour there. Clicking anywhere on a card **selects** it (a highlighted border), for the keyboard bindings below.

**Keyboard interactions** (mirroring the Mindmap's bindings where they translate to a flat list):
- `Alt+F` — toggle the filter menu; `Alt+A` / `Alt+P` / `Alt+S` / `Alt+D` / `Alt+B` — jump to the **All / Plan / Start / Do / Backlog** status preset (matched by physical key), same as the Mindmap
- `B` — put the selected Task in the Backlog, or take it out (acts on the selected row only)
- `↑` / `↓` — move the selection between rows (path headers are skipped); from nothing selected, `↓` selects the first row and `↑` the last
- `Enter` — cycle the selected row's status (disabled while it's blocked, except a Habit instance)
- `E` — open the selected row's editor
- `R` — rename the selected row inline (Enter/blur commits, Escape cancels)
- `Ctrl+O` — search for a node by title, over **every** node kind (not just the Tasks the list shows), and **enter** the one you pick: the list re-roots at it and shows only the Tasks beneath it, with that root trimmed from the path headers and named in the top bar instead. This is subtree entry, not a filter — the filter chips, the status preset and the selection are all untouched, and the subtree composes with whatever filtering is already active
- `Shift+Escape` — up one subtree level; `Ctrl+Escape` — straight back to the true root. Same semantics as the Mindmap's, and gated the same way (they do nothing at the true root, where bare `Escape` still deselects)
- `Escape` — deselect
- `Alt+L` — switch back to the Mindmap; `Ctrl+Shift+/` — open the keyboard cheat-sheet

A shortcut requires exactly the modifiers listed — `Ctrl+E` does not open the editor, only a bare `E` does.

**Path headers** name where a run of rows lives. Contiguous rows sharing a location are grouped under one header spelling out their full chain — `Growth › CODE › ARLESH › Features` — rendered once above the run rather than repeated on every card; grouping falls out naturally from walking the tree in the same position-sorted order the Mindmap uses, so rows sharing a path already arrive contiguous and no separate sort/group pass is needed. A header names every ancestor **not** rendered as a row above the task: always through to the Goal (Goals, Projects, Domains and Aspects are never rows), plus any ancestor Task the active filter hides — so a subtask on screen without its parent still reads in context, at the cost of splitting a run per hidden parent. A run with no named ancestors gets no header rather than a blank one. A header **opens with a single glyph** for its nearest ancestor — the node the rows below hang directly from — drawn with the same `NodeIcon` the Mindmap nodes and the task rows use, so one kind vocabulary covers all three; one glyph, not one per segment, since the chain is read for where it ends and a marker beside every step would compete with the titles it exists to qualify. An Aspect carries no glyph anywhere in the app, so a header ending at one opens with nothing rather than reserving an empty box. The glyphs are a display preference — the **Path icons** switch in the settings popover, on by default and persisted, offered only while the List View is active since nothing else in the app has a path header. The header is visually lighter than a task card and stays on one line, and each segment is clickable: it **enters** that node as the subtree — the same shared re-rooting `Ctrl+O` performs, so the list shows only what is beneath it, the segment is trimmed from the headers and named in the top bar instead, and `Shift+Escape`/`Ctrl+Escape` are the ways back out. It is subtree entry, not a filter: nothing about the chips or the status preset changes. There is no Goal-visibility toggle — the path always runs through to the Goal — and with the status preset already moved to the shared top bar, the List View has no toolbar of its own.

**Indentation** is the other half of the same rule. A row steps in once for every ancestor Task that *is* rendered as a row above it, so a task and its subtasks read as one piece of work rather than as unrelated items of the same size. Header and indentation partition a row's ancestors exactly — the header names every ancestor not on screen, the indentation counts every ancestor that is — so neither ever repeats the other and the list never leaves whitespace standing for a parent that is not there: under a filter that hides the parent (Do, typically) the subtask sits flush and its parent is named in the header instead. Depth is therefore *visible* depth, not tree depth, and is derived at render from the ancestors each row already carries — no ghost rows for hidden parents, which would mean the filter no longer removes what it says it removes. The step applies to the whole card, so the status control, badges and aspect tint move together as one object; it follows the row title's own direction, so a Hebrew task indents from the right even in a left-to-right list; it is capped, so a deep chain cannot push titles off the edge; and it costs nothing at depth 0, so a list with nothing nested is exactly as wide as before.

**Filtering** shares the Mindmap's status preset, tag filters, and Info/Flow/Private toggles (same top-bar dropdown, same `FilterPopover`, same persisted state) — a filter set in one view is already applied when you switch to the other. The shared status-preset dropdown gains one further option while List View is active: **Unblock** — shows every blocked task, List-View-only, and does *not* change the shared status preset (switching back to the Mindmap shows whatever preset was last active there).

On top of the shared filters, the List View adds its own filter dimensions — all in the same Any/All/Exclusion pill pattern as tags (a searchable combobox for entity-valued dimensions, fixed-option buttons for enum-valued ones), grouped into two extra clusters ("Hierarchy" and "Status & Scope") in the same `FilterPopover` while List View is active. Picking a candidate adds it and it appears as a chip in the top bar's active-filter row, exactly like a tag:

| Dimension | Values |
|---|---|
| Parent | The task's immediate parent (Project/Goal/Domain/Task/Aspect) |
| Dependency | A specific Task/Goal this task depends on |
| Task status | To Do / In Progress / Done |
| Goal status | The resolved nearest-ancestor Goal's status |
| Project status | The resolved nearest-ancestor Project's status |
| Scope | Unscoped / Active / Overdue / Lapsed / Planned / Unplanned — independent axes, so e.g. Unscoped + Planned can both apply to the same task |
| Blocked | Blocked / Not blocked |

---

## MCP Server

Arlesh serves a [Model Context Protocol](https://modelcontextprotocol.io) endpoint while the app is
running, so an agent — Claude Code, Claude Desktop — can read the board without being told its
contents by hand. It is read-only with one deliberate exception: an agent can set an item's `bd`
issue link, and nothing else. It cannot create, rename, complete or delete a Task, Goal, Flow,
Domain or knowledge-base entry.

The endpoint is hosted by the app itself, not a separate process, so there is only ever one writer
to the database and the agent sees exactly what the open window sees. The cost is that it answers
nothing while Arlesh is closed.

**Address.** `http://127.0.0.1:4747/mcp`, overridable with the `ARLESH_MCP_PORT` environment
variable. It binds loopback only and rejects any request carrying an `Origin` header, so a page in
a browser cannot reach it. If the port is already taken the app logs a warning and runs without the
endpoint rather than refusing to start.

**Connecting.** `claude mcp add --transport http arlesh http://127.0.0.1:4747/mcp`

### Tools

Six tools rather than one per backend command, because an MCP client pays context for every tool
definition it loads.

| Tool | Operations |
| --- | --- |
| `arlesh_snapshot` | `load(now, sections?, cursor?)` — the whole planning graph: domains, goals, tasks, notes, flows, flow items, cycles, dependencies, block reasons, materialised instance nodes, every item's derived lifecycle, and each flow's habit iterations and statuses. Paged; see below |
| `arlesh_scopes` | `get(id)`, `resolve(id)`, `resolve_many(ids)` |
| `arlesh_kb` | `list_people`, `get_person(id)`, `list_events`, `list_threads` |
| `arlesh_tasks` | `get(id)`, `containment_conflicts(node, time_scope)` |
| `arlesh_flows` | `get(id)`, `recurrence(flow_id)`, `completion_count(flow_id)`, `origins(nodes)` |
| `arlesh_beads` | `set(node_type, node_id, beads_id)` — the one write; see below |

`arlesh_snapshot.load` is the entry point and covers the common case. The other reads
exist for what it does not carry: the knowledge base, scope resolution, a task's dependency-derived
block reasons, and a Habit's stored recurrence configuration as opposed to its derived iterations.

Tasks and Goals carry `time_scope` and `plan` as boundary **scope ids**, not dates, so reading a
snapshot means resolving those ids — `arlesh_scopes.resolve_many` does a batch in one call against
a single reference instant.

### Paging the snapshot

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

Pages are derived independently rather than from a cached payload, so a board edited mid-walk can
produce a cursor that no longer lands anywhere; the server says so and the walk restarts. For one
local user a few seconds apart, that is rarer than the cost of holding server-side state would be
worth.

### Issue links

A Task, Goal or Project can carry the id of the `bd` issue tracking it, and `arlesh_beads.set` is
the **only** way that field is ever written: no Tauri command touches the column and the editor
modals render it as text with no control. So an issue id shown in Arlesh always arrived over MCP.
Passing `null` clears the link. Setting one on an item that does not exist is an error rather than
a silent no-op, and only the `project` subtype of Domain accepts a link — an Aspect, Domain or Tag
is refused.

### Scope materialisation

`arlesh_snapshot` is annotated as *not* read-only, and honestly so. Deriving a Habit's iterations
materialises the canonical scope rows its windows land on — the same rows the Mindmap materialises
on its next load — so the snapshot writes those and commits them. It creates no Task, Goal, Flow or
note, and changes nothing the user entered. Running it without committing would make it a pure
read, but the iterations it returns reference the scope ids it mints, so the payload would name ids
that no longer exist.

Every tool other than `arlesh_snapshot` and `arlesh_beads` is annotated `read_only_hint = true`
and writes nothing at all.

### What is deliberately absent

- **Every write command**, including `retype_node`, `start_flow` and the `get_or_create_*` scopes.
- **`valid_targets`** — it reads, but resolving a concrete window mints the scopes it names, and it
  answers "where could this Flow be started?", a question nothing on this surface can act on while
  starting a Flow is a write. It returns alongside `start_flow`.
- **The List view's filter presets** (`all` / `plan` / `start` / `do` / `unblock`) and its pill
  dimensions. These live only in the frontend, so an agent cannot ask "what should I start" the way
  the List view answers it; it can approximate from the snapshot's `lifecycles`, which carry the
  same Timing / Resolution / Archival derivation the UI filters on.

### Errors

A tool that fails returns a result flagged as an error carrying the same structured `WireError` the
frontend receives across the Tauri boundary, including its stable `kind` — `not_found`,
`containment_violated`, `invalid_request`, `database`, `internal` — so an agent branches on the
discriminant rather than parsing a message.

## Implementation Phases

1. **Data layer** — schema, migrations, Tauri commands, integration tests. No UI.
2. **Mindmap view** — SVG-based balanced tree editor (horizontal or vertical) with full keyboard interaction.
3. **List view** — filterable task list sharing the Mindmap's filters plus its own preset (All/Plan/Start/Do/Backlog/Unblock) and pill-filter dimensions. Complete.
4. **KB resources backend** — People, Events, Threads, Scopes as local DB entities. Obsidian integration stubbed behind an adapter interface.
5. **Obsidian integration** — replace stub adapter with real Obsidian local-rest-api client. Note discovery, bidirectional sync.
6. **Time Scopes** — Parts of Day and Exact scopes; datetime-boundary resolution (cached) and `active`; Time Scope (relevance) vs Plan split with interval-containment invariants and write-time enforcement; the Scope Picker component. Schema → commands → picker UI. See ADR 0001.
7. **Flows** — Flow node kind and dedicated creation; Instance Type, Target Node, flow scope; flow items with Cycle Scope/Plan; start modal; materialization as real independent copies with per-instance dependency remapping. See ADR 0002.
8. **Habits** — Recurrence (Repetition + configurable Consumption); virtual instances with overlay table keyed by `(flow item, iteration scope)`; ellipsis display + pinning; archiving and scope-edit reconciliation. See ADR 0002.
