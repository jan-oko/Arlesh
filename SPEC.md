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

Goals do **not** appear in the List view. Goals can be depended on by Tasks; a Goal-dependency blocks a Task until the Goal is Achieved.

### Tasks

Tasks represent action items. Fields: title, parent (Project / Goal / Domain / Task), tags (list), KB resource links, status, blockers, dependencies, delegation.

**Status:** To Do / In Progress / Done

**Blockers:** A Task can be explicitly blocked with a string reason. A Task is also virtually blocked if it has any dependency on a non-Done Task or non-Achieved Goal, with reason `"Blocked by {id} ({title})"`.

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

An item is **active** when its (own or inherited) Time Scope is active. An item whose Time Scope has fully passed is **archived** — a derived/virtual state computed on read, never a stored-status mutation.

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

A Flow has a title, an **Instance Type** (goal or task — what its root and children materialize as), a **Target Node** (default location for instances), and a Duration-form **flow scope**.

**Flow items** — a Flow's children are flow tasks/goals: ordinary Tasks/Goals plus one or more **(Cycle Scope, Cycle Plan)** pairs. A Cycle Scope is relative — the Nth subscope of the flow scope (null = the whole flow scope); a Cycle Plan is a relative Plan within it. Flow items may declare dependencies on sibling flow items.

**Starting a flow** (`s` on a focused flow node, or context menu) opens a modal: title, target node (free-text search combobox; parent path shown in parentheses for duplicates; defaults to the flow's Target Node), and an anchor for the flow window (default now). On start:

- The window anchors concretely; each (Cycle Scope, Cycle Plan) pair resolves to a real item with a concrete Time Scope + Plan within the window — **a flow item with N pairs produces N items.**
- Intra-template dependencies **remap to the items of this instance** (Implement waits on this instance's Specify).
- The result is a **real, independent copy** under the target. It keeps a stored link to its originating Flow, used only as a "from flow X" UI indicator (no cascading edits).
- Instances must satisfy scope containment against the Target Node; the target picker offers only scope-valid targets, and editing the scope of an item that has flow children prompts reconciliation.

---

## Habits

A **Habit** is a Flow with a **Recurrence** pattern. Its instances are generated automatically and are **virtual**: each is identified by `(flow item, iteration scope)` and rendered from the template, with only divergences (status, edited fields, dependencies, deletion/archival tombstones) persisted in an overlay table. An instance's title reads `{flow title} {start scope}` (e.g. "Exercise W22").

**Recurrence** = **Repetition** + **Consumption**:

- **Repetition** — a Start anchor, an optional **Gap** of N of a scope kind ≥ the habit scope (default: no gap, continuous), and an optional end.
- **Consumption** (per-habit, user-configurable tree):
  1. **Destructive** (unfinished instances archived when their iteration passes; bounded) vs **Accumulating** (they survive).
  2. If Accumulating: **Overlapping** (new iterations generated regardless) vs **Blocking** (withheld while unresolved instances exist).
  3. If Blocking, the **catch-up policy** when the open iteration completes: *all pending* (every missed iteration, in order), *next* (advance by one), or *latest* (jump to current, recording skipped iterations as missed tombstones).

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
- `Escape` — go back one level when inside a subtree
- `Shift+Escape` — go back to root
- Back button / back-to-top button available in the UI

**Entering a subtree:** Right-clicking a cell and selecting "Enter" re-roots the map at that cell. Navigation back: back button, back-to-top button, or Shift+Escape.

**Type cycling rules:**
- New cell defaults to parent's type
- Cycle: Domain → Project → Goal → Task (and back)
- Aspects are fixed roots; they are not part of the cycle
- Type-shifting between Goal and Task maps statuses to the closest equivalent with a user-facing warning:
  - Goal → Task: Active → To Do, Achieved → Done, Frozen → To Do, Archived → To Do
  - Task → Goal: To Do → Active, In Progress → Active, Done → Achieved

### List View

A minimalistic task list. Filtering as described above.

**Task rows** display the task's tags and parent. Clicking a tag or parent inline adds it as a filter.

**Goal visibility** can be toggled. When enabled, Goals appear as rows in the list, positioned immediately before their child tasks (acting as labeled group headers). Goals are hidden by default.

Four preset modes (separate from custom filters):

| Mode    | Shows                                              |
|---------|----------------------------------------------------|
| Plan    | All tasks                                          |
| Start   | To Do and In Progress tasks with no unresolved dependencies |
| Do      | In Progress tasks only                             |
| Unblock | All blocked tasks with their block reasons         |

---

## Implementation Phases

1. **Data layer** — schema, migrations, Tauri commands, integration tests. No UI.
2. **Mindmap view** — SVG-based left-right balanced tree editor with full keyboard interaction.
3. **List view** — filterable task list with the four preset modes.
4. **KB resources backend** — People, Events, Threads, Scopes as local DB entities. Obsidian integration stubbed behind an adapter interface.
5. **Obsidian integration** — replace stub adapter with real Obsidian local-rest-api client. Note discovery, bidirectional sync.
6. **Time Scopes** — Parts of Day and Exact scopes; datetime-boundary resolution (cached) and `active`; Time Scope (relevance) vs Plan split with interval-containment invariants and write-time enforcement; the Scope Picker component. Schema → commands → picker UI. See ADR 0001.
7. **Flows** — Flow node kind and dedicated creation; Instance Type, Target Node, flow scope; flow items with Cycle Scope/Plan; start modal; materialization as real independent copies with per-instance dependency remapping. See ADR 0002.
8. **Habits** — Recurrence (Repetition + configurable Consumption); virtual instances with overlay table keyed by `(flow item, iteration scope)`; ellipsis display + pinning; archiving and scope-edit reconciliation. See ADR 0002.
