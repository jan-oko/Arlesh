# Changelog

All notable changes to Arlesh are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

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
