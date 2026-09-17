# Board progress — parallel agent run

Goal: finish the beads task board, or stop at 8 open PRs.
Rules: highest priority / lowest effort first; **at most 2 agents in flight** (revised down from 4 —
see Standing risks); at most 2 `effort:high` at once.

## Gate (every agent runs it before opening a PR)

- `npm run lint` · `npx tsc --noEmit` · `npm test`
- Rust changes only: `CARGO_TARGET_DIR=~/.cache/arlesh/tarpaulin cargo tarpaulin --engine ptrace --skip-clean --fail-under 90 --exclude-files 'src/commands/*'`
- Then `rm -rf src-tauri/target` in the worktree (disk is at 95%).

## Waves

### Wave 1 — dispatched 2026-09-17

| Bead | P | Effort | Worktree | Status |
|---|---|---|---|---|
| Arlesh-a4u — Moving a Flow reparents an unrelated Domain | P1 | low | `flow-move-fix` | resumed — edits in tree, uncommitted |
| Arlesh-9qq — List View Ctrl+O | P1 | low | `listview-ctrl-o` | **PR #3** (`ad3c49b`) — subtree entry; restacked onto `worktree-listview-path-headers` |
| Arlesh-817 — List View path headers | P1 | medium | `listview-path-headers` | **PR #4** |
| Arlesh-n66 — Task Backlog | P1 | medium | `task-backlog` | resumed — had not started editing |

**Interruption 2026-09-17:** the Claude Code process exited and killed all four agents mid-run.
No commits, no pushes, no PRs were lost — none had been made. All four worktrees survived with
their uncommitted work and all four agents were resumed from their saved transcripts.
Two repairs were needed:

- `PathHeaderRow.module.css` in `listview-path-headers` had been left as an interrupted atomic
  write (`…css.tmp.1002256.9d1ac3f9133d`); renamed into place.
- The `node_modules` symlink showed as untracked, because `.gitignore` has `node_modules/` with a
  trailing slash and a symlink is not a directory to git. Added a slash-less `node_modules` to
  `.git/info/exclude` (shared across worktrees) so no agent can stage it.

### Wave 2

| Bead | P | Effort | Worktree | Status |
|---|---|---|---|---|
| Arlesh-6gm — indent subtasks by visible depth | P1 | low | `listview-indent` | **PR #6**, stacked on PR #4 |
| Arlesh-je5 — copy-paste duplicates instead of moving | P1 | high | `duplicate-paste-v2` | **PR #8**, stacked on PR #5 — coverage 90.96% |
| Arlesh-cyo — Commitments | P1 | high | `commitments` | **PR #10**, stacked on PR #7 — coverage 90.79%, migration `0026` |
| Arlesh-zem — delete-dialog focus | P2 | low | `delete-focus` | **PR #9**, from master |

**Rate limit, 2026-09-17 ~21:40.** All four in-flight agents died at once on the session API limit.
`a4u` was mid-gate, `n66` mid-implementation, `6gm` had barely started; all work survived in the
worktrees. Resumed `a4u` and `n66` only; `6gm` is held until a slot frees.

### Wave 2 — dispatched after 9qq and 817 landed PRs

| Bead | P | Effort | Worktree | Status |
|---|---|---|---|---|
| Arlesh-qf3 — Type cycling offers hidden kinds | P2 | low | `type-cycle-filter` | dispatched |
| Arlesh-zem — Delete-confirm focus | P2 | low | `delete-modal-focus` | dispatched |

**Why P2 lows ahead of the P1 highs.** `je5` is next by priority, but its branch rewrites
`moveNode` in `use-mindmap-data.ts` and `a4u` is rewriting the same function right now. Rebasing a
27-file branch onto master twice is wasted work, so `je5` waits for `a4u`'s PR. `cyo` and `4yp`
both collide with `n66` (lifecycle/filters) and with the List View work; `bwc` amends `SPEC.md`,
which both `817` and `n66` also amend. `qf3` and `zem` are the largest pieces of work that touch
nothing in flight.

