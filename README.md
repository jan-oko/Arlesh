# Arlesh

A knowledge-base and task management desktop app that integrates with [Obsidian](https://obsidian.md) via the [local-rest-api](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin.

## What it is

Arlesh manages resources (tasks, goals, domains, knowledge-base entities) and their linkages. Task management is the primary focus; knowledge-base integration allows filtering and contextualizing tasks against notes, people, events, and threads.

Two main views (`Alt+L` or the top-bar tabs switch between them):
- **Mindmap** — a left-right balanced tree editor for navigating and building the task hierarchy
- **List** — a filterable task list sharing the Mindmap's filters, with its own preset modes (All / Plan / Start / Do / Unblock) and additional pill filters (parent, antecedent, dependency, statuses, scope, blocked)

Both views are keyboard-driven; `Ctrl+Shift+/` opens a cheat-sheet listing every binding.

## Agent access (MCP)

While the app is running it serves a read-only [MCP](https://modelcontextprotocol.io) endpoint at
`http://127.0.0.1:4747/mcp`, so an agent can read your board instead of being told what is on it.

`.mcp.json` in this repo already registers it, so a Claude Code session started here picks it up —
approve it once when prompted. To add it elsewhere:

```
claude mcp add --transport http arlesh http://127.0.0.1:4747/mcp
```

The endpoint only answers while Arlesh is open; with the app closed the server simply fails to
connect.

Six tools, of which `arlesh_snapshot` returns the whole planning graph, a page at a time. An agent
cannot create, rename, complete or delete anything; the single thing it can write is an item's
`bd` issue link, which is also the only way that link is ever set. The port is overridable with
`ARLESH_MCP_PORT`; the endpoint binds loopback only and refuses requests from a browser. See the
**MCP Server** section of [`SPEC.md`](SPEC.md).

## Stack

| Layer     | Choice                        |
|-----------|-------------------------------|
| Framework | Tauri 2.0                     |
| Frontend  | React + TypeScript            |
| Mindmap   | Custom SVG renderer (D3 tree) |
| Storage   | SQLite                        |
| KB sync   | Obsidian local-rest-api       |

## Status

**Phases 1–3 complete** — data layer, Mindmap view, and List view are implemented and tested. See [`SPEC.md`](SPEC.md) for the full specification.

## Implementation Phases

1. **Data layer** — schema, migrations, Tauri commands, integration tests ✅
2. **Mindmap view** — SVG tree editor with keyboard interaction ✅
3. **List view** — filterable task list with preset modes ✅
4. **KB resources backend** — People, Events, Threads, Scopes (stub Obsidian adapter)
5. **Obsidian integration** — real REST client, note discovery, sync
