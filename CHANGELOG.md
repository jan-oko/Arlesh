# Changelog

All notable changes to Arlesh are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Changed
- Arrow key navigation now moves only to connected nodes (parent, children, siblings) while still picking the visually nearest one in the pressed direction — prevents jumping across unrelated branches
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
