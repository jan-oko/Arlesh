# Arlesh — Design Specification

## Overview

Arlesh is a knowledge-base and task management desktop app integrating with Obsidian via the local-rest-api plugin. It is data-management-first: it manages resources and their linkages, with some resources corresponding to Obsidian notes.

**Primary focus:** task management as a first-class feature. Knowledge-base entity management supports filtering and sorting of tasks. Future directions include structured KB entity management and graph visualizations.

**Platform:** Cross-platform desktop-first native app (Tauri 2.0 + React + TypeScript). Mobile is a future nice-to-have; Tauri 2.0 supports iOS/Android via the same web frontend.

**Storage:** SQLite.

---

## The specification

The spec is one document in several files, one per area, under `docs/spec/`. Areas were cut where
features arrive: a change to the List View touches `list-view.md` and a change to Habits touches
`habits.md`, so two features in flight no longer meet in one file the way they used to. This page
is the front door — start here, then take one hop.

### Resources and the rules they live by

| Area | What is in it |
| --- | --- |
| [Resources](docs/spec/resources.md) | Domains, Projects, Aspects, Tags; the Knowledge Base; Goals; Tasks; Commitments; beads ids |
| [Time Scopes & Planning](docs/spec/time-scopes.md) | Time Scope (relevance) against Plan (scheduling), on-exit behaviour, containment invariants, the Scope Picker |
| [Flows](docs/spec/flows.md) | The Flow node kind, flow items, Cycle Scope/Plan, starting one, materialisation |
| [Habits](docs/spec/habits.md) | Recurrence, virtual instances, iteration scopes, archiving |
| [Link Inheritance](docs/spec/link-inheritance.md) | How a node inherits its ancestors' links |
| [Filtering Logic](docs/spec/filtering-logic.md) | Pill dimensions, the three modes, the focus exemption |

### Views

The surfaces the board is read and edited through. They share one tree and one filter model,
so a change to what a node *is* belongs above, and a change to how it is *shown* belongs here.

| Area | What is in it |
| --- | --- |
| [Tabs](docs/spec/tabs.md) | The tab strip, what a tab owns, persistence |
| [Mindmap (Tree View)](docs/spec/mindmap-view.md) | The canvas, nodes and badges, the top bar, keyboard interactions, retyping |
| [List View](docs/spec/list-view.md) | Rows and cards, the Commitments band, path headers, keyboard interactions, its own pill dimensions |
| [Plan View](docs/spec/plan-view.md) | Scope-by-scope triage: the two panes, the Backlog switch, the containment refusal, walking the scopes |
| [Steps View](docs/spec/steps-view.md) | One Step at a time: the header card, what a card carries, descending and climbing, pages and zoom |

### Everything else

| Area | What is in it |
| --- | --- |
| [Windows & Tray](docs/spec/window-tray.md) | Tearing a tab into its own window, the board-changed broadcast, session restore; the tray icon, what the close button does, quitting, the monochrome tray mark |
| [MCP Server](docs/spec/mcp-server.md) | The read-only endpoint an agent reaches the board through: tools, paging, errors |
| [Undo](docs/spec/undo.md) | The journal, which gestures are one step, the two stacks, what is deliberately not undoable |

Decisions with a rationale worth keeping live in [`docs/adr/`](docs/adr/) and are referenced from
the area they belong to.

---

## Implementation Phases

1. **Data layer** — schema, migrations, Tauri commands, integration tests. No UI. Complete.
2. **Mindmap view** — SVG-based balanced tree editor (horizontal or vertical) with full keyboard interaction. Complete.
3. **List view** — filterable task list sharing the Mindmap's filters plus its own preset (All/Plan/Start/Do/Backlog/Unblock) and pill-filter dimensions, with a Commitments section above the task rows. Complete.
4. **KB resources backend** — People, Events, Threads, Scopes as local DB entities. Obsidian integration stubbed behind an adapter interface. Partly built: the four are tables, with commands to create and list People, Events and Threads (and to get, update and delete a Person); there is no adapter interface, no UI for People, Events or Threads, and no command that links a Task or Goal to one (the `*_knowledge_base_links` tables exist, unwritten).
5. **Obsidian integration** — replace stub adapter with real Obsidian local-rest-api client. Note discovery, bidirectional sync. Not started.
6. **Time Scopes** — Parts of Day and Exact scopes; datetime-boundary resolution (cached) and `active`; Time Scope (relevance) vs Plan split with interval-containment invariants and write-time enforcement; the Scope Picker component. Schema → commands → picker UI. See ADR 0001. Complete.
7. **Flows** — Flow node kind and dedicated creation; Instance Type, Target Node, flow scope; flow items with Cycle Scope/Plan; start modal; materialization as real independent copies with per-instance dependency remapping. See ADR 0002. Complete, except exact-time cycles on a Phase-windowed flow (deferred; see [Flows](docs/spec/flows.md)).
8. **Habits** — Recurrence (Repetition + configurable Consumption); virtual instances with overlay table keyed by `(instance, iteration scope, cycle pair)` (which today stores a status and when it was resolved); scope-edit reconciliation, whose *Archive & new* archives the original Habit. See ADR 0002. Complete. (An ellipsis node for future instances, display pinning and archiving a Habit on its own are `Arlesh-9md`.)
