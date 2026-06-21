# Changelog

All notable changes to Arlesh are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- Phase 1 data layer: SQLite schema, sqlx migrations, domain-first Rust module structure
- `domains` module: CRUD for Aspects (seeded, immutable), Projects, Domains, Tags with parent/subtype validation
- `tasks` module: CRUD for Tasks and Goals, dependency tracking with cycle detection, virtual blocker resolution
- `scopes` module: lazy get-or-create for Season/Month/Week/Day scopes with denormalized containment columns
- `knowledge_base` module: CRUD for People, Events, Threads (stub; no Obsidian integration yet)
- `commands` module: thin Tauri IPC wrappers for all domain operations
- `src-tauri/.cargo/config.toml` setting build target to `/tmp/arlesh-target` (Rust debug artifacts are large)
- 22 integration tests covering all modules: DB migrations, domain validation, task dependency/blocking, scope containment, KB entities

### Changed
- Expanded all abbreviated identifiers per no-abbreviation naming convention:
  - Module `kb` → `knowledge_base`, `db` → `database`
  - Type `DbPool` → `DatabasePool`, `KbError` → `KnowledgeBaseError`
  - Error variant `Db` → `Database` across all domain error enums
  - SQL column `kb_dir` → `knowledge_base_directory` in `domains` table
  - SQL columns `dep_type`/`dep_id` → `dependency_type`/`dependency_id` in `task_dependencies` table
  - SQL tables `goal_kb_links`/`task_kb_links` → `goal_knowledge_base_links`/`task_knowledge_base_links`
  - All local variables and parameters expanded (e.g. `req` → `request`, `m` → `month`, `v` → `value`, `dep` → `dependency`)
- Fixed Stop hook false-positive TypeScript errors: gate check on `node_modules/.bin/tsc` instead of `npx tsc`

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
