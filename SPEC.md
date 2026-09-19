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

Goals are never List View *rows*; they appear instead as a segment of a row's **path header** there (see List View below). (Commitments are not rows either — they get their own section above them; see List View.) Goals can be depended on by Tasks; a Goal-dependency blocks a Task until the Goal is Achieved.

### Tasks

Tasks represent action items. Fields: title, parent (Project / Goal / Domain / Task), tags (list), KB resource links, status, blockers, dependencies, delegation, agentic, beads id.

**Status:** To Do / In Progress / Done

**Blockers:** A Task (and a Goal) can carry an **ordered list of explicit block reasons**, edited in its editor (add / remove / reorder rows). A Task is **additionally** blocked *virtually* by any dependency on a non-Done Task or non-Achieved Goal, with reason `"Blocked by {kind} {id} ({title})"`. The two combine: a Task/Goal reads as **blocked** on the canvas (red stop-sign) when it has **any** reason — explicit or virtual. Explicit reasons live in their own `block_reasons` table (polymorphic `owner_type`/`owner_id`, ordered by `position`); virtual reasons are derived at read time from the dependency edges, never stored. Cross-table type conversion copies the explicit reasons to the new node.

**Dependencies:** Tasks can depend on other Tasks or Goals. Circular dependencies are rejected at write time.

**Delegation:** A Task can be delegated to a Person.

**Agentic:** A Task can be marked **Agentic** — work that suits being handed to an agent. It is a stored three-state flag (`agentic` — NULL / true / false), not a boolean, because it **inherits downward and is overridable**, exactly as Delegation does: a Task with no value of its own reads its nearest flagged ancestor, so marking a whole branch is one edit, and an explicit value replaces what would have been inherited — including an explicit **not agentic**, which is how one Task comes back out of an agentic branch. The value inherits *through* Goals, Projects and Domains, which carry no flag of their own.

It is **Tasks only**: an agent performs actions, where a Goal is a desired state and a Commitment is kept rather than done. It is also **independent of Delegation** — the flag says the work suits an agent, a delegate says who holds it, so a Task may be both, either or neither, and the delegated/undelegated filter is untouched by it. Set from the **Advanced** section of the Task editor (Inherit / Agentic / Not agentic, with the Advanced section opening on arrival when the Task carries an explicit value), and from the bare **A** binding in the Mindmap and List View, which is a **two-state toggle over the resolved value**, not a cycle through the stored one: it reads what the Task currently *reads as* and writes the opposite — agentic → explicit *Not agentic*, anything else → explicit *Agentic*. The flag stores three states but a Task only ever shows two, and *Inherit* under a non-agentic parent is the same picture as an explicit *Not agentic*, so a cycle spent a press moving between them with nothing on screen to show for it — marking a fresh Task agentic appeared to take two presses. The consequence is deliberate: **the key can no longer return a Task to *Inherit***, which is an editor-only state, and a press on a Task that was merely inheriting *yes* pins it to an explicit *no*. That is the price of no press being invisible. Creating a sibling with `Shift+Enter` carries over the source Task's **own stored** value, explicit or not-set — the stored column, never the resolved one, since freezing an inherited *yes* into an explicit one would silently cut the new Task off from the ancestor deciding for it, which the ordinary downward rule already covers. It is shown as its own **status-row badge** in both views, on a Task that reads as agentic whether it said so itself or inherited it; and filterable as its own List View pill dimension. Retyping a Task to any other kind drops an explicit flag and names it in the confirmation prompt alongside every other lost field; duplicating a Task copies it, all three states alike. A one-click **delegate** button belongs beside the flag once Delegation can point at an Agent rather than only a Person; the slot is left for it and nothing about this dispatches anything.

**Time Scope & Plan:** A Task carries a **Time Scope** (relevance window) and an optional **Plan** (a single scope it is scheduled into). Goals carry a Time Scope but no Plan. See *Time Scopes & Planning* below.

**Backlog:** A Task may be put in the **Backlog** — deliberately set aside, not in play now, kept for later. It is the Task-side answer to what **Frozen** already does for a Goal or Project, and it is a stored **Archival** value (`live` / `backlog`) rather than a fourth status: status keeps meaning *where the work stands*, Archival *whether it is in play at all*, so a backlogged Task that was In Progress still says so when it is pulled back, and the Enter status cycle is untouched. **Frozen** stays Goals/Projects-only and **Backlog** Tasks-only; they are separate states and neither maps to the other on retype (a Frozen Goal retyped to a Task arrives as a plain To Do Task, as before; a backlogged Task retyped to any other kind comes back into play, and the dropped Backlog is named in the retype confirmation prompt alongside every other lost field — see *Retyping (backend)* below). A backlogged Task is hidden from **Plan** and **Start** together with its whole subtree, shown under **All**, browsable on its own through the **Backlog** preset, and marked with its own status-row badge (not the Frozen snowflake). It is set and cleared from two places that mean exactly the same thing: a **Backlog** switch in the **Task editor**, as a switch rather than a status pill, since it is a separate axis from where the work stands — a backlogged Task keeps whatever status it had; and the bare **B** binding in the Mindmap and List View. The Goal editor has no such control and never gains one: a Goal is set aside by its own **Frozen** status. Backlog is deliberately *not* protective: a scoped backlogged Task whose window lapses unfinished still resolves **Missed** and archives, flagged as a conflict — see *On-exit behavior* below.

**Invariant: a Task is never both backlogged and planned.** Enforced at write time, asymmetrically, because the two directions differ in how much they throw away: backlogging a Task that has a Plan is **refused pending confirmation**, prompting with the option to clear the Plan and backlog in one action (declining leaves both untouched); setting a Plan on a backlogged Task simply takes it out of the Backlog, with no prompt — the gesture is unambiguous — and raises a **toast**, so the change is never silent.

A Task's **goal**, **project**, and **aspect** are resolved as the nearest ancestor of each type.

### Commitments

Commitments represent things that must be **kept** rather than **done**: an obligation or an abstention held over a window — "asleep by 23:00", "no social media today". Fields: title, parent (Project / Goal / Domain / Task / Commitment), Time Scope, **Verdict**, **Verdict Window**, tags (list), KB resource links, privacy, beads id.

A Commitment is its own content node kind, not a flag on Task, because its resolution runs the opposite way round: a Task untouched when its window closes is **Missed**, whereas a Commitment untouched may well have been **Kept**. A Goal is no better a home — it can be Achieved, Frozen or Archived, but has no vocabulary for having been *broken*, which is the single most important thing this kind has to record. See `docs/adr/0005-commitment-node-kind.md`.

**Verdict:** Unresolved / Kept / Broken. **Never derived** — not from the window passing, not from children completing. `unresolved` means only *you have not said*, which is real information that any defaulted verdict would destroy. Finishing every child Task of a Commitment therefore does **not** mark it Kept: credit is for the outcome, not for the sub-steps. Children's progress shows beside the verdict as a hint, and nothing more. A polarity field (abstentions default Kept, obligations default Broken) was considered and rejected on exactly this ground.

