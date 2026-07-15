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

**Projects** — large domains (hobby, habit, workplace, etc.). Parent must be an Aspect or another Project. May be linked to a knowledge-base directory. Status: **Active / Achieved / Frozen / Archived**.

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

Goals represent desired states. Fields: title, parent (Project / Goal / Domain), tags (list), KB resource links (People, Events, Threads, Scopes), status, blockers.

**Status:** Active / Achieved / Frozen / Archived

Goals are never List View *rows*, though they can optionally show as group headers there (see List View below). Goals can be depended on by Tasks; a Goal-dependency blocks a Task until the Goal is Achieved.

### Tasks

Tasks represent action items. Fields: title, parent (Project / Goal / Domain / Task), tags (list), KB resource links, status, blockers, dependencies, delegation.

**Status:** To Do / In Progress / Done

**Blockers:** A Task (and a Goal) can carry an **ordered list of explicit block reasons**, edited in its editor (add / remove / reorder rows). A Task is **additionally** blocked *virtually* by any dependency on a non-Done Task or non-Achieved Goal, with reason `"Blocked by {kind} {id} ({title})"`. The two combine: a Task/Goal reads as **blocked** on the canvas (red stop-sign) when it has **any** reason — explicit or virtual. Explicit reasons live in their own `block_reasons` table (polymorphic `owner_type`/`owner_id`, ordered by `position`); virtual reasons are derived at read time from the dependency edges, never stored. Cross-table type conversion copies the explicit reasons to the new node.

**Dependencies:** Tasks can depend on other Tasks or Goals. Circular dependencies are rejected at write time.

**Delegation:** A Task can be delegated to a Person.

**Time Scope & Plan:** A Task carries a **Time Scope** (relevance window) and an optional **Plan** (a single scope it is scheduled into). Goals carry a Time Scope but no Plan. See *Time Scopes & Planning* below.

A Task's **goal**, **project**, and **aspect** are resolved as the nearest ancestor of each type.

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
- **Archival** — the item's *effective* archived/frozen/live state, driving the status row's archive-box badge (below) and the Mindmap's **Archived** filter (Filtering, below). Tasks have no manual archival concept and are always fully derived from Resolution: **Completed** or **Missed** forces **Archived**; **Overdue** stays **Live**. Goals/Projects keep their own manually-set status (Active/Achieved/Frozen/Archived) exactly as today — untouched by this — but a **Completed** or **Missed** Resolution unconditionally forces the *effective* Archival to **Archived** regardless of the stored status, even overriding a manually-set **Frozen**; when it does, the status-row badge flags the resulting **conflict** (a manually-Frozen item that scope forced into Archived).

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

