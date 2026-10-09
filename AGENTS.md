# Arlesh — Agent Instructions

## Project

Task management + Obsidian knowledge-base desktop app. See `SPEC.md` for the full design specification and `README.md` for an overview.

Stack: Tauri 2.0 · React · TypeScript · SQLite

## Rules

Additional rules live in `.claude/rules/`. Read them before starting any task.

## Key conventions

- The design specification is authoritative. Update it when design decisions are made or revised. It is one document in several files: `SPEC.md` is the front door — the overview, an index of the areas, and the implementation phases — and each area lives in its own file under `docs/spec/` (`resources.md`, `time-scopes.md`, `flows.md`, `habits.md`, `link-inheritance.md`, `filtering-logic.md`, `tabs.md`, `mindmap-view.md`, `list-view.md`, `mcp-server.md`, `undo.md`). Write a design change into the area file it belongs to, so two features in flight stop meeting in one file; `SPEC.md` itself changes only when an area is added, renamed or removed.
- **The model map** — [`docs/model-map.html`](docs/model-map.html) for people, [`docs/model-map.md`](docs/model-map.md) for agents — says how the concepts fit together and why each exists. Read the `.md` before changing the model. [`docs/model-graph.html`](docs/model-graph.html) is the derivation graph on its own page. **Keep all three files in step with the code:** a PR that adds, removes or changes the meaning of a concept, or what a derived state is computed from, updates `model-map.html`, `model-map.md` and `model-graph.html` in the same PR, as it updates the spec.
- **Changelog fragments; the bot assembles `CHANGELOG.md`.** Record a user-visible change as one file at `changelog.d/<heading>/<NNNN>-<slug>.md`, where the directory is the heading — `added`, `changed`, `fixed` or `removed`. The four-digit number orders the section, newest first; pick one above every number you can see. It does **not** have to be unique, so two branches picking the same number still produce two different files. The file holds the entry exactly as it should read, starting `- **Title.** …`, continuation paragraphs indented two spaces. It is user-facing: describe behaviour, not refactors. Nothing user-visible changed? Write no fragment.
  - **Never edit `CHANGELOG.md` by hand, and never run `npm run changelog` on a branch** (reassembling on a branch puts the merge conflict back). The master bot (`.github/workflows/master-bot.yml`) reassembles its `[Unreleased]` section from the fragments after every push to master and commits it with `BOT_COMMIT_ACCESS_TOKEN`, an administrator's token that can push past master's required checks (the default `GITHUB_TOKEN` cannot: GH006). Nothing in CI fails a branch or a master run over `CHANGELOG.md` — the `changelog:check` gate was dropped on 2026-09-22 because it could only ever fire on master after the merge that carried a fragment (17 of master's 18 red runs). This replaces the deferred `Arlesh-ab9`.
- **Adding a migration.** Write `crates/arlesh-core/migrations/NNNN_name.sql` with the next number and never edit or renumber an existing one: its checksum is recorded in real databases. A **fresh** database does not run the chain; it is created from `crates/arlesh-core/baseline/schema.sql` (the schema and seed data as of the migration in `baseline/version.txt`), which records those versions as applied, and then runs only the migrations numbered above it. So a new migration needs nothing else: **the master bot re-cuts the baseline** to the newest migration after it lands (`scripts/recut-baseline.mjs`, which rewrites `version.txt` and regenerates `schema.sql`), and **nobody re-cuts by hand** or on a branch. The unit test `the_baseline_file_is_what_the_migrations_generate` fails if the two ever disagree; to regenerate locally for a look, `cargo run -p arlesh-core --example generate_baseline`. Why it exists: the chain's `ALTER TABLE` drop/rename statements each revalidate the whole schema, which made every test database cost ~3 s to build.

- **Commit all changes at the end of every request.** Stage and commit everything modified during the request in a single commit with a clear message. Do not leave the working tree dirty.
- The implementation phases, listed in `SPEC.md` and nowhere else, define sequencing. Do not implement Phase N+1 features while Phase N is in progress unless explicitly asked.

## Tracking work: the Arlesh board

Work is tracked as **Agentic Tasks under the ARLESH project** on the user's Arlesh board, through the `Arlesh` MCP server (`.mcp.json`; `http://127.0.0.1:4747/mcp` by default — the port is configurable in Arlesh's Settings → MCP). The server's own instructions describe every tool and its rules; read them.

| To… | Use |
| --- | --- |
| Find ready work | `arlesh_snapshot.load` with `agentic: {}` (or `{"max_priority": "A"}`) and `filter: {"preset": "start"}`; keep calling with `next_cursor` until it is null |
| View one Task | `arlesh_tasks.get` |
| Claim it | `arlesh_tasks.set_status` `todo` → `on_agent` (compare-and-set on the status you last saw; the brief needs a Spec) |
| Hand back to the user | `arlesh_waits.ask` under the Task, titled with what the user must do (e.g. "PR #n is green: review and merge?") — puts the Task in **Review** |
| Finish it | `arlesh_tasks.set_status` → `done`, only once the user has answered the hand-back and nothing is left for them to do |
| Record design, notes, acceptance | `arlesh_tasks.update` with `brief` |
| Dependencies, Time Scope, Plan, tags, block reasons | the matching `arlesh_tasks.update` / `create` fields |
| Ask the user and wait for the answer | `arlesh_waits.ask` — a question wait puts an On Agent Task in **Review** (`arlesh_waits.raise` with `question: false` to wait on something else, e.g. CI) |
| Add a note under a Task | `arlesh_infos.create` |

Priorities are `MW`, `A`, `B`, `C`, most urgent first; backlogged work has no priority.

**Rules**

- **Never create a Task, and never set or change a priority, without the user's approval** — propose it (with a suggested priority) and let them decide. Claiming or updating a Task the user assigned is fine.
- **Always hand back with an agentic question — the board must stay truthful.** It has to show what is really happening: a Task whose next step is the user's must read **Review**, with the reason visible. So when you finish your work, or otherwise pass it to the user — a PR ready for review, a spec question, anything the user must act on — raise a question wait under the Task with `arlesh_waits.ask`. Its title (and its note, if more is needed) says why: what the user must do ("PR #n is green: review and merge?"). The question is what puts the Task in Review, and it is the only way an agent hands responsibility back; without it the Task sits **On Agent** and looks as if the agent still holds it. Don't mark the Task `done` yourself while the user still has to act; set `done` only after their answer settles it.
- If the MCP is unreachable, Arlesh isn't running (it must be open or in the tray): say so and ask the user to start it. Don't guess at the board, and don't fall back to bd.
- `.beads/` is kept as a read-only archive of the closed bd history. Don't run `bd` to track new work.

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**
- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var