**Verdict Window:** how long past the end of its Time Scope a Commitment stays answerable — a **Duration**, a count of N of any scope kind, in the same `(n, kind)` form a Habit's **Gap** and a Time Scope's Duration take. Its kind is independent of the Commitment's own window, so a monthly commitment can be answerable for two days and a daily one for a week. Null inherits the nearest ancestor Commitment that sets one; nothing above setting one means it never expires, and there is no global default. Once `window end + N × kind` has passed with the Verdict still `unresolved`, the Commitment's effective **Archival** becomes **Archived** — still unresolved. **This is the only automatic state change in the kind, and it moves Archival, never the Verdict:** not having judged something is itself part of the record, and it stays visible under **All**.

**Lifecycle.** **Timing** (Pending / Active / Lapsed) reads the window alone, as for every other kind. **Resolution** is replaced by the Verdict. **Archival** is Live until either a verdict is recorded *and* the window has passed (the commitment is settled), or the Verdict Window runs out unresolved. There is no per-node On-exit behavior: a Commitment always Keeps, and the Verdict Window is what eventually ends that.

**Required scope.** A Commitment must have an **effective** Time Scope — its own, or inherited from a scoped ancestor. It is the first kind in the model for which being **Unscoped** is invalid rather than merely always-active: a rule held over no window has nothing to be kept or broken over, so one with no scoped ancestor at all is refused at write time. Inheritance is what makes this liveable — several of tonight's commitments sit under one scoped parent without repeating the window on each.

The rule is enforced at write time, but it is **not** enforced by hiding the option: Commitment stays in the `Ctrl+↑/↓` cycle whether or not a window is in reach, because an option that silently is not there reads as a missing feature rather than as a rule. The refusal is instead put to the user as a question — pick a window for it, or cancel — raised off the backend's refusal rather than predicted in the frontend, so a node that already inherits a window is never asked for one it has. The window chosen in answer rides on the `retype_node` call itself rather than being written to the source node first, so the conversion stays one atomic write: cancelling leaves the node exactly as it was, and there is no half-retyped state to recover from.

**Children and the graph.** A Commitment holds Tasks (the supporting steps: "phone on charger", "set alarm") and other Commitments ("no social media this month" containing each day's), with the usual containment rule between a parent Commitment's window and a child's. It holds no Goals. It is **never scheduled** (the window *is* the commitment, so there is no Plan), and takes **no part in the dependency graph in either direction** — nothing gates it and it gates nothing. It is neither delegable nor blockable.

**Recurrence** rides the existing Flow/Habit machinery rather than a second engine: a Flow's **Instance Type** extends from `goal | task` to `goal | task | commitment`, so a nightly "asleep by 23:00" gets Recurrence, Iteration and catch-up as they already are, and each night's verdict is a Modification row keyed by `(flow item, iteration scope)`. Consumption is fixed to Accumulating + Overlapping for commitment habits — **refused at write time**, not merely documented — because the Verdict Window is the bounding mechanism instead: under Destructive a passed iteration classifies **Lapsed**, a derived "went unfinished" the kind forbids, and under Blocking one unanswered night would withhold every night after it. The Habit's Verdict Window lives on the flow row (`verdict_window_n`/`verdict_window_kind`, migration `0028`), because a virtual iteration has no Commitment row to carry one and the Target Node is normally a Project or Domain, which carries none either. It is set in the flow editor, which offers the field only for a commitment Instance Type and clears it when the flow stops being one — a window on a goal or task Habit would be a value nothing ever reads. A commitment flow likewise has no **root Cycle Plan**: the window *is* the commitment, so there is nothing to schedule it into. An iteration whose Verdict Window has run out with no verdict recorded derives as **Expired**: archived, still unresolved, and never Missed. A commitment flow holds **no goal items** — a Commitment cannot parent a Goal, so such a template would derive no iterations at all: `Ctrl+↑/↓` does not offer `flow_goal` on one, `create_flow_goal` refuses it, and a flow that already holds goal items is refused the switch to `commitment` rather than being allowed into that state and told about it afterwards.

**Retype.** Commitment joins the `Ctrl+↑/↓` cycle immediately after Task, and goes through the same atomic `retype_node` path as every other kind. Nothing translates between a status and a Verdict in either direction — `done` is not `kept` — so a non-default status is reported as lost on the way in and a recorded verdict on the way out, through the existing confirmation prompt. Title, position, privacy, tags, Time Scope and the beads id carry across.

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
- **Archival** — the item's *effective* archived/frozen/live state, driving the status row's archive-box badge (below) and the Mindmap's **Archived** filter (Filtering, below). Every item may carry a manually-set Archival of its own: a Goal/Project through its status (**Frozen** / **Archived**), a Task through its **Backlog** flag (see *Tasks* above) — a Task is never manually **Archived**. A **Commitment** carries none at all: its Archival is derived from its Verdict and its **Verdict Window** (see *Commitments* above), and nothing about it is ever set aside by hand. A **Completed** or **Missed** Resolution unconditionally forces the *effective* Archival to **Archived** regardless of what is stored, even overriding a manually-set **Frozen** *or* **Backlog**; when it does, the status-row badge flags the resulting **conflict**. **Overdue** never forces anything: the item stays whatever is stored. Backlog and Frozen lose to a forced Archived on identical terms — chosen deliberately over letting Backlog win, so that setting a scoped Task aside does not quietly exempt it from its own window.

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

A Flow has a title, an **Instance Type** (goal, task or commitment — what its root materializes as), a **Target Node** (where instances are created — **optional**: unset means the Flow's own parent, derived on read rather than stored, so a move carries the instances along, while a stored target is a deliberate override a move leaves alone), and a **Flow Window**. The Flow Window is either a **Span** — a coarse Duration of N of `day`/`week`/`month`/`season` (a relative length, snapshotted against the start anchor) — or a sub-day **Phase** — a fixed time-of-day carried date-free on the template: a part-of-day band (e.g. Evening) or an exact `HH:MM–HH:MM` range. Starting supplies only a date; a Phase window is combined with that date via the part/exact scope constructors. A Habit with a Phase window recurs at the fixed time-of-day, stepping whole days by its Gap. A **task-instance** flow may also carry a **root Cycle Plan** — a relative plan window inside the flow window (like a flow item's Cycle Plan) — resolved into the root Task's Plan on start; goal-instance flows have none (Plan is task-only).

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

A **Habit** is a Flow with a **Recurrence** pattern (a flow becomes a Habit when given a Recurrence — stored in a `flow_recurrences` row keyed by the flow, whose presence marks the flow as a Habit; a Habit requires a scoped flow). Its instances are generated automatically and are **virtual**: each is identified by `(instance, iteration scope, cycle pair)` — where an instance is a flow item **or the flow root itself** (the root materializes as a normal Task/Goal, so it is a first-class completable instance, not merely an aggregate of its items; an item-less habit therefore still has one instance, its root) — and rendered from the template, with only divergences (status, edited fields, dependencies, deletion/archival tombstones) persisted as **Modification** rows. The **cycle pair** is part of that key because a flow item with N pairs draws N instances in a single iteration, exactly as it materializes N items when the flow is started: a morning and an evening occurrence of the same item are two things to complete on the same day, and ticking one must not tick the other. The root, and any item with no pairs, key on the `0` sentinel. The root instance's title reads `{flow title} {start scope}` (e.g. "Exercise W22").

**Recurrence** = **Repetition** + **Consumption**:

- **Repetition** — a Start anchor, an optional **Gap** of N of a scope kind ≥ the habit scope (default: no gap, continuous), and an optional end.
- **Consumption** (per-habit, user-configurable tree):
  1. **Destructive** (unfinished instances lapse when their iteration passes; bounded) vs **Accumulating** (they survive).
  2. If Accumulating: **Overlapping** (new iterations generated regardless) vs **Blocking** (withheld while unresolved instances exist).
  3. If Blocking, the **catch-up policy** when the open iteration completes: *all pending* (every missed iteration, in order), *next* (advance by one), or *latest* (jump to current, recording skipped iterations as missed tombstones).

**Generation.** Iterations are **derived**, never persisted per iteration: a pure function of the Recurrence, the reference day, and the completed iterations (the only persisted facts — a completed instance carries a `resolved_at`). Each started iteration is classified `Active` / `Done` / `Lapsed` (Destructive, passed unfinished) / `Missed` (a Blocking `latest` skip). Only iterations whose window has begun are generated; future ones are the ellipsis. An iteration is *resolved* when every one of its (non-tombstoned) instances is done. Consumption semantics: Destructive lapses any past unfinished iteration and keeps only the current window active; Overlapping keeps every started iteration active until done; Blocking withholds beyond the open iteration and, on completion, advances by **next** (release the next), **latest** (jump to the iteration containing the completion day; skipped ones become Missed), or **all pending** (release the whole backlog up to the completion day as active, blocking again beyond it). **Each instance carries its own window.** A flow item's Cycle Scope resolves against *that iteration's* window start — backend-side, through the same offset arithmetic `start` uses, so a rendered occurrence and a started one cannot disagree about when "the 2nd day of week 3" falls — and the instance's Timing is read from it rather than from the iteration's. A Morning item inside a day-long iteration is Active during the morning and, under Destructive, Lapsed from noon; a Tuesday item inside a week-long one is Active on Tuesday alone. Sub-day windows obey **Consumption** like every other size: an Accumulating habit's passed occurrence piles up rather than lapsing, and if a morning routine should vanish at noon, Destructive is what says so. An occurrence whose window has not opened is **Pending**, and whether it renders is the **status preset's** decision, not generation's: **All shows it** — All's contract is that it shows everything, and a Habit's later-today items are exactly what one looks at All to see — while **Plan, Start and Do hide it**, together with its own subtree, so this evening's item does not sit among the morning's work (children nest under their parent's first occurrence and would otherwise be redrawn a level up). The occurrence is generated and sent either way; dropping it backend-side put it beyond every preset at once. The rule is scoped to the occurrences a Habit generates in bulk: a hand-made task scheduled for next week is Pending too and still plans, as it always has. (Exact-time `HH:MM–HH:MM` cycles stay deferred with the cycle editor that would enter them.) A Destructive iteration's virtual instances (root and items alike) map onto the Task/Goal Archival model above once their window has passed — a past-window instance is *effectively archived* regardless of whether it's `Done` or `Lapsed`, so a habit occurrence with some items completed and others missed still archives as a unit, rather than partially lingering visible via its completed siblings.