## PRs opened

| PR | Bead | Branch |
|---|---|---|
| #3 | Arlesh-9qq | `worktree-listview-ctrl-o` |
| #4 | Arlesh-817 | `worktree-listview-path-headers` |

### Queue (refill as slots free)

1. Arlesh-4yp — Tabs (P1, high)
2. Arlesh-qf3 (P2 low), Arlesh-zem (P2 low), Arlesh-6dm (P2 low, new), Arlesh-bwc (P2 medium),
   Arlesh-qcb (P2 medium), Arlesh-p2g (P2 medium, blocked by 817),
   Arlesh-aln (P2 high), Arlesh-fxo (P2 high, blocked by 4yp)
3. P3: Arlesh-ba8 (medium), Arlesh-32r (high), Arlesh-y2l (high),
   Arlesh-tgf (high, blocked), Arlesh-3kh (medium, blocked by y2l)

## Open questions for the user

- **Local `master` is 13 commits ahead of `origin/master`** and none of them are agent work — they are
  the spec commits from this session plus `progress.md`. Every agent branch is cut from local master,
  so each PR's GitHub diff shows all 13 plus the real change. `git push origin master` fixes every PR
  at once, but master is the shared mainline and pushing it is the user's call, not an agent's.
- **PR #10's migration rewrites four CHECK constraints and can lose data if it is wrong.** The
  agent's first attempt, using `PRAGMA legacy_alter_table` + RENAME, silently destroyed every tag,
  dependency edge and knowledge-base link on a populated board — `legacy_alter_table` has no effect
  while foreign keys are on, and they are on for every connection this app opens. The shipped
  version copies each cascade-parented child table aside, rebuilds the parent, and restores them;
  it was verified against a seeded database with identical row counts, empty `foreign_key_check`,
  `integrity_check ok`, and a schema diff showing only the intended changes. It is still the one
  change in this run that deserves a human reader.
- `.claude/settings.local.json.bak` was committed to master in `0c78a8a`. `.gitignore` covers
  `.claude/settings.local.json` but not the `.bak`. Probably wants removing and ignoring.
- ~~Unexplained cross-worktree writes.~~ **Explained: agents were spawning their own subagents into
  their worktree.** Both the `817` and `n66` agents reported a second writer producing correct,
  in-scope files they had not authored; `n66`'s completion notice then said outright that it
  "stopped with background work of its own still running". Two writers in one worktree is a real
  corruption risk and muddies authorship, so every agent brief now says: **do not spawn subagents,
  one agent per worktree.** (Unrelated but worth knowing: `/home/atai/Projects/CODE/Arlesh` is a
  symlink to `/home/atai/Green/CODE/Arlesh` — one repo, two paths.)

## Open PRs (cap is 8)

