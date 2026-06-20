# Arlesh — Claude Instructions

## Project

Task management + Obsidian knowledge-base desktop app. See `SPEC.md` for the full design specification and `README.md` for an overview.

Stack: Tauri 2.0 · React · TypeScript · SQLite

## Rules

Additional rules live in `.claude/rules/`. Read them before starting any task.

## Key conventions

- `SPEC.md` is the authoritative design document. Update it when design decisions are made or revised.
- `CHANGELOG.md` uses Keep a Changelog format. Update it whenever a meaningful change is made.
- `VERSION.txt` holds the current semver. Ask the user before bumping it; do not bump it automatically. See `.claude/rules/versioning.md` for guidance.
- The five implementation phases in `SPEC.md` define sequencing. Do not implement Phase N+1 features while Phase N is in progress unless explicitly asked.
