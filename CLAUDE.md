# Arlesh — Claude Instructions

## Project

Task management + Obsidian knowledge-base desktop app. See `SPEC.md` for the full design specification and `README.md` for an overview.

Stack: Tauri 2.0 · React · TypeScript · SQLite

## Rules

Additional rules live in `.claude/rules/`. Read them before starting any task.

## Key conventions

- `SPEC.md` is the authoritative design document. Update it when design decisions are made or revised.
- `CHANGELOG.md` uses Keep a Changelog format, under a single `[Unreleased]` section — this is a personal app in live preview, with no release cycle. Record every meaningful change there using the `Added` / `Changed` / `Fixed` / `Removed` headings. It is user-facing: describe behaviour, not refactors.
- **Commit all changes at the end of every request.** Stage and commit everything modified during the request in a single commit with a clear message. Do not leave the working tree dirty.
- The five implementation phases in `SPEC.md` define sequencing. Do not implement Phase N+1 features while Phase N is in progress unless explicitly asked.