A Flow has a title, an **Instance Type** (goal or task — what its root and children materialize as), a **Target Node** (default location for instances), and a **Flow Window**. The Flow Window is either a **Span** — a coarse Duration of N of `day`/`week`/`month`/`season` (a relative length, snapshotted against the start anchor) — or a sub-day **Phase** — a fixed time-of-day carried date-free on the template: a part-of-day band (e.g. Evening) or an exact `HH:MM–HH:MM` range. Starting supplies only a date; a Phase window is combined with that date via the part/exact scope constructors. A Habit with a Phase window recurs at the fixed time-of-day, stepping whole days by its Gap. A **task-instance** flow may also carry a **root Cycle Plan** — a relative plan window inside the flow window (like a flow item's Cycle Plan) — resolved into the root Task's Plan on start; goal-instance flows have none (Plan is task-only).

**Flow items** — a Flow's children are flow tasks/goals: ordinary Tasks/Goals plus one or more **(Cycle Scope, Cycle Plan)** pairs. A Cycle Scope is relative — the Nth subscope of the flow scope (null = the whole flow scope); a Cycle Plan is a relative Plan within it. Flow items may declare dependencies on **any other item in the same flow**.

A flow item is created under a flow (or another item) like any child — a flow root spawns items of its Instance Type, a flow item spawns items of its own kind — and edited in a dedicated modal: title, default status, block reason, cycle pairs, and dependencies. Like real Goals/Tasks, a flow item can be **retyped between goal and task** with the type cycle (the flow node itself cannot). Converting a flow-goal that has flow-goal children into a flow-task prompts to reparent or delete those children (they can't live under a task); the item's cycle pairs and dependency edges are preserved across the change. Cycle pairs are stored **relatively**: the Cycle Scope as a `(subkind, index)` (the index-th subkind unit within the flow window; null = whole scope) and the Cycle Plan as a `(subkind, start..end)` range within the cycle scope (null = no plan). These indices are resolved to concrete Time Scopes / Plans only when the flow is started. Existing cycle pairs list as rows; adding or editing one opens a **relative drill-down picker** modelled on the Scope Picker's own navigation (browse a level's cells, click to descend, ↑ to ascend) but labelled in relative terms ("Week 2 › Tuesday › Morning") using nominal subdivision counts (season→month 3, month→week 4, week→day 7, day→part 6) — clicking a cell at the chosen Cycle Scope Kind toggles that occurrence on or off immediately, with no separate confirm step. Part of Day cells are labelled with their real band names (Morning, Noon, …) rather than a nominal index, since that kind's meaning is fixed regardless of anchor. An Unscoped flow's items have no cycles. A **Phase**-windowed flow's items may carry finer **exact-time** cycles (a fixed `HH:MM–HH:MM` sub-range of the band/window) — permitted by design, but since these are absolute times-of-day rather than ordinal offsets they need a time-of-day cycle form and a datetime sub-interval containment check; that backend is deferred until a cycle editor supports exact times.

**Starting a flow** (`s` on a focused flow node, or context menu) opens a modal: title, target node (free-text search combobox; parent path shown in parentheses for duplicates; defaults to the flow's Target Node), and an **anchor** for the flow window. The anchor is a scope of the **flow-scope kind** (a week-flow anchors on a week, a season-flow on a season; a Duration expressed in days anchors on any day for agility), defaulting to the current such scope. On start:

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

**Display.** Instances render under the Target Node. Active and past instances render directly; an **ellipsis node** stands in for future instances (which can be unbounded under overlapping/open-ended recurrence). Double-click/double-enter the ellipsis to open a search combobox of virtual instances; selected ones are **display-pinned** (still virtual) and render on their own.

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

A canvas-based mind map editor. Layout: **left-right balanced tree** — children alternate left and right of their parent node. Implemented with a custom SVG renderer using D3's tree layout algorithm.

The root of the map is "Arlesh" (top level). Aspect cells are its direct children.

**Keyboard interactions:**
- `Tab` / click — create a child cell
- Arrow keys — move between cells
- `Ctrl+Up` / `Ctrl+Down` — cycle the cell's type through: Domain → Project → Goal → Task
- `Double-click` — open editor modal to link the cell to KB resources
- `Right-click` — context menu (enter subtree, change type, delete, etc.)
- `Enter` — with a node selected: cycle a task's status / toggle a goal's achieved (double-tap enters a container as a subtree); **with nothing selected: focus the current display root**
- `Alt+F` — toggle the filter menu; `Alt+A` / `Alt+P` / `Alt+S` / `Alt+D` — jump to the **All / Plan / Start / Do** status preset (matched by physical key)
- `Escape` — go back one level when inside a subtree
- `Shift+Escape` — go back to root
- Back button / back-to-top button available in the UI

**Entering a subtree:** Right-clicking a cell and selecting "Enter" re-roots the map at that cell. Navigation back: back button, back-to-top button, or Shift+Escape.

**Status-icon row:** below each node sits a compact row of status badges (aligned to the UI's leading edge — left in English, right in Hebrew), each with a hover tooltip. A **clock** marks a Time Scope (tooltip = the window; crossed out once the window has passed); a red **exclamation** flags an **Overdue** item and an **archive box** any item whose *effective* Archival is **Archived** — an explicitly-Archived Goal/Project, or any scoped Task/Goal whose Resolution is **Completed** or **Missed** — tinted as a warning when it's a **conflict** (a manually-Frozen item that scope forced into Archived); a **calendar** marks a Plan (tooltip = the plan window); a **snowflake** a Frozen goal/project; an **ellipsis** an Info node carrying a Details description (tooltip = the text); a **wave** a real Start-flow instance and the **cyclical habit glyph** a virtual Habit iteration; and a **tag** icon a node with tags (tooltip = their names). Badges appear only when relevant, so most nodes show few or none. The set of badges is a pure function of the node; scope/plan/tag tooltips resolve their labels on demand.

**Top bar:** a settings **gear** (popover with the Hebrew/English language toggle and a **Light mode** switch — persisted, defaults to dark, applies app-wide via a `data-theme` attribute and matching `tokens.css` overrides) at the start edge; a **Mindmap/List** view tab pair (also toggled by `Alt+L`); a **status-preset dropdown** (All/Plan/Start/Do, plus a 5th **Unblock** option while List View is active — see List View below) — a dropdown rather than a segmented control so it stays compact next to the tabs, built as a themed `Select` (listbox popover styled from the app's own tokens, with arrow-key/Enter/Escape keyboard support) rather than a native `<select>`, whose open option list ignores CSS and renders with plain OS chrome; the subtree **back-nav pills** (shown only inside a subtree); and, at the end edge, a **Filter** button (funnel) that opens the filter popover. Below the bar, a wrapping row of **active-filter chips** renders whenever any filter is engaged (empty and takes no space otherwise) — every active tag filter and, while List View is active, every active List-View-exclusive pill filter (see below). A chip shows a mode symbol (∪/∩/∅) and the filter's name; clicking the chip body cycles Any → All → Exclude, and an embedded **×** removes it. A chip's border/symbol color is a muted accent for its mode — a fixed, low-key hue per mode shared across every dimension, blended most of the way toward the neutral border rather than shown at full strength; its background additionally tints toward the value's resolved aspect color where one exists (tags, Parent, Antecedent, Dependency).

**Mindmap filter:** prunes the displayed tree — a node is hidden unless it matches or has a matching **content** descendant (ancestors of matches stay, keeping the map connected). Info notes are *attachments*: they ride along with a kept node but never keep one (an achieved goal whose only children are notes is still hidden). The **status preset** lives in the top bar (see above); the popover opened from the **Filter** button is a pure **"add a filter"** chooser — active filters never render inside it, only candidates not yet selected (picking one adds it and it disappears from the list, mirroring the top-bar chip it now appears as). Sections group into a few always-expanded clusters rather than one long list or a collapsed "Advanced" toggle:
- **Status preset** (single, in the top bar, not the popover): **All** · **Plan** (hide done tasks, achieved/frozen/archived goals, and anything else whose *effective* Archival is **Archived** — a Task or Goal a forced Resolution archived, regardless of its own stored status) · **Start** (Plan, minus in-progress tasks with no todo child, minus Timing-**Lapsed** items — a strict superset of Plan's Archival exclusion, since it also drops unresolved **Overdue** items that Plan still shows — minus Habit flow nodes; a **blocked** task/goal is dropped together with its whole subtree — it gates what's beneath it, so nothing under it is startable either) · **Do** (only in-progress tasks). In every filtered mode, structural containers (Aspect/Domain/Project/Tag) appear **only as ancestors of a content match** — an empty or fully-resolved container drops out — **except** in Plan, where an **active** (non-resolved) Aspect/Domain/Project shows on its own so you can plan/create items in an empty one (resolved ones, and Tags, stay ancestor-only). **All** shows everything, containers included.
- **"Tags & Type" cluster** — a tag search combobox (candidates only; picking one adds a Tag filter chip, Any/All/Exclusion modes per the Filtering Logic formula, AND-ed with the preset); an **Include flows** subtoggle (shown only in Plan/Start), separate from the global Flow type toggle — both must be on for flows to show; **Node-type visibility** (Mindmap only — Info/Flow toggles hide those subtrees, meaningless in List View since its rows are Tasks only, so this section is hidden there); and the **Work** toggle (both views): when on, hard-hides every node marked **NSFW** together with its whole subtree (dropped outright, not kept as an ancestor). Every node kind carries an `nsfw` flag, set from its editor modal. Marking a **flow item** NSFW is a real stored field that also propagates to that item's instances — the virtual Habit instances inherit it, and starting a flow copies it onto the materialized Goal/Task (the flow root's flag propagates to the root instance likewise).
- **"Advanced" disclosure (Mindmap only)** — collapsed by default (auto-opens when the Archived pill is already engaged), mirroring the editor modals' own collapsible Advanced section. Holds an **Archived** pill that cycles **Inactive → Include → Exclude → Inactive** on click, overriding the status preset's own handling of anything whose *effective* Archival is **Archived** (an explicitly-Archived Goal/Project, or any scoped Task/Goal whose Resolution is **Completed** or **Missed** — the states that render the status row's archive-box badge) independently of achieved/frozen, which stay governed by the preset alone. **Inactive** (default) defers to whatever the active preset already does (Plan/Start hide Archival-Archived items; All shows them). **Include** force-shows archived items even under Plan/Start. **Exclude** force-hides them even under All, hard-hiding the whole subtree so an archived item isn't kept visible merely as the ancestor of an unrelated, ordinarily-visible sibling. Has no effect under **Do** (which already shows only in-progress tasks, never goals/containers, regardless of archived state).

**Type cycling rules:**
- New cell defaults to parent's type
- Cycle: Domain → Project → Goal → Task (and back)
- Aspects are fixed roots; they are not part of the cycle
- Type-shifting between Goal and Task maps statuses to the closest equivalent with a user-facing warning:
  - Goal → Task: Active → To Do, Achieved → Done, Frozen → To Do, Archived → To Do
  - Task → Goal: To Do → Active, In Progress → Active, Done → Achieved

### List View

A compact-card task list, reached via a Mindmap/List tab in the top bar or the `Alt+L` shortcut (both toggle between the two views; view choice persists). Reuses the Mindmap's own loaded tree (flattened to Tasks) rather than fetching independently, so the two views never drift out of sync — a materialized Start-flow task or a virtual Habit instance shows consistently in both.

**Rows are Tasks only** — real, flow-materialized, and virtual Habit instances alike. Goals, Projects, Domains, and every other kind are never list rows (Goals can optionally appear as group headers; see below). A row shows: a status control (click cycles To Do → In Progress → Done, or advances a Habit instance; disabled while the task is blocked, except for Habit instances which always advance), the title (click opens the Task editor; double-clicking anywhere else on the card opens it too, matching the Mindmap's double-click-to-edit gesture), the same status-icon badge row as the Mindmap node (scope/plan/flow/tag badges with tooltips), and the task's **parent label** and **tag pills** — clicking either inline adds it as a filter, per the general Filtering Logic. Each card spans the full row width, with generous padding for a sparse, readable list, and is tinted with its resolved aspect colour — the same fill/opacity derivation the Mindmap node uses — so a task's card matches its node's colour there. Clicking anywhere on a card **selects** it (a highlighted border), for the keyboard bindings below.

**Keyboard interactions** (mirroring the Mindmap's bindings where they translate to a flat list):
- `Alt+F` — toggle the filter menu; `Alt+A` / `Alt+P` / `Alt+S` / `Alt+D` — jump to the **All / Plan / Start / Do** status preset (matched by physical key), same as the Mindmap
- `↑` / `↓` — move the selection between rows (Goal headers are skipped); from nothing selected, `↓` selects the first row and `↑` the last
- `Enter` — cycle the selected row's status (disabled while it's blocked, except a Habit instance)
- `E` — open the selected row's editor
- `R` — rename the selected row inline (Enter/blur commits, Escape cancels)
- `Escape` — deselect

**Goal visibility** can be toggled (off by default, in the List View's own toolbar — its only remaining control since the status preset moved to the shared top bar). When enabled, each Goal appears as a group-header row immediately before its child tasks — grouping falls out naturally from walking the tree in the same position-sorted order the Mindmap uses, so no separate sort/group pass is needed; tasks with no resolved Goal ancestor group under their nearest Project instead.

**Filtering** shares the Mindmap's status preset, tag filters, and Info/Flow/Work toggles (same top-bar dropdown, same `FilterPopover`, same persisted state) — a filter set in one view is already applied when you switch to the other. The shared status-preset dropdown gains a 5th option while List View is active: **Unblock** — shows every blocked task, List-View-only, and does *not* change the shared status preset (switching back to the Mindmap shows whatever preset was last active there).

On top of the shared filters, the List View adds its own filter dimensions — all in the same Any/All/Exclusion pill pattern as tags (a searchable combobox for entity-valued dimensions, fixed-option buttons for enum-valued ones), grouped into two extra clusters ("Hierarchy" and "Status & Scope") in the same `FilterPopover` while List View is active. Picking a candidate adds it and it appears as a chip in the top bar's active-filter row, exactly like a tag:

| Dimension | Values |
|---|---|
| Parent | The task's immediate parent (Project/Goal/Domain/Task/Aspect) |
| Antecedent | Any ancestor in the chain (parent, grandparent, … up to the Aspect) |
| Dependency | A specific Task/Goal this task depends on |
| Task status | To Do / In Progress / Done |
| Goal status | The resolved nearest-ancestor Goal's status |
| Project status | The resolved nearest-ancestor Project's status |
| Scope | Unscoped / Active / Overdue / Lapsed / Planned / Unplanned — independent axes, so e.g. Unscoped + Planned can both apply to the same task |
| Blocked | Blocked / Not blocked |

---

## Implementation Phases

1. **Data layer** — schema, migrations, Tauri commands, integration tests. No UI.
2. **Mindmap view** — SVG-based left-right balanced tree editor with full keyboard interaction.
3. **List view** — filterable task list sharing the Mindmap's filters plus its own preset (All/Plan/Start/Do/Unblock) and pill-filter dimensions. Complete.
4. **KB resources backend** — People, Events, Threads, Scopes as local DB entities. Obsidian integration stubbed behind an adapter interface.
5. **Obsidian integration** — replace stub adapter with real Obsidian local-rest-api client. Note discovery, bidirectional sync.
6. **Time Scopes** — Parts of Day and Exact scopes; datetime-boundary resolution (cached) and `active`; Time Scope (relevance) vs Plan split with interval-containment invariants and write-time enforcement; the Scope Picker component. Schema → commands → picker UI. See ADR 0001.
7. **Flows** — Flow node kind and dedicated creation; Instance Type, Target Node, flow scope; flow items with Cycle Scope/Plan; start modal; materialization as real independent copies with per-instance dependency remapping. See ADR 0002.
8. **Habits** — Recurrence (Repetition + configurable Consumption); virtual instances with overlay table keyed by `(flow item, iteration scope)`; ellipsis display + pinning; archiving and scope-edit reconciliation. See ADR 0002.
