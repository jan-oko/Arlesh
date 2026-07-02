# Changelog

All notable changes to Arlesh are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Changed
- A task's **Plan** is now a boundaries window (start + end scope), like its Time Scope, so a task can be planned across a span (e.g. W45–W49), not just a single scope; migration `0007` moves `plan_scope_id` to `plan_start_id`/`plan_end_id`. The Plan field is now a range picker rendered like the Time Scope
- Split a task/goal's single `scope_id` into a **Time Scope** (relevance window, on tasks and goals) and a task-only **Plan** (scope scheduled into). Time Scope is a boundaries window (start/end scope ids) that also remembers its Duration parameters when set that way; migration `0006` migrates the old `scope_id` to the Time Scope and adds `plan_scope_id`. API types gain a shared `TimeScope` value object

### Added
- **Start a flow (Phase 7.4)**: press `s` on a focused flow node (or context-menu **Start flow**) to materialise the template into a **real, independent Goal/Task subtree** under a target. The start modal takes a root title, a target node (defaulting to the flow's Target Node), and — for a scoped flow — an anchor date whose flow-kind scope becomes the window's first period. Each relative cycle pair resolves **by offset** into a concrete Time Scope + Plan (an item with N pairs yields N items; an unscoped flow yields one unscoped item each), intra-flow dependencies remap by **fan-in** (each dependent instance waits on every blocker instance), and the run is recorded in `flow_instances` / `flow_instance_nodes` (migration `0010`) so flow-originated nodes stay distinguishable and moves are detectable. Backed by the `start_flow` command.
- **Flow items + cycles (Phase 7.3)**: a flow now holds child **flow items** (flow-goals / flow-tasks) rendered under it in the mindmap, created like any child (a flow root spawns items of its Instance Type; an item spawns items of its own kind). A dedicated **flow-item editor** sets the item's title, block reason, intra-flow **dependencies** (on any other item in the same flow), and relative **(Cycle Scope, Cycle Plan)** pairs via a grid modelled on the Scope Picker but labelled relatively ("Day 3 of the flow window"). Cycles and dependencies are stored as relative indices (migration `0009`: `flow_item_cycles`, `flow_dependencies`) and resolved to concrete scopes only at start (Phase 7.4). Backed by `list_all_flow_goals`/`_tasks`/`_cycles`/`_dependencies`, `update_flow_goal`/`_task`, `delete_flow_item`, `set_flow_item_cycles`, and `add`/`remove_flow_dependency` commands
- **Flows (Phase 7)**: a Flow is a template node kind that materializes a Goal/Task subtree on demand. Create one via the **New Flow** context-menu action on an Aspect, Domain, Project, or Goal — this opens a blank **Flow editor** and the flow is persisted only on save. The editor covers its title, **Instance Type** (goal or task), an **optional** Duration-form **flow scope** (N of day/week/month/season, or unticked for Unscoped instances), and a **Target Node** search combobox. Flow nodes render with a wave icon. Backed by the `flows`/`flow_goals`/`flow_tasks` tables (migration `0008`) and `create_flow`/`get_flow`/`list_flows`/`update_flow`/`delete_flow` commands. Flow items, cycle scopes, and start-materialization land in later Phase 7 steps
- Scope summary text is now localized: `Unscoped`/`Unplanned`, durations (pluralized), and month/season/week labels go through i18next (new `scopes` namespace) with Hebrew translations, so the translation-completeness gate covers them
- Narrowing a Task/Goal's Time Scope in the editor, or **dragging a scoped item under a tighter-scoped ancestor**, now detects the items that would fall outside the resulting window and **prompts to clamp them to the new scope or cancel** (via `scope_containment_conflicts` / `reparent_scope_conflicts`), instead of a hard backend rejection
- **Scope Picker**: a date-picker-style calendar (season/month/week/day/part-of-day) wired into the Task and Goal editor modals. Set a **Time Scope** as a Boundaries range or a **Duration** (N of a kind, snapshotted while remembering the duration form), and a task **Plan** via a single-scope picker constrained to the task's Time Scope. Out-of-window Plans/child scopes are rejected by the backend and surfaced as the modal's save error. (Exact-datetime clock view and the narrowing cascade prompt are still to come.)
- Scope command surface for the Scope Picker: `get_or_create_part_scope`, `get_or_create_exact_scope`, and `resolve_scope` (returns the half-open `[start, end)` datetime window + current `active` state, reusing `scopes::resolve`); frontend `src/api/scopes.ts` wraps these plus the existing `get_scope`/`get_or_create_scope`
- Write-time scope-containment enforcement: a task's **Plan** must be within its **Time Scope**, and a task/goal's **Time Scope** (and a task's Plan) must be within the nearest scoped ancestor's window — interval containment on resolved datetimes. Violating creates, updates, and reparents are rejected with `TaskError::ScopeContainment`
- `scope_containment_conflicts` command (and `scopeContainmentConflicts` API): lists the task/goal descendants a scope-narrowing or reparent would orphan, to drive a clamp-or-cancel prompt (the prompt UI lands with the Scope Picker)
- Part-of-Day and Exact scope kinds (Phase 6, Time Scopes): six sub-day bands (Night crosses midnight, parented to its starting day) and arbitrary minute-precision datetime ranges. Scopes resolve to half-open `[start, end)` datetime intervals with `active` and interval-containment checks; `ScopeRepository::get_or_create_part` / `get_or_create_exact` constructors; migration `0005` rebuilds the scopes table with `part`/`day_id`/`start_datetime`/`end_datetime` columns and per-family partial unique indexes
- Direct integration tests for `database::connect()` and `database::run_migrations()` — verifies the `after_connect` PRAGMA hook and migration seed; `database/mod.rs` is now 14/14 (100%)
- Rust integration tests expanded from 22 to 74: covers all repository branches including blocked_reason set/clear on tasks and goals, `TaskStatus::InProgress`, `GoalStatus::Frozen`/`Archived`, `GoalRepository::is_achieved`, scope assignment on tasks and goals, cannot-update/cannot-retype-to-aspect, project-without-parent, linked_note update on persons, December month scope, Aspect subtype listing, Project/Tag subtype conversion, `ProjectStatus::Achieved`/`Archived`; `domains/mod.rs` is now 109/109 (100%)
- Stop hook now runs `cargo tarpaulin --engine ptrace --skip-clean` (cache at `~/.cache/arlesh/tarpaulin`) and blocks the session if coverage drops below 85%; tarpaulin uses a separate target dir to avoid invalidating `cargo test` artifacts
- 34 Rust inline unit tests (`#[cfg(test)]`) covering pure functions with no DB dependency: `scope_bounds` (all 4 kinds including leap-year Feb and Dec month), `scope_label`, `week_number`, `season_name_and_year`, `season_start_month_and_year` (scopes/mod.rs); `ScopeKind::as_str`, `ScopeId` roundtrip (scopes/model.rs); `TaskStatus::as_str`, `GoalStatus::as_str`, `TaskId`/`GoalId` roundtrips (tasks/model.rs); `dependency_parts` task/goal branches (tasks/mod.rs)
- 28 frontend unit tests: Zustand store (use-mindmap-store.test.ts — selectNode, addToSelection, setSelection, enterSubtree, exitSubtree, exitToRoot, toggleCollapsed, clipboard, toast); context-action dispatch (use-context-action.test.ts — all 10 CONTEXT_ACTION variants including null-clipboard PASTE guard and unknown-node guard)

### Removed
- `TaskStatus::parse_db()` — dead code, never called anywhere in production or tests
- Dead `end_month == 12` branch in `scope_bounds` for Season — `end_month` is always 2, 5, 8, or 11 by construction; also removed the unused `end_month_start` intermediate variable

### Fixed
- Info nodes rendered with a task icon (cycle appeared to do nothing); added a dedicated InfoIcon (circle with an "i") and wired it into NodeIcon

### Added
- Double-tap Enter on a focused node enters it as a subtree (same as context menu → Enter; only applies to nodes that can be subtree roots: not tasks, goals, or tags)
- Canvas recenters on the new root node when entering a subtree

### Fixed
- After deleting a node, focus now moves to the nearest non-deleted ancestor instead of clearing to nothing; for multi-delete, focus targets the parent of the first deleted node
- Left/Right arrow keys now navigate to parent or children only (whichever lies in that screen direction), never jumping across to unrelated siblings; Up/Down navigate among siblings only

### Added
- Info node kind: free-text bullet-point nodes (ℹ icon) that can be children of any existing node type and can only have info children; stored in a new `infos` DB table
- Info nodes participate in the type cycle (Ctrl+Up/Down); cycling to info when a node has non-info children shows a warning modal with reparent/delete options
- Multi-node selection: Ctrl+click toggles a node in/out of the selection; Shift+click on a sibling range-selects all siblings between anchor and target; Shift+click on an ancestor selects the anchor and all nodes up to that ancestor; Shift+click on an unrelated node does nothing
- Ctrl+X / Ctrl+C now operate on all selected nodes; Delete key deletes all selected nodes
- Paste of a multi-node clipboard moves top-level selected nodes (ancestors take their descendants with them) as children of the paste target in original tree order
- Delete confirmation for multiple nodes shows "Delete N nodes?" instead of a single title
- Shift+Enter on a focused node creates a new sibling of the same type and enters inline edit mode
- `e` key on a focused node opens the editor modal (same as double-click)
- `r` key on a focused node starts inline title editing (same as F2)
- Ctrl+Enter on a focused node inserts an intermediate parent between the node and its current parent, then enters inline edit mode on the new parent
- Enter key cycles status on focused task nodes (todo → in_progress → done → todo); blocked tasks are skipped

### Fixed
- Node also resizes during inline editing when typed text wraps to a new line (previously only explicit Shift+Enter triggered a resize); uses the same character-width heuristic as display mode via a new `estimateWrappedLineCount` helper
- Node text overflowed its bounding box when the title wrapped across multiple lines: `NodeLabel` was centering using only the explicit-newline count instead of the estimated wrapped-line count, producing excess `paddingTop` that pushed wrapped text outside the `foreignObject`; `computeNodeDimensions` now returns `lineCount` and `NodeLabel` uses it directly

### Fixed
- SubtreeNavPill no longer overlaps the top bar: pill container now uses `top: calc(var(--topbar-height) + var(--space-2))` via a new `--topbar-height` token (36 px)
- Plain Esc no longer exits the subtree when a node is selected; it now only deselects the focused node
- Shift+Esc was incorrectly wired to exit-to-root; it now correctly exits one level to the parent subtree

### Added
- SubtreeNavPill shows two buttons: "← Arlesh" (exit to root) and "← {parent name}" (exit to parent)
- Ctrl+Esc exits to the Arlesh root from anywhere in subtree mode (works even with a node selected)
- Shift+Esc exits one level to the parent subtree (works even with a node selected)
- Plain Esc deselects the focused node; has no subtree-exit effect

### Fixed
- Node rect and textarea now expand in real time as the user presses Shift+Enter during inline edit, preventing content overflow; text position is identical between display and edit modes (consistent `paddingTop` centering instead of flexbox in display vs top-align in textarea)
- Moved `CONTEXT_ACTION`/`ContextMenuAction` to `context-action.ts` and `WARNING_VARIANT`/`WarningAction` to `warning-confirm.ts` so their component files export only the default component (fixes `react-refresh/only-export-components` ESLint warnings)

### Changed
- Aspects renamed from color labels to meaningful names: Red → Body, Purple → Connections, Green → Growth, Blue → Duty, Gray → Flow, Steel → Self
- Node height now expands dynamically to fit the full title without truncation; text wraps within the fixed node width using the browser's word-wrap
- Inline node edit uses a `<textarea>` instead of `<input>`; Shift+Enter inserts a line break, Enter commits
- Vertical sibling spacing increased from 60 px to 90 px to accommodate multi-line nodes
- Arrow key navigation now moves only to connected nodes (parent, children, siblings) while still picking the visually nearest one in the pressed direction — prevents jumping across unrelated branches; the Arlesh root node is included so navigation can pass from one side of the tree to the other through the centre
- After deleting a node, focus moves to its parent (or clears if the parent is the virtual root)

### Added
- Delete confirmation modal: replaces the browser `confirm()` dialog with a native in-app modal that shows the node title and total descendant count (e.g. "This will also permanently delete 3 descendant nodes"); Cancel is auto-focused so accidental Enter presses don't delete

### Fixed
- Cascade-delete subtrees: `removeNode` now receives a post-ordered list of all descendants (children before parent) and deletes them sequentially, preventing the SQLite FOREIGN KEY constraint failure (code 787) that occurred when deleting a domain/project with children
- Delete errors are now surfaced inside the confirmation modal instead of being swallowed silently (`void removeNode().then()` without `.catch()`)
- Keyboard shortcuts are blocked while the delete modal is open (Delete key no longer double-fires)
- White border around the app window: added `margin: 0; padding: 0` reset for `html`, `body`, and `#root` in `tokens.css`; deleted unused Tauri scaffold `App.css` (which also set a light background on `:root`)
- SVG canvas and drag ghost now set `direction: ltr` explicitly, preventing CSS `direction: rtl` (inherited from the document root in Hebrew mode) from flipping `textAnchor` semantics and causing LTR node text to overlap the icon
- SVG node layout now mirrors per-node based on the node's text content (first strong directional character), not the global app language — Latin-titled nodes always render LTR and Hebrew-titled nodes always render RTL, regardless of the language toggle; inline edit uses `dir="auto"` so the browser follows what the user types; `DragGhost` applies the same content-based detection

### Added
- Hebrew (עברית) i18n support with full RTL layout: all user-facing strings extracted to namespaced JSON translation files (`src/i18n/locales/{en,he}/{namespace}.json`); language toggle in new top bar persists to `localStorage`; `dir` attribute on root element drives RTL cascade throughout the app including CSS modules updated to use logical properties (`inset-inline-start`, `margin-inline-start`, `padding-inline-start`, `text-align: start`)
- `TopBar` component: slim header with app name and language toggle (עברית / English)
- `CONTEXT.md`: domain glossary with canonical term definitions and Hebrew translations
- `docs/TRANSLATIONS.md`: full terminology translation table and guide for adding languages
- ESLint `i18next/no-literal-string` rule enforcing that all JSX text and key attributes are wrapped in `t()`; Stop hook in `.claude/settings.json` runs lint automatically after each session

### Changed
- Refactored `src/components/` from flat files to per-component subdirectories; each component's TSX and CSS module are co-located in their own folder
- Extracted drag state and mouse event handlers into `src/hooks/use-drag.ts`
- Extracted keyboard navigation handlers into `src/hooks/use-keyboard-mindmap.ts`
- Extracted tree utility functions (`findNode`, `findParent`, `nearestInDirection`, `gatherSubtreeItems`, `collectTasksAndGoals`) into `src/utils/mindmap-tree.ts`
- Extracted shared node visual computation (`computeNodeAppearance`) into `src/utils/node-visuals.ts` to eliminate duplication between `MindmapNode` and `DragGhost`
- Split `NodeIcon` into per-kind subcomponents (`DomainIcon`, `ProjectIcon`, `GoalIcon`, `TagIcon`, `TaskIcon`) with a router `NodeIcon` component
- Split `MindmapNode` into `NodeRect` and `NodeLabel` subcomponents
- Extracted drag placeholder overlay into `DragPlaceholder` component
- Replaced `DomainEditorModal` and `TagEditorModal` (identical except heading) with unified `TitleEditorModal`
- Extracted canvas layout computation (effectiveCollapsedIds, positions, subtreeLayout, placeholderPos) into `src/hooks/use-canvas-layout.ts`
- Extracted node type cycling and retype-warning state into `src/hooks/use-node-type-manager.ts`
- Extracted editor modal state and all node save handlers into `src/hooks/use-node-editor.ts`
- Extracted node mutation callbacks (`onStatusClick`, `onCommitEdit`, `onCreateChild`, `onDelete`, `onPaste`) into `src/hooks/use-node-actions.ts`
- Moved `buildRetypeActions` into `use-node-type-manager`; hook now returns `retypeActions` directly
- All editor modals now use a shared `EditorModal` shell for consistent layout
- `MindmapView` reduced from 919 to 161 lines; all remaining code is wiring and JSX
- Replaced all magic strings with named constants co-located with their domain: `TASK_STATUS`/`GOAL_STATUS` in `status-mapping.ts`, `CLIPBOARD_OP` in `use-mindmap-store.ts`, `GOAL_CHILDREN_ACTION` in `use-mindmap-data.ts`, `WARNING_VARIANT` in `WarningConfirmModal.tsx`, `DOMAIN_SUBTYPE` in `api/domains.ts`, `CONTEXT_ACTION` in `NodeContextMenu.tsx`
- `useKeyboardMindmap` option `warningModal` replaced with `isWarningActive: boolean`, eliminating the banned `as` type assertion at the call site
- `useDrag` absorbs drop execution (`{ tree, moveNode }` options); `handleDrop` removed from `MindmapView`
- Context-menu dispatch extracted into `use-context-action.ts`; arrow-key navigation into `use-navigate-arrow.ts`
- All hooks specific to one component relocated into that component's directory; `src/hooks/` removed

### Added
- Drag-and-drop to re-parent nodes: drag any non-aspect node onto a valid parent and release to move it; valid drop targets highlight in the accent colour; invalid targets (e.g. dropping a goal onto a task, or a node onto one of its own descendants) are silently rejected
- Drag ghost: while dragging, the source node is hidden and a semi-transparent copy follows the cursor; a dashed outline placeholder appears at the predicted landing position under the hovered parent; the dragged node's children are hidden from the live tree and rendered as smaller dashed outlines (with internal edges) inside the placeholder, so the full subtree structure is visible at the drop position

### Fixed
- Drag-and-drop now works in Tauri/WebKit: replaced the HTML5 drag API (unreliable on SVG elements in WebKitGTK) with mouse-event drag-and-drop using `onMouseDown` + global `mousemove`/`mouseup` and `document.elementsFromPoint` for hit-testing

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
