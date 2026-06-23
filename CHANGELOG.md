# Changelog

All notable changes to Arlesh are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- Drag-and-drop to re-parent nodes: drag any non-aspect node onto a valid parent and release to move it; valid drop targets highlight in the accent colour; invalid targets (e.g. dropping a goal onto a task, or a node onto one of its own descendants) are silently rejected

### Fixed
- Alt+Up / Alt+Down no longer causes a white flash and pan/zoom reset: mutations now refresh the tree silently without triggering the loading spinner, so the canvas stays mounted
- Changing node type (Ctrl+Arrow) no longer moves the node to the bottom of its siblings: the new entity now inherits the old entity's position value instead of receiving a fresh epoch-ms timestamp
- Warning confirmation modal now receives keyboard focus when opened (cancel button auto-focused); Escape dismisses it and all other mindmap shortcuts are blocked while it is visible
- goal↔task type conversion no longer shows a warning for task children: task nodes are valid under both goals and tasks, so only goal children (which cannot live under a task) and a present block reason trigger the confirmation modal

### Added
- Mindmap view: SVG mind map editor with a left-right balanced tree layout
  - All Domains, Projects, Goals, and Tasks displayed as a unified tree rooted at the six Aspects
  - Pan (middle-click drag) and zoom (scroll/pinch) with spring animation
  - Visual spatial arrow-key navigation (nearest node in screen direction)
  - Tab to create a child node with inline title entry; Enter to confirm, Esc to cancel
  - Context menu on right-click: enter subtree, rename, cycle type, cut/copy/paste, collapse/expand, delete
  - Ctrl+X/C/V keyboard shortcuts for cut/copy/paste as child
  - Double-click opens an editor modal for title and tag assignment
  - Drag-and-drop to re-parent nodes
  - Ctrl+Up / Ctrl+Down cycles node type; cycle is context-aware: under a domain/project/aspect parent the full set (domain → project → tag → goal → task) is available; under a goal only goal↔task; task under task cannot become a goal
  - Cross-table type conversion (e.g. domain→goal, goal→domain): creates the new entity, re-parents compatible children, and deletes the old record
  - Alt+Up / Alt+Down moves a node up or down among its siblings (swaps position values)
  - Nodes now retain insertion order instead of being sorted alphabetically (`position` column added to domains, goals, and tasks; ORDER BY position)
  - Tag nodes now visible in the tree as leaf nodes (previously hidden); type cycling and Tab creation respect leaf-node constraint
  - Aspect color inherited by all descendant nodes with depth-faded opacity (vivid at depth 1, 15 % floor at depth 4+)
  - F2 to activate inline editing on the selected node
  - Enter subtree mode via context menu; subtree navigation pill in top-left; Esc to go up, Shift+Esc to return to root
  - Ctrl+/ to collapse/expand a subtree; Delete key to delete a node
  - Depth-based node scaling (root largest, stabilises at depth 4)
- Per-type editor modals (Task, Goal, Domain, Project, Tag) — each with entity-specific fields
  - Task modal: title, status pills (todo / in progress / done), block reason textarea, tag checkboxes, dependency search/add/remove
  - Goal modal: title, status pills (active / achieved / frozen / archived), block reason textarea, tag checkboxes
  - Domain and Tag modals: title only
  - Project modal: title, status pills, knowledge base directory path
  - Error messages surface inside the modal instead of being silently swallowed
- SVG node icons replacing emoji: diamond (domain), flag (project), bullseye (goal), price-tag (tag), status-based circles (task: empty/filled/checkmark for todo/in_progress/done, red octagon for blocked)
- Clicking the icon area of a task node cycles its status (todo → in_progress → done → todo); blocked tasks show a stop sign that is not clickable
- App icon generated from the Arlesh logo SVG (32 × 32, 128 × 128, 128 × 128@2x, .icns, .ico)
- `list_task_dependencies` Tauri command (was missing despite the repository method existing)
- ESLint configured (flat config v9+) with typescript-eslint, react-hooks, and react-refresh plugins
- Phase 1 data layer: SQLite schema, sqlx migrations, domain-first Rust module structure
- `domains` module: CRUD for Aspects (seeded, immutable), Projects, Domains, Tags with parent/subtype validation
- `tasks` module: CRUD for Tasks and Goals, dependency tracking with cycle detection, virtual blocker resolution
- `scopes` module: lazy get-or-create for Season/Month/Week/Day scopes with denormalized containment columns
- `knowledge_base` module: CRUD for People, Events, Threads (stub; no Obsidian integration yet)
- `commands` module: thin Tauri IPC wrappers for all domain operations
- `src-tauri/.cargo/config.toml` setting build target to `/tmp/arlesh-target` (Rust debug artifacts are large)
- 22 integration tests covering all modules: DB migrations, domain validation, task dependency/blocking, scope containment, KB entities


## [0.1.0] — 2026-06-20

### Added
- Initial design specification (`SPEC.md`) covering:
  - Domain/Aspect/Project/Goal/Task resource model
  - Tag structure (flat leaves under a domain)
  - Knowledge-base entities: People, Scopes, Events, Threads
  - Scope containment model with denormalized columns
  - Link inheritance rules per type (additive vs. override)
  - Three-mode filter logic (Any / All / Exclusion)
  - Mindmap view: left-right balanced tree, SVG renderer, D3 layout
  - List view: task rows with clickable tag/parent chips, goal visibility toggle, four preset modes
  - Five implementation phases
- Tech stack decision: Tauri 2.0 + React + TypeScript + SQLite
