# Agent Instructions

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
| Link a bd-era issue id | `arlesh_beads.set` |

Priorities are `MW`, `A`, `B`, `C`, most urgent first; backlogged work has no priority.

**Rules**

- **Never create a Task, and never set or change a priority, without the user's approval** — propose it (with a suggested priority) and let them decide. Claiming or updating a Task the user assigned is fine.
- **Always hand back with an agentic question.** When you finish your work, or otherwise pass it to the user — a PR ready for review, a spec question, anything the user must act on — raise a question wait under the Task with `arlesh_waits.ask`, its title saying what the user must do ("PR #n is green: review and merge?"). That is what puts the Task in **Review**, and it is the only way an agent hands responsibility back. Don't mark the Task `done` yourself while the user still has to act; set `done` only after their answer settles it.
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