**Display.** Instances render under the Target Node — the Flow's own when it has one, otherwise its parent (and, only if that parent is not in the rendered tree, the Flow node itself). Active and past instances render directly; an **ellipsis node** stands in for future instances (which can be unbounded under overlapping/open-ended recurrence). Double-click/double-enter the ellipsis to open a search combobox of virtual instances; selected ones are **display-pinned** (still virtual) and render on their own.

**Commitment habits.** An iteration of a Habit whose Instance Type is `commitment` renders as a **Commitment**, not as a Task or a Goal: the commitment glyph, the Verdict badge, and the two verdict controls in List View's commitments section — never a status control to cycle. That iteration's Verdict is its **Modification** row, in the same `status` slot an ordinary instance keeps a task status in; clearing it back to Unresolved removes the row, exactly as un-completing a task instance does. Nothing translates between the two vocabularies: a stale `done` is not read as `kept`. The items beneath the iteration are the flow's **task** items, rendered as Tasks — the supporting steps a Commitment legally parents — and, per *Commitments* above, none of them ever gates the verdict. A commitment flow whose template holds a **flow goal** has no valid materialisation at all, since a Commitment holds no Goals: `start` is refused by `goals.parent_type`, and a Habit derives **no iterations** rather than drawing a subtree the model forbids — the Mindmap's load-condition banner names every flow it withheld, so nothing goes missing quietly. One consequence of a virtual iteration having no Commitment row of its own: its Archival is derived here rather than by the lifecycle — past **and** judged is settled and archives; past and unjudged stays live, because the answer is still owed, and is never **Missed**. What ends "still owed" is the **Verdict Window**, which the Habit carries on the flow row (see *Recurrence* above) and every one of its iterations resolves to: the backend derives such an iteration as **Expired**, and it archives still unresolved. Expiry is checked before the past-and-unjudged rule, because under the Accumulating + Overlapping Consumption a commitment Habit is fixed to, an unanswered iteration classifies Active rather than Lapsed right up until it expires. A Habit with no Verdict Window set keeps its iterations answerable indefinitely, exactly as a Commitment with none anywhere above it does.

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
| Agentic (Tasks)        | Override — child's explicit value (agentic *or* not agentic) replaces the inherited one; inherits through unflagged kinds |

Inherited links are computed on read (ancestor traversal). To be revisited if performance becomes an issue.

---

## Filtering Logic

Filters apply to task/goal lists. Any number of filters can be active simultaneously, each in one of three modes:

- **Any** — item must match at least one Any-mode filter
- **All** — item must match every All-mode filter
- **Exclusion** — item must not match any Exclusion-mode filter

Combined logic: `(union of Any-filters) AND (intersection of All-filters) AND NOT (union of Exclusion-filters)`

Filterable fields: parent domain/task, dependency, status, delegate-to, delegated/undelegated, agentic, Person/Event/Thread/Scope, planned scope, Project, Aspect, Goal, Tag.

**Focus exemption.** The **selected** node renders whatever the filter says about it, for as long as it stays selected — so a node that stops matching *because of your own edit* (completing a Task under Plan, cycling a Task to a Goal under Do, marking something Private) stays where it is instead of vanishing out from under you. It renders **dimmed**, carrying the status-icon badges that already say why it no longer matches; there is no new chrome. It overrides **every** hiding rule, the hard-hiding ones included — Private Mode, the Info/Flow type toggles, a shelved Project, a blocked subtree under Start — not just the soft preset/tag/pill filters. That is safe because toggling any of those *is* a filter change, which ends the exemption, so a private node can never survive into a Private-Mode-off view; the only case that survives is one you just marked private yourself, while still on it.

