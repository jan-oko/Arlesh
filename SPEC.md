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

**Scopes** — time range entities. Not manually created; lazily instantiated on first reference and stored as rows. Four kinds:

| Kind    | Definition                                      |
|---------|-------------------------------------------------|
| Season  | Three-month period (Autumn: Sep–Nov, Winter: Dec–Feb, Spring: Mar–May, Summer: Jun–Aug) |
| Month   | Calendar month                                  |
| Week    | Sunday–Saturday, custom 1–52 numbering (not ISO 8601) |
| Day     | Single date; corresponds to an Obsidian note at `{yyyy}/{mm MMMM}/{yyyy-mm-dd}.md` |

Scope containment is hierarchical: Day ⊂ Week ⊂ Month ⊂ Season. Each scope row stores denormalized `week_id`, `month_id`, `season_id` for efficient containment-based filtering. Scope filtering is containment-based: filtering by Week 24 returns all items scoped to any period within Week 24 (including individual days).

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

**Planning:** Tasks and Goals can both be planned to a Scope.

A Task's **goal**, **project**, and **aspect** are resolved as the nearest ancestor of each type.

---

## Link Inheritance

All link types inherit downward from parent to child. When filtering, a child item matches a filter if it or any ancestor holds the matching link.

Inheritance behavior per link type:

| Link type              | Behavior when child has explicit value |
|------------------------|----------------------------------------|
| Tags                   | Additive — child has both parent's and its own tags |
| KB links (Person/Event/Thread) | Additive |
| Scope (planned period) | Child must use a narrower scope (e.g. a specific Day within the parent's Week). Narrower scope overrides for exact-match purposes but the parent scope still contains it. |
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
