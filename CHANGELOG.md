# Changelog

All notable changes to Arlesh are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- Mindmap view: SVG mind map editor with a left-right balanced tree layout
  - All Domains, Projects, Goals, and Tasks displayed as a unified tree rooted at the six Aspects
  - Pan (middle-click drag) and zoom (scroll/pinch) with spring animation
  - Structural keyboard navigation (← parent, → first child, ↑↓ siblings)
  - Tab to create a child node with inline title entry; Enter to confirm, Esc to cancel
  - Context menu on right-click: enter subtree, rename, cycle type, cut/copy/paste, collapse/expand, delete
  - Ctrl+X/C/V keyboard shortcuts for cut/copy/paste as child
  - Double-click opens an editor modal for title and tag assignment
  - Drag-and-drop to re-parent nodes
  - Ctrl+Up / Ctrl+Down to cycle node type (Domain → Project → Goal → Task); crossing Goal↔Task shows a status-mapping toast
  - Enter subtree mode via context menu; subtree navigation pill in top-left; Esc to go up, Shift+Esc to return to root
  - Ctrl+/ to collapse/expand a subtree; Delete key to delete a node
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