It **ends** when focus leaves — the selection moves, or Escape clears it — and on filter change, subtree change and reload. Nothing about it is persisted. It never resurrects a node: arrowing away removes it, and arrowing back does not bring it back, because it is no longer on screen to arrive at.

The exemption covers the focused node **and every ancestor needed to reach it**, and nothing else. The Mindmap keeps a non-matching node only as the ancestor of a match, so exempting a node without its chain would draw it detached; an ancestor that surfaces only to carry it is dimmed too, and carries nothing else with it — revealing (say) a private Project as an ancestor does not spill the rest of its subtree into the view. The List View needs no chain: its rows are Tasks, and a row's hidden ancestors are already named in its path header, so there the exemption is exactly one row, held in its own place in the list.

It is a **render-time** exemption: the filter's definition is unchanged and the filter's own answers are unchanged. Anything that counts, filters or exports off the filter sees exactly what it saw before — only the view holds the extra node.

---

## Views

### Tabs

Arlesh holds several places on the board open at once. A **tab** owns everything about a view of
the board — its **subtree root**, whether it shows the Mindmap or the List, its branch orientation,
its whole Mindmap filter set, its whole List View filter set, its selection, its collapsed nodes and
its pan/zoom — and switching tabs swaps all of it at once. "What is left in Bugfixes" and "what am I
doing today" are two different subtrees under two different presets, and a tab each is how both are
held. Nothing a tab owns is reachable from another tab: exiting a subtree, changing a preset or
collapsing a branch in one leaves every other exactly where it was.

**Theme and the clipboard are app-wide**, along with the Undo/Redo stacks and the List View's
**Path icons** preference. The clipboard deliberately so — cutting a subtree in one tab and pasting
it in another is the obvious thing to want from a second tab, and nothing about a clipboard is
specific to where it was filled. The theme likewise: the app must not change appearance as you move
between tabs. The branch axis is per tab, because a wide subtree may want to be vertical while
another stays horizontal; path glyphs are not, because they are a matter of taste about how the
List View reads, the way the theme is.

**The strip** sits above the top bar, so the top bar stays the active tab's controls and does not
have to know that tabs exist. Each tab is labelled by the subtree it is rooted at; one showing the
whole tree is labelled **All** rather than left nameless. The strip offers a **+**, an **×** per
tab, **middle-click** to close, and **drag** to reorder.

**Naming a tab.** A tab can be given a name of its own — right-click it for a small menu of
**Rename tab** and **Close tab** (the second doing exactly what the × does, last tab included).
Rename turns the label into a text field in place: **Enter** commits, **Escape** cancels and leaves
the name as it was, clicking away commits what was typed, and the field opens focused and selected.
The strip truncates as it always did, so a long name reads in the tab's tooltip.

The name is a **separate field beside the derived label**, not a value written into it. The label is
rewritten from the subtree descriptor every time a tab is navigated, so a name stored there would
survive exactly until the next navigation and then vanish with nothing said. Held beside it, the
name simply wins while it is set while the label carries on being maintained underneath — which is
also what makes clearing it safe: **committing an empty name takes the name off**, and the label
that reappears is already the one for where the tab is now, not the one it had when it was named. An
empty field shows that label as its placeholder, so what clearing would give back is on screen
before you commit it. There is deliberately no second "reset" entry in the menu: emptying the field
is the one way back, and a menu item that only sometimes applies is worse than a field that always
does. A tab's name is never derived from anything, so nothing but the user ever changes it.

The menu is its own component rather than the Mindmap's node menu generalised: every branch in that
one asks a question about a node — its kind, its parent's kind, what it already contains, what is on
the clipboard — and none of them can be asked of a tab.

**Shortcuts** follow the browser conventions, and are declared in the same registry every other
binding is (`src/utils/hotkeys/`), so the cheat-sheet lists them with the rest:

- `Ctrl+T` — open a tab **at the current subtree root**, so opening one to look at something nearby
  costs no navigation. Everything else about it is fresh: a new tab does not inherit filters.
- `Ctrl+W` — close the tab. Closing the **last** tab closes the window, so there is never an empty
  one left over. The app takes `Ctrl+W` itself (capture-phase, `preventDefault`); Arlesh declares no
  native menu accelerator that would claim it first.
- `Ctrl+Tab` / `Ctrl+Shift+Tab` — cycle forward and back, wrapping at both ends
- `Ctrl+1`–`Ctrl+9` — jump to a tab by position

These are **global** bindings: unlike the view-level ones they stay live while a modal or the
cheat-sheet is open, because switching tabs is never ambiguous about what it would act on. They are
still suppressed inside a text input, like every other binding.

**The board alone.** `F11` hides the tab strip and the top bar, leaving the view filling the window;
`F11` again brings them back. Bare `F` does the same, but **only when nothing is selected** — with a
selection, `F` keeps its existing meaning of converting that node to a Flow, and in List View the
same rule holds so one gesture does not mean two things depending on which view you are in. The two
`F` bindings carry complementary guards, so exactly one is ever eligible and the order between them
cannot matter.

This hides *Arlesh's own* chrome and leaves the OS window alone, so it works windowed as well as
maximised. The mode is **app-wide, not per tab** — it is a way of looking at the app for a while
rather than a property of the place you are looking at, and hiding the strip in one tab while
another kept it would make switching tabs resize the board. It is deliberately **not persisted**:
reopening Arlesh with no chrome and no visible way back is a bad first second, and re-entering costs
one keystroke. Every tab shortcut stays live while the strip is hidden — the bindings never depended
on it being drawn.

**Persistence.** The tab list, its order, which tab was active, any name a tab was given, and each
tab's subtree root, view, orientation and both filter sets are restored on reopening. A strip
written down before tabs could be named comes back as tabs with no names, labelled as they were. Selection, collapsed nodes and pan/zoom
are **not**: they are working state, and coming back to a stale selection is worse than coming back
to none. A restored subtree root whose node no longer exists falls back to the true root rather than
leaving a tab rooted at nothing. A session saved before tabs existed comes back as a single tab
carrying its view, orientation and filters.

