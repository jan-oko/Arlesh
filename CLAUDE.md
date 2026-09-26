# Arlesh — Claude Instructions

## Project

Task management + Obsidian knowledge-base desktop app. See `SPEC.md` for the full design specification and `README.md` for an overview.

Stack: Tauri 2.0 · React · TypeScript · SQLite

## Rules

Additional rules live in `.claude/rules/`. Read them before starting any task.

## Key conventions

- The design specification is authoritative. Update it when design decisions are made or revised. It is one document in several files: `SPEC.md` is the front door — the overview, an index of the areas, and the implementation phases — and each area lives in its own file under `docs/spec/` (`resources.md`, `time-scopes.md`, `flows.md`, `habits.md`, `link-inheritance.md`, `filtering-logic.md`, `tabs.md`, `mindmap-view.md`, `list-view.md`, `mcp-server.md`, `undo.md`). Write a design change into the area file it belongs to, so two features in flight stop meeting in one file; `SPEC.md` itself changes only when an area is added, renamed or removed.
- **Changelog fragments, and no assembled file.** Record a user-visible change as one file at `changelog.d/<heading>/<NNNN>-<slug>.md`, where the directory is the heading — `added`, `changed`, `fixed` or `removed`. The four-digit number orders the section, newest first; pick one above every number you can see. It does **not** have to be unique, so two branches picking the same number still produce two different files. The file holds the entry exactly as it should read, starting `- **Title.** …`, continuation paragraphs indented two spaces. It is user-facing: describe behaviour, not refactors. Nothing user-visible changed? Write no fragment.
  - There is no `CHANGELOG.md` and nothing assembles one. The fragments **are** the record. `CHANGELOG.md` and the `changelog:check` CI gate were dropped on 2026-09-22 because the gate could only ever fire on master, after the merge that carried a fragment — so every such merge went red, and 17 of master's 18 red runs were that check rather than a real break, camouflaging the one genuine failure. Reassembling is tracked as `Arlesh-ab9`, deferred: it needs a credential that can push to a protected master, which the default `GITHUB_TOKEN` is not.

- **Commit all changes at the end of every request.** Stage and commit everything modified during the request in a single commit with a clear message. Do not leave the working tree dirty.
- The implementation phases, listed in `SPEC.md` and nowhere else, define sequencing. Do not implement Phase N+1 features while Phase N is in progress unless explicitly asked.

## Tracking work: the Arlesh board

Work is tracked as **Agentic Tasks under the ARLESH project** on the user's Arlesh board, through the `Arlesh` MCP server (`.mcp.json`; `http://127.0.0.1:4747/mcp` by default — the port is configurable in Arlesh's Settings → MCP). The server's own instructions describe every tool and its rules; read them.

| To… | Use |
| --- | --- |
| Find ready work | `arlesh_snapshot.load` with `agentic: {}` (or `{"max_priority": "A"}`) and `filter: {"preset": "start"}`; keep calling with `next_cursor` until it is null |
| View one Task | `arlesh_tasks.get` |
| Claim it | `arlesh_tasks.set_status` `todo` → `in_progress` (compare-and-set on the status you last saw; the brief needs a Spec) |
| Finish it | `arlesh_tasks.set_status` → `done` |
| Record design, notes, acceptance | `arlesh_tasks.update` with `brief` |
| Dependencies, Time Scope, Plan, tags, block reasons | the matching `arlesh_tasks.update` / `create` fields |
| Ask the user and wait for the answer | `arlesh_waits.ask` (`arlesh_waits.raise` with `question: false` to wait on something else, e.g. CI) |
| Add a note under a Task | `arlesh_infos.create` |
| Link a bd-era issue id | `arlesh_beads.set` |

Priorities are `MW`, `A`, `B`, `C`, most urgent first; backlogged work has no priority.

**Rules**

- **Never create a Task, and never set or change a priority, without the user's approval** — propose it (with a suggested priority) and let them decide. Claiming or updating a Task the user assigned is fine.
- If the MCP is unreachable, Arlesh isn't running (it must be open or in the tray): say so and ask the user to start it. Don't guess at the board, and don't fall back to bd.
- `.beads/` is kept as a read-only archive of the closed bd history. Don't run `bd` to track new work.
