# Arlesh

A knowledge-base and task management desktop app that integrates with [Obsidian](https://obsidian.md) via the [local-rest-api](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin.

## What it is

Arlesh manages resources (tasks, goals, domains, knowledge-base entities) and their linkages. Task management is the primary focus; knowledge-base integration allows filtering and contextualizing tasks against notes, people, events, and threads.

Two main views:
- **Mindmap** — a left-right balanced tree editor for navigating and building the task hierarchy
- **List** — a filterable task list with preset modes (Plan / Start / Do / Unblock)

## Stack

| Layer     | Choice                        |
|-----------|-------------------------------|
| Framework | Tauri 2.0                     |
| Frontend  | React + TypeScript            |
| Mindmap   | Custom SVG renderer (D3 tree) |
| Storage   | SQLite                        |
| KB sync   | Obsidian local-rest-api       |

## Status

Design phase. See [`SPEC.md`](SPEC.md) for the full specification.

## Implementation Phases

1. **Data layer** — schema, migrations, Tauri commands, integration tests
2. **Mindmap view** — SVG tree editor with keyboard interaction
3. **List view** — filterable task list with preset modes
4. **KB resources backend** — People, Events, Threads, Scopes (stub Obsidian adapter)
5. **Obsidian integration** — real REST client, note discovery, sync