Tearing a tab off into its own window — and anything else multi-window — is a separate piece of
work and is not described here.

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
- `Tab` / click — create a child cell, of the kind the parent implies
- `Shift+D` / `Shift+P` / `Shift+G` / `Shift+T` / `Shift+C` / `Shift+I` / `Shift+F` — create a child of a **named** kind under the selection (Domain, Project, Goal, Task, Commitment, Info, Flow), bypassing the inherit-the-parent default. `Shift+F` and `Shift+C` open an editor rather than creating a blank row, because both kinds are configured before they exist: a Flow by definition, and a Commitment because it **must** have a window, its own or an inherited one, and a rule that could never come due is not worth writing and fixing up afterwards. A parent that cannot hold that kind **creates nothing and says why** in a toast naming the rule — deliberately not the retype behaviour of climbing to the nearest acceptable ancestor, because putting the node somewhere other than where you pointed is worse than not creating it, while silence would read as a broken key. With **nothing selected** they do nothing at all, not even a toast. The parenting rules are the same ones drag-and-drop and paste enforce, so the three can never disagree. `Shift+C` is free alongside bare `C` (centre on the selection) and `Ctrl+C` (copy), which strict chord matching keeps apart. The Commitment editor opens on a blank commitment with its Time Scope empty, whether or not a window is in reach: the chord behaves the same everywhere rather than branching on what the backend would have said, and asking for a window is exactly what the type cycle does too. Saving with no window of its own and none above it is still refused, and the refusal shows **in the editor**, on the fields that would answer it, instead of closing on a save that did not happen
- Arrow keys — move between cells; with **nothing selected**, they pan the canvas instead
- `Shift+arrows` — extend the selection across siblings (on the sibling axis for the current orientation; on the branch axis they navigate as usual)
- `Alt+↑` / `Alt+↓` — move the cell among its siblings
- `Ctrl+↑` / `Ctrl+↓` — cycle the cell's type through: Domain → Project → Goal → Task → Commitment
- `Enter` — with a node selected: cycle a task's status / toggle a goal's achieved (double-tap enters a container as a subtree); **with nothing selected: focus the current display root**
- `Shift+Enter` — create a sibling cell (a Task sibling carries over the source Task's **own stored** Agentic flag — see *Tasks* above); `Ctrl+Enter` — insert a parent above
- `F2` / `R` — rename the selected cell
- `E` — open the selected cell's editor; `Double-click` does the same
- `B` — put the selected Task in the Backlog, or take it out (real Tasks only — a virtual Habit occurrence has no row of its own to set aside, so the binding is inactive on one rather than silently doing nothing)
- `A` — toggle the selected Task's Agentic flag: whatever it reads as now, one press writes the opposite (**Agentic ↔ Not agentic**); *Inherit* is resolved through, never written, so returning a Task to it means opening the editor (real Tasks only, on the same reasoning as `B`). Bare letters are flags on the selected Task, `Alt`+letter is a status preset, so `A` and `Alt+A` (the **All** preset) coexist exactly as `B` and `Alt+B` do — chord matching is strict about modifiers
- `Delete` — delete the selection
- `Ctrl+/` — collapse or expand the selected cell
- `Ctrl+X` / `Ctrl+C` / `Ctrl+V` — cut / copy / paste
- `C` — center the view on the selection; `Ctrl+=` / `Ctrl+-` (and numpad `+`/`-`) — zoom
- `S` — start the selected Flow; `F` — convert the selected cell to a Flow
- `Ctrl+O` — search for a node by title
- `Alt+F` — toggle the filter menu; `Alt+A` / `Alt+P` / `Alt+S` / `Alt+D` / `Alt+B` — jump to the **All / Plan / Start / Do / Backlog** status preset (matched by physical key)
- `Escape` — deselect; `Shift+Escape` — go back one level when inside a subtree; `Ctrl+Escape` — go back to the root
- `Ctrl+Z` — undo the last thing you did to the board; `Ctrl+Shift+Z` (or `Ctrl+Y`) — redo it
- `Alt+L` — switch between Mindmap and List View; `Ctrl+Shift+/` — open the keyboard cheat-sheet
- `Right-click` — context menu (enter subtree, change type, delete, etc.)
- Back button / back-to-top button available in the UI

A shortcut requires exactly the modifiers listed — `Ctrl+E` does not open the editor, only a bare `E` does. Every binding above is declared once in the shared hotkey registry (`src/utils/hotkeys/`), which is also what the cheat-sheet renders, so this list, the overlay, and the handlers cannot disagree. The view-level bindings (Mindmap and List View) are suppressed whenever a modal or an inline rename is on screen; the global ones (`Alt+L`, `Ctrl+Shift+/`) always stay live. That suppression is driven by the modals and inline editors themselves, each registering while it is mounted (`src/stores/use-input-capture-store.ts`), rather than by the views tracking which of their own state flags imply an open modal — a flag can outlive the UI it describes, and a stale one would silently kill every view binding until the view remounted.

**Modals and focus.** `Escape` dismisses any modal, and a modal is dismissable the instant it appears — so every modal **takes focus when it opens**, because dismissal is handled on the dialog element itself and a dialog holding no focus would not hear the key until the user tabbed or clicked into it first. Where that focus lands is decided per modal, not by DOM order. An **editor** focuses its own first field and selects its contents, so typing replaces the title rather than appending to it. A modal that exists to be **answered** focuses the answer that is safe to give by reflex: `WarningConfirmModal`, the convert-to-flow prompt and the commitment-window prompt focus **Cancel**, so the consequences are read before anything acts on them, while `DeleteConfirmModal` focuses **Delete**, the one case where the answer is known before the modal opens and confirming should stay a single key. Opening focus never lands on a toggle, where a reflex `Space` would change a stored setting instead of dismissing the dialog.

**Entering a subtree:** Right-clicking a cell and selecting "Enter" re-roots the map at that cell; `Ctrl+O` does the same from the node search, in either view. Navigation back: back button, back-to-top button, `Shift+Escape` (up one level), or `Ctrl+Escape` (straight back to the root).

The subtree root is **shared between the Mindmap and the List View**, not per-view, and **owned by the tab** rather than by the app: entering a subtree in one view and switching to the other leaves you in the same place — the same reasoning that makes the two views share a tree and a filter rather than drifting apart — while every other tab stays exactly where it was. The List View honours it by flattening from the subtree root's **children**, so it lists exactly the Tasks beneath it and the subtree root is **trimmed out of the path headers entirely** — inside `CODE`, a header reads `Goal Alpha`, not `CODE › Goal Alpha`. Where you are is named once, by the top bar's subtree indicator, instead of being repeated on every header. Trimming happens by scoping the *walk* rather than editing the paths afterwards: a row's ancestors are just the nodes stepped through to reach it, so the root is never collected in the first place and a header's `segments` and a row's `visibleDepth` go on partitioning those ancestors exactly — an after-the-fact trim would leave the indentation claiming a parent the header no longer names. One consequence: a row whose only ancestor *was* the subtree root now has an empty path and gets **no header at all**, the same handling a task with no ancestors already gets at the true root.

Because the top bar holds no tree of its own, whichever view is mounted resolves the descriptor for it (`src/hooks/use-subtree-nav.ts`) — so the indicator and the pills are correct in both views, rather than only in the one that happens to own the subtree logic.

**Status-icon row:** below each node sits a compact row of status badges (aligned to the node's left edge), each with a hover tooltip. A **clock** marks a Time Scope (tooltip = the window; crossed out once the window has passed); a red **exclamation** flags an **Overdue** item and an **archive box** any item whose *effective* Archival is **Archived** — an explicitly-Archived Goal/Project, or any scoped Task/Goal whose Resolution is **Completed** or **Missed** — tinted as a warning when it's a **conflict** (a manually-Frozen item that scope forced into Archived); a **calendar** marks a Plan (tooltip = the plan window); a **snowflake** a Frozen goal/project and a **tray** (three stacked lines) a Task in the **Backlog** — a badge of its own, since Backlog and Frozen are distinct states, and one that can appear alongside the archive box when a lapsed window has forced Archived over it; a small **bot head** marks a Task that reads as **Agentic** (see *Tasks* above) — its own flag or an ancestor's, since a branch marked in one edit must look marked all the way down; **no badge carries a Commitment's Verdict** — the node glyph itself does (see *Commitments* above: hollow while the answer is owed, solid once given, cleft when broken, struck through once the Verdict Window has run out), so the row would be restating it a few pixels below; every badge here says something the glyph does not; an **ellipsis** an Info node carrying a Details description (tooltip = the text); a **wave** a real Start-flow instance and the **cyclical habit glyph** a virtual Habit iteration; and a **tag** icon a node with tags (tooltip = their names). Badges appear only when relevant, so most nodes show few or none. The set of badges is a pure function of the node; scope/plan/tag tooltips resolve their labels on demand.

**Top bar:** sits below the tab strip and belongs to the **active tab** — every control on it reads and writes that tab. At the start edge, a settings **gear** (popover with a **Light mode** switch, a **Keyboard shortcuts** entry, and the two view-scoped display switches — **Vertical layout** on the Mindmap, **Path icons** in the List View — each shown only while its own view is active; the theme and **Path icons** are app-wide, the branch axis is per tab; all persisted, theme defaults to dark and applies via a `data-theme` attribute and matching `tokens.css` overrides); a **Mindmap/List** view tab pair (also toggled by `Alt+L`); a **status-preset dropdown** (All/Plan/Start/Do, plus a 5th **Unblock** option while List View is active — see List View below) — a dropdown rather than a segmented control so it stays compact next to the tabs, built as a themed `Select` (listbox popover styled from the app's own tokens, with arrow-key/Enter/Escape keyboard support) rather than a native `<select>`, whose open option list ignores CSS and renders with plain OS chrome; the subtree **back-nav pills** and the **current-subtree indicator** (all shown only inside a subtree — the two pills are the ways out, `↑` to the root and `←` up one level, while the indicator is a static, non-interactive pill carrying a subtree glyph and the title of the subtree you are in, since "here" has nowhere to navigate to; its glyph is `aria-hidden` like the others, so it carries a visually-hidden "Inside subtree:" label to keep a screen reader from hearing three bare titles in a row); and, at the end edge, a **Filter** button (funnel) that opens the filter popover. Below the bar, a wrapping row of **active-filter chips** renders whenever any filter is engaged (empty and takes no space otherwise) — every active tag filter and, while List View is active, every active List-View-exclusive pill filter (see below). A chip shows a mode symbol (∪/∩/∅) and the filter's name; clicking the chip body cycles Any → All → Exclude, and an embedded **×** removes it. A chip's border/symbol color is a muted accent for its mode — a fixed, low-key hue per mode shared across every dimension, blended most of the way toward the neutral border rather than shown at full strength; its background additionally tints toward the value's resolved aspect color where one exists (tags, Parent, Dependency).

A **keyboard cheat-sheet** overlay is available from that settings entry or with `Ctrl+Shift+/`: it lists every binding in the app, grouped into **Global / Tabs / Mindmap / List View**, with the chords that share an action merged onto one row (so the four arrow keys read as a single `← → ↑ ↓` line). The list is rendered from the same binding registry the keyboard handlers dispatch from, so it tracks the handlers automatically rather than being maintained by hand.

**Mindmap filter:** prunes the displayed tree — a node is hidden unless it matches or has a matching **content** descendant (ancestors of matches stay, keeping the map connected). The **selected** node is exempt from all of it, together with the ancestor chain that reaches it, for as long as it stays selected (Filtering Logic, above). Info notes are *attachments*: they ride along with a kept node but never keep one (an achieved goal whose only children are notes is still hidden). The **status preset** lives in the top bar (see above); the popover opened from the **Filter** button is a pure **"add a filter"** chooser — active filters never render inside it, only candidates not yet selected (picking one adds it and it disappears from the list, mirroring the top-bar chip it now appears as). Sections group into a few always-expanded clusters rather than one long list or a collapsed "Advanced" toggle:
- **Status preset** (single, in the top bar, not the popover): **All** · **Plan** (hide done tasks, achieved/frozen/archived goals, and anything else whose *effective* Archival is **Archived** — a Task or Goal a forced Resolution archived, regardless of its own stored status) · **Start** (Plan, minus in-progress tasks with no todo child, minus Timing-**Lapsed** items — a strict superset of Plan's Archival exclusion, since it also drops unresolved **Overdue** items that Plan still shows — minus Habit flow nodes; a **blocked** task/goal is dropped together with its whole subtree — it gates what's beneath it, so nothing under it is startable either) · **Do** (only in-progress tasks) · **Backlog** (the inverse of the others: only Tasks deliberately set aside, together with their whole subtrees — see *Tasks* above; available in both views, unlike Unblock). **Commitments answer to their own branch of these rules**, because the kind resolves the other way round: **All** shows every Commitment including past verdicts; **Plan**, **Start** and **Do** show the **unresolved** ones — what you have yet to judge is what is still live; and **Plan additionally shows `broken` Commitments whose window is still open**, because a commitment you have already broken today stays a live problem until the window closes, where a kept one is settled. That carve-out mirrors no Task rule. **Backlog** shows none, since a Commitment has no Backlog state to be in. (An open edge, deliberately left: a Commitment marked Kept mid-window drops out of Plan while a Broken one stays, so correcting a premature Kept means finding it under All.) In every filtered mode, structural containers (Aspect/Domain/Project/Tag) appear **only as ancestors of a content match** — an empty or fully-resolved container drops out — **except** in Plan, where an **active** (non-resolved) Aspect/Domain/Project shows on its own so you can plan/create items in an empty one (resolved ones, and Tags, stay ancestor-only). Only a Project can be *given* a status, so a status-less container **inherits the nearest status-bearing ancestor's** status rather than reading as active: the Domains inside an Achieved or Archived Project are resolved along with it and stay ancestor-only, while those inside an Active one still show on their own. A container with no status-bearing ancestor at all reads as **Active**. A **Frozen** or **Archived** Project goes further in Plan/Start: it is dropped **together with its whole subtree** (like a blocked Task/Goal under Start), so unresolved work inside it doesn't hold it on screen — its status says the work is off the table, so nothing under it is plannable or startable either. **Achieved** is deliberately softer and keeps the ordinary ancestor-keeping: finished work can still contain unfinished items worth surfacing. The Archived pill's **Include** still overrides this for the Archived case. **All** shows everything, containers included.
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

A compact-card task list, reached via a Mindmap/List tab in the top bar or the `Alt+L` shortcut (both toggle between the two views; the choice belongs to the tab and persists with it). Reuses the Mindmap's own loaded tree (flattened to Tasks) rather than fetching independently, so the two views never drift out of sync — a materialized Start-flow task or a virtual Habit instance shows consistently in both.

**Rows are Tasks only** — real, flow-materialized, and virtual Habit instances alike. Goals, Projects, Domains, and every other kind are never list rows — they appear in a row's **path header** instead (see below). **Commitments are the one exception:** they render in their own section *above* the task rows rather than scattered through them (see *Commitments section* below). A row shows: a status control (click cycles To Do → In Progress → Done, or advances a Habit instance; disabled while the task is blocked, except for Habit instances which always advance), the title (click opens the Task editor; double-clicking anywhere else on the card opens it too, matching the Mindmap's double-click-to-edit gesture), the same status-icon badge row as the Mindmap node (scope/plan/flow/tag badges with tooltips), and the task's **parent label** and **tag pills** — clicking either inline adds it as a filter, per the general Filtering Logic. Each card spans the full row width, with generous padding for a sparse, readable list, and is tinted with its resolved aspect colour — the same fill/opacity derivation the Mindmap node uses — so a task's card matches its node's colour there. Clicking anywhere on a card **selects** it (a highlighted border), for the keyboard bindings below.

**Commitments section.** A band across the top of the list, above the task rows, headed **Commitments** and separated by a rule; it takes no space at all when nothing matches. Today's commitments read as a standing band rather than as work scattered through the list. Each card shows **two verdict controls** — a tick and a cross, side by side — then the title, the same status-icon badge row as a task card, and the parent label and tag pills. Two explicit controls rather than one cycling one, so the two outcomes are visibly **equal** and **Broken is never one stray press past Kept**; pressing the control that is already lit clears the verdict back to Unresolved, which is how a misclick is taken back, and neither control ever moves straight from one verdict to the other. An unjudged commitment carries a marked left edge. The preset governs this section by the Commitment rules above, and the task rows beneath it as before.


**Keyboard interactions** (mirroring the Mindmap's bindings where they translate to a flat list):
- `Alt+F` — toggle the filter menu; `Alt+A` / `Alt+P` / `Alt+S` / `Alt+D` / `Alt+B` — jump to the **All / Plan / Start / Do / Backlog** status preset (matched by physical key), same as the Mindmap
- `B` — put the selected Task in the Backlog, or take it out (acts on the selected row only)
- `↑` / `↓` — move the selection between rows (path headers are skipped); the commitments section is walked first and the task rows after, in the order the two are drawn; from nothing selected, `↓` selects the first row and `↑` the last. **The view follows the selection**: each row the selection lands on is scrolled into view with `nearest` alignment, so a row past the fold comes just far enough in to be read and a row already on screen does not jump
- `J` / `K` — scroll the list down / up **without moving the selection**, which stays where it is even once it has scrolled out of sight. A tap nudges the view by a fixed 24px — about one line of text and its leading, the unit a reader tracks, so the eye follows it without having to re-find its place — and **holding the key scrolls on continuously at 300px/s**, roughly four to five compact rows a second. The hold is driven by an animation frame loop rather than by key auto-repeat, so the pace is the app's rather than the machine's: the OS repeat rate is a per-user setting the app cannot see, and a fixed step per repeat came out several times too fast on a normal one. The loop starts after a short hold delay (so a tap stays a tap) and stops on the key's release, on the window losing focus, or on leaving the view. A fixed amount rather than a measured row height (the user's call): tapping moves by one predictable unit instead of lurching by whatever row is under the fold. Reading ahead and moving the selection are separate gestures; where they meet, the selection wins — scrolling away with `J` and then pressing `↓` re-anchors the view on the selection, because the selection moved and the view follows it. The corollary: `↓` on the last row moves nothing and so re-anchors nothing. **List View only** — the Mindmap already pans with the arrow keys when nothing is selected, and a canvas pans in two dimensions, so `J`/`K` there would be a narrower version of what is already available
- `Enter` — on a Task, cycle its status (disabled while it's blocked, except a Habit instance); on a **Commitment**, mark it **Kept**, or clear the verdict if it already reads Kept. A selection is one or the other, so the two never collide
- `X` — on a **Commitment**, mark it **Broken**, or clear the verdict if it already reads Broken. A separate key rather than a second press of Enter, for the same reason the controls are separate
- `E` — open the selected row's editor (Task or Commitment)
- `R` — rename the selected Task inline (Enter/blur commits, Escape cancels)
- `Ctrl+O` — search for a node by title, over **every** node kind (not just the Tasks the list shows), and **enter** the one you pick: the list re-roots at it and shows only the Tasks beneath it, with that root trimmed from the path headers and named in the top bar instead. This is subtree entry, not a filter — the filter chips, the status preset and the selection are all untouched, and the subtree composes with whatever filtering is already active
- `Shift+Escape` — up one subtree level; `Ctrl+Escape` — straight back to the true root. Same semantics as the Mindmap's, and gated the same way (they do nothing at the true root, where bare `Escape` still deselects)
- `Escape` — deselect
- `Ctrl+Z` — undo the last thing you did to the board; `Ctrl+Shift+Z` (or `Ctrl+Y`) — redo it
- `Alt+L` — switch back to the Mindmap; `Ctrl+Shift+/` — open the keyboard cheat-sheet

A shortcut requires exactly the modifiers listed — `Ctrl+E` does not open the editor, only a bare `E` does.

**Path headers** name where a run of rows lives. Contiguous rows sharing a location are grouped under one header spelling out their full chain — `Growth › CODE › ARLESH › Features` — rendered once above the run rather than repeated on every card; grouping falls out naturally from walking the tree in the same position-sorted order the Mindmap uses, so rows sharing a path already arrive contiguous and no separate sort/group pass is needed. A header names every ancestor **not** rendered as a row above the task: always through to the Goal (Goals, Projects, Domains and Aspects are never rows), plus any ancestor Task the active filter hides — so a subtask on screen without its parent still reads in context, at the cost of splitting a run per hidden parent. A run with no named ancestors gets no header rather than a blank one. A header **opens with a single glyph** for its nearest ancestor — the node the rows below hang directly from — drawn with the same `NodeIcon` the Mindmap nodes and the task rows use, so one kind vocabulary covers all three; one glyph, not one per segment, since the chain is read for where it ends and a marker beside every step would compete with the titles it exists to qualify. An Aspect carries no glyph anywhere in the app, so a header ending at one opens with nothing rather than reserving an empty box. The glyphs are a display preference — the **Path icons** switch in the settings popover, on by default and persisted, offered only while the List View is active since nothing else in the app has a path header. The header is visually lighter than a task card and stays on one line, and each segment is clickable: it **enters** that node as the subtree — the same shared re-rooting `Ctrl+O` performs, so the list shows only what is beneath it, the segment is trimmed from the headers and named in the top bar instead, and `Shift+Escape`/`Ctrl+Escape` are the ways back out. It is subtree entry, not a filter: nothing about the chips or the status preset changes. There is no Goal-visibility toggle — the path always runs through to the Goal — and with the status preset already moved to the shared top bar, the List View has no toolbar of its own.

**Indentation** is the other half of the same rule. A row steps in once for every ancestor Task that *is* rendered as a row above it, so a task and its subtasks read as one piece of work rather than as unrelated items of the same size. Header and indentation partition a row's ancestors exactly — the header names every ancestor not on screen, the indentation counts every ancestor that is — so neither ever repeats the other and the list never leaves whitespace standing for a parent that is not there: under a filter that hides the parent (Do, typically) the subtask sits flush and its parent is named in the header instead. Depth is therefore *visible* depth, not tree depth, and is derived at render from the ancestors each row already carries — no ghost rows for hidden parents, which would mean the filter no longer removes what it says it removes. The step applies to the whole card, so the status control, badges and aspect tint move together as one object; it follows the row title's own direction, so a Hebrew task indents from the right even in a left-to-right list; it is capped, so a deep chain cannot push titles off the edge; and it costs nothing at depth 0, so a list with nothing nested is exactly as wide as before.

**Filtering** shares the Mindmap's status preset, tag filters, and Info/Flow/Private toggles (same top-bar dropdown, same `FilterPopover`, same persisted state) — a filter set in one view is already applied when you switch to the other. The **focus exemption** applies here too (Filtering Logic, above): the selected row stays in the list, dimmed and in its own place, when your own edit stops it matching — it needs no ancestor chain, since a row's hidden ancestors are already named in its path header. The shared status-preset dropdown gains one further option while List View is active: **Unblock** — shows every blocked task, List-View-only, and does *not* change the shared status preset (switching back to the Mindmap shows whatever preset was last active there).

The commitments section consults only the dimensions a Commitment actually has — Parent, Antecedent, Scope and Verdict. A Task-status or Blocked pill is not *failed* by a commitment, it simply does not apply to one, so asking to see in-progress tasks does not empty the band. **Unblock** and **Backlog** leave the section empty, since neither state is one a Commitment can be in.

On top of the shared filters, the List View adds its own filter dimensions — all in the same Any/All/Exclusion pill pattern as tags (a searchable combobox for entity-valued dimensions, fixed-option buttons for enum-valued ones), grouped into two extra clusters ("Hierarchy" and "Status & Scope") in the same `FilterPopover` while List View is active. Picking a candidate adds it and it appears as a chip in the top bar's active-filter row, exactly like a tag:

| Dimension | Values |
|---|---|
| Parent | The task's immediate parent (Project/Goal/Domain/Task/Aspect) |
| Dependency | A specific Task/Goal this task depends on |
| Task status | To Do / In Progress / Done |
| Goal status | The resolved nearest-ancestor Goal's status |
| Project status | The resolved nearest-ancestor Project's status |
| Verdict | Unresolved / Kept / Broken — applies to the commitments section only |
| Scope | Unscoped / Active / Overdue / Lapsed / Planned / Unplanned — independent axes, so e.g. Unscoped + Planned can both apply to the same task |
| Blocked | Blocked / Not blocked |
| Agentic | Agentic / Not agentic — the flag as the task *reads* it, its own or inherited (see *Tasks* above). Independent of the delegated/undelegated question |

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
| `arlesh_snapshot` | `load(now, sections?, cursor?)` — the whole planning graph: domains, goals, tasks, **commitments**, notes, flows, flow items, cycles, dependencies, block reasons, materialised instance nodes, every item's derived lifecycle, and each flow's habit iterations and statuses. Paged; see below |
| `arlesh_scopes` | `get(id)`, `resolve(id)`, `resolve_many(ids)` |
| `arlesh_kb` | `list_people`, `get_person(id)`, `list_events`, `list_threads` |
| `arlesh_tasks` | `get(id)`, `containment_conflicts(node, time_scope)` |
| `arlesh_flows` | `get(id)`, `recurrence(flow_id)`, `completion_count(flow_id)`, `origins(nodes)` |
| `arlesh_beads` | `set(node_type, node_id, beads_id)` — the one write; `node_type` is `task`, `goal`, `commitment` or `project`. See below |

`arlesh_snapshot.load` is the entry point and covers the common case. The other reads
exist for what it does not carry: the knowledge base, scope resolution, a task's dependency-derived
block reasons, and a Habit's stored recurrence configuration as opposed to its derived iterations.

A Commitment arrives with its `verdict` (`unresolved` / `kept` / `broken`) and its derived
lifecycle. The verdict is recorded, never inferred, and `unresolved` means the user has not said
rather than "not done" — an agent that reads it as an unfinished task has misread the board.

Tasks, Goals and Commitments carry `time_scope` and `plan` as boundary **scope ids**, not dates, so reading a
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

A Task, Goal, Commitment or Project can carry the id of the `bd` issue tracking it, and `arlesh_beads.set` is
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

## Undo

Ctrl+Z reverses a **Gesture** — one thing the user did — and Ctrl+Shift+Z reapplies it. There is
**one stack for the whole app**, not one per view or window: there is one board and one history of
changes to it, and a per-view stack could undo past another view's newer edit. Both stacks are
**session-scoped** and empty on launch.

### The journal

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

### Gestures

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

### What the user sees

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

### Sources, and not undoing undo

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

The journal is truncated at startup and capped at a fixed number of gestures, so a long session
cannot grow it without bound. An ungrouped entry counts as one gesture for that cap.

### The two stacks

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

## Implementation Phases

1. **Data layer** — schema, migrations, Tauri commands, integration tests. No UI.
2. **Mindmap view** — SVG-based balanced tree editor (horizontal or vertical) with full keyboard interaction.
3. **List view** — filterable task list sharing the Mindmap's filters plus its own preset (All/Plan/Start/Do/Backlog/Unblock) and pill-filter dimensions, with a Commitments section above the task rows. Complete.
4. **KB resources backend** — People, Events, Threads, Scopes as local DB entities. Obsidian integration stubbed behind an adapter interface.
5. **Obsidian integration** — replace stub adapter with real Obsidian local-rest-api client. Note discovery, bidirectional sync.
6. **Time Scopes** — Parts of Day and Exact scopes; datetime-boundary resolution (cached) and `active`; Time Scope (relevance) vs Plan split with interval-containment invariants and write-time enforcement; the Scope Picker component. Schema → commands → picker UI. See ADR 0001.
7. **Flows** — Flow node kind and dedicated creation; Instance Type, Target Node, flow scope; flow items with Cycle Scope/Plan; start modal; materialization as real independent copies with per-instance dependency remapping. See ADR 0002.
8. **Habits** — Recurrence (Repetition + configurable Consumption); virtual instances with overlay table keyed by `(flow item, iteration scope)`; ellipsis display + pinning; archiving and scope-edit reconciliation. See ADR 0002.