| # | Bead | Base |
|---|---|---|
| 3 | Arlesh-9qq — List View Ctrl+O | `worktree-listview-path-headers` (restacking onto #4) |
| 4 | Arlesh-817 — List View path headers | master |
| 5 | Arlesh-a4u — flow move writes to the wrong table | master |
| 6 | Arlesh-6gm — indent subtasks by visible depth | `worktree-listview-path-headers` (stacks on #4) |
| 7 | Arlesh-n66 — Task Backlog | master |
| 8 | Arlesh-je5 — copy-paste duplicates | `worktree-flow-move-fix` (stacks on #5) |
| 9 | Arlesh-zem — delete-dialog focus | master |

| 10 | Arlesh-cyo — Commitments | `worktree-task-backlog` (stacks on #7) |

**8 of 8 — CAP REACHED. The run is stopped.** Nothing further is dispatched until PRs merge.
All eight beads are `in_progress`; none was closed, since each closes on merge.

## Stacking

Branches are stacked rather than all cut from master, so a dependent bead can start before its
dependency merges. Each stacked PR's base is the branch beneath it, so it proposes only its own
commit. **Merge bottom-up**: #4 → #6 and #3; #5 → #8; #7 → the `cyo` PR.
`Arlesh-4yp` (Tabs) is deliberately held back until this stack drains — it converts the singleton
Zustand stores to per-tab instances and would conflict with every open PR at once.

## Corrections from the user

- **Ctrl+O is not a filter at all.** After using it, the user rejected the whole conception:
  Ctrl+O now **enters a subtree**, shown in the TopBar exactly as the Mindmap's is, with
  `Ctrl+Esc` / `Shift+Esc` working as they do there. Three points settled by grilling:
  the subtree state is **shared** with the Mindmap (one `subtreeRootId`, switching views keeps it);
  path headers **trim to the subtree root**, since the ancestors above it are already in the TopBar
  pills; and the Antecedent-pill behaviour is **removed**, along with the `addPill` mode widening,
  leaving a path-header segment click as the only route to that pill.
  Superseded en route: the earlier `any` → `all` (∩) mode correction, now moot.
  Consequence: PR #3 restacked from master onto `worktree-listview-path-headers` (PR #4), because
  `groupRowsByPath` only exists there and the trimming is unimplementable without it.
  Two findings from the rework worth keeping:
  **(a)** Sharing the subtree state did *not* just work. `TopBar` reads the store directly and needed
  no change, but the descriptor it renders was computed inside `MindmapView`, which `App.tsx`
  unmounts whenever the List View is up — so the pills would have been absent. Extracted to
  `src/hooks/use-subtree-nav.ts`, now called by both views.
  **(b)** The header trimming was implemented by scoping the **walk** (`useListData` flattens from
  the subtree node), not by trimming `segments` afterwards. Trimming after the fact would have left
  the removed ancestors counted in `visibleDepth` and over-indented every row; `groupRowsByPath`
  and `flattenTaskRows` stay completely subtree-unaware and the partition holds by construction.

## Testing instances

`scripts/branch-instance.sh` builds and runs one isolated app per branch worktree:

    scripts/branch-instance.sh list
    scripts/branch-instance.sh build [name ...|all]   # default: all, sequentially
    scripts/branch-instance.sh run   <name|all>       # `all` launches every built one at once
    scripts/branch-instance.sh stop  [name ...|all]
    scripts/branch-instance.sh clean [name ...|all]   # drops binaries, keeps each instance's data

`run <name>` execs in the foreground; `run all` detaches each instance with `setsid` so they
outlive the shell that started them, records a pid file, and `stop` reads it back. It refuses to
launch more than four at once with under 6 GB free — each window is a full WebKit process.

Space: every branch compiles into the **one** target directory the main checkout already has
(1.4 G), so the dependency tree is built once and shared; only the per-branch binary is copied out,
because the next build overwrites the shared one. Builds are sequential — cargo locks the target
anyway, and parallel builds put this 15 GB box into swap. The script refuses to start under 5 G free.

Isolation: the app resolves its database from Tauri's `app_data_dir`, i.e.
`$XDG_DATA_HOME/com.atai.arlesh`. Pointing `XDG_DATA_HOME` at a per-instance directory isolates the
database, the webview's localStorage and every persisted Zustand slice at once. Each instance is
seeded with a copy of the real board (~240 KB) on first build and keeps its own state thereafter.

## STOPPED — 8 open PRs

Eight beads shipped: `9qq`, `817`, `a4u`, `6gm`, `n66`, `je5`, `zem`, `cyo`. Every one passed the
full gate. The three Rust beads each reported coverage above the 90% floor (90.83 / 90.96 / 90.79).

**To resume the board, merge bottom-up**, then dispatch from the queue below:
`#4 → #6 and #3` · `#5 → #8` · `#7 → #10` · `#9` is independent.

**Before merging anything**, see the two items under *Open questions for the user* — the unpushed
master, and the migration in PR #10 that wants a second reader.

## New stack: undo/redo (specced, not started)

Three dependent beads, all P2, plus `docs/adr/0006-undo-via-a-trigger-written-row-journal.md` and
the `Gesture` / `Undo Journal` / `Write source` / `Undo Stack` vocabulary in CONTEXT.md.

| Bead | Effort | Depends on |
|---|---|---|
| `Arlesh-npt` — trigger-written row journal, gestures and sources | high | — |
| `Arlesh-h2u` — apply the journal in reverse (undo/redo engine) | medium | `npt` |
| `Arlesh-jga` — Ctrl+Z, gesture boundaries, the undone toast | medium | `h2u` |

Decisions taken in the grilling: everything that **writes** is undoable and no view state is; one
undo step is one **user gesture**, not one command; the stack is **session-scoped**; the before-state
is captured by **SQL triggers**, not by inverse commands or operator instrumentation; the frontend
opens and closes gestures explicitly; **one stack for the whole app**, not per tab; and an MCP write
is journaled but never enters the stack.

Grounding facts behind those: 83 mutating commands of which only 29 are transactional, no SQL
triggers in the schema today, and sqlx's bundled SQLite has no session extension, so changesets —
which would invert natively — are unavailable without vendoring the driver.

The weak seam, acknowledged: the frontend gesture protocol. The user's note — *"should be cleaner
after logic migrating to backend"* — is right, and `Arlesh-32r` / `Arlesh-tgf` make most gestures a
single backend call, at which point the protocol is vestigial. Not a blocker, but a reason to keep
the frontend side small and easy to delete.

## Follow-ups filed from agent reports

- `Arlesh-6dm` (P2, low) — retype's loss prompt drops a Task's Backlog without naming it among the
  losses, where every neighbouring field is enumerated. Left out of `n66` for volume (~30 struct
  literals in `retype.rs`), not difficulty.
- `Arlesh-xbi` (P2, medium) — **no modal in the app traps focus.** Tab escapes into the page behind
  all twelve of them. `Arlesh-zem` wrote `src/hooks/use-focus-trap.ts` and adopted it in the delete
  dialog only, to keep that PR scoped; adopting it elsewhere is close to one line each.
- `Arlesh-lvc` (P2, low) — a Habit whose Instance Type is `commitment` has correct data but draws
  its virtual iterations with task/goal glyphs and completion controls instead of verdict controls.
  `buildIterationItems` never reads the flow's instance type. Rendering gap, not a model one.
- `Arlesh-a18` (P2, medium) — a Flow *underneath* a copied node is not copied and not counted.
  `je5` correctly scoped Flow duplication out, and a directly-selected Flow is skipped with a toast,
  but one hanging below a copied node just vanishes. The dropped `FlowRepository::duplicate_flow`
  (+128 lines) is recoverable from `2620c61` if the richer fix is wanted.

## Housekeeping

- Two empty worktrees exist that no bead claims — `delete-modal-focus` and `type-cycle-filter`,
  both at master's tip with no commits and no changes, 4.5 M each. Probably created by an agent
  before it was handed its own. Remove once no agent is live in them (`git worktree remove`, after
  checking `/proc/*/cwd`).
- `mindmap-duplicate-paste` is the stale branch `Arlesh-je5` was ported *from*. Superseded by
  `duplicate-paste-v2` (PR #8); keep the branch, the worktree can go.

## Standing risks

- **Disk**: 16G free of 299G. `~/.cache/arlesh/tarpaulin` is 17G and is shared by every agent —
  they serialize on cargo's lock rather than each building their own 17G tree. Only agents
  touching Rust run tarpaulin.
- `node_modules` in each worktree is a symlink to the main checkout's. Agents must not run
  `npm install`.
- **CPU**: four concurrent vitest runs put the load average near **70 on 16 cores**. Unbounded
  `npm test` then fails with 5-second timeouts in files unrelated to the change, and the worker
  pool can fail to spawn at all. Every agent from wave 2 on is told to run
  `npm test -- --maxWorkers=4 --testTimeout=30000` and to re-run any failing file in isolation
  before drawing a conclusion from it.
- Freed 5.6G by deleting the **main checkout's** `src-tauri/target` (a gitignored build artifact),
  to give `n66`'s coverage run the headroom it needs. It costs the next local `cargo build` a
  full rebuild. Git's `node_modules/` ignore rule has a trailing slash and so does not match a
  symlink — `node_modules` (no slash) was added to `.git/info/exclude`, which is shared by every
  worktree, so `git add -A` cannot swallow the link.
- **The box has 15 GB of RAM, and that — not its 16 cores — is what caps parallelism.** Four
  concurrent vitest runs took it to zero free and 14 GB of swap (load average 87). Hence the drop to
  two agents, and every agent is now told to run `npx vitest run --maxWorkers=2 --testTimeout=30000
  --hookTimeout=30000`. Do not let a `cargo tarpaulin` run overlap a vitest pool.
- **Master's test baseline is 85 files / 1046 tests.** I briefed several agents with 1055, which was
  wrong — 1055 was `a4u`'s branch total (1046 + 9) that I mistook for the base. Verified with
  `npx vitest list` on master. One derived claim was wrong as a result: `Arlesh-817` is *not*
  net-neutral on test count, it adds 9. Every branch total in this run reconciles against 1046.
- The test suite gives **false timeout failures under memory pressure** — bare `Test timed out`
  in untouched suites, and in one case a worker that never started at all. Measured fix:
  `--maxWorkers=2` took a run from ~200 s with scattered failures to **74 s fully green**.
  Known-good count on master is **85 files / 1046 tests** (measured with `npx vitest list`).
- **`git stash` is shared across every worktree, and it can fail silently.** An agent ran
  `git stash push -u`, got no stash (the ref was never created, `git stash list` empty), and its
  follow-up `git checkout -- <files>` then clobbered four uncommitted test files. It restored them
  and proved the restore faithful (1075 tests before and after), but the rule stands: **commit a WIP
  commit instead of stashing.** Verified afterwards that the stash stack is empty and nothing of
  another session's was disturbed.
- Agents are resumable. If a session dies, send to the agent id rather than re-dispatching: the
  transcript is kept and the worktree holds the uncommitted work.

## Post-run cleanup (after the rate-limit interruption)

The whole fleet died at once to a session rate limit; every agent's work had already been committed
and pushed, so nothing was lost. On resuming, the board was already at the **8-PR cap**, so no new
agent was dispatched. What was left to do was housekeeping:

- **Freed 5.2G.** `/` had fallen to 9.8G (97%). Two worktrees whose PRs were already open still
  carried a `src-tauri/target` — `delete-focus` (2.3G) and `listview-ctrl-o` (2.4G). Both removed;
  back to 15G. The shared tarpaulin cache at `~/.cache/arlesh/tarpaulin` has grown to **20G** and is
  now the single largest reclaimable item on the disk, but deleting it costs the next coverage run a
  full cold rebuild, so it stays until someone decides otherwise.
- **Removed two orphaned worktrees**, `type-cycle-filter` and `delete-modal-focus`, with their
  branches. Both were cut for wave 2 and then superseded: `zem` shipped from `delete-focus`
  (PR #9) on a differently-named branch, and `qf3` never started. Neither held a commit.
- **`Arlesh-qf3` was marked `in_progress` with no work behind it** — its agent was killed during
  its first tool call. Reset to `open` and unclaimed, so `bd ready` tells the truth.

Local `master` is now 3 commits ahead of `origin/master`, not 13 — the mainline was pushed, so the
open PRs' diffs no longer carry the spec commits.
