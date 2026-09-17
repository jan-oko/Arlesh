# Board progress — parallel agent run

Goal: finish the beads task board, or stop at 8 open PRs.
Rules: highest priority / lowest effort first; at most 4 agents in flight; at most 2 `effort:high` at once.

## Gate (every agent runs it before opening a PR)

- `npm run lint` · `npx tsc --noEmit` · `npm test`
- Rust changes only: `CARGO_TARGET_DIR=~/.cache/arlesh/tarpaulin cargo tarpaulin --engine ptrace --skip-clean --fail-under 90 --exclude-files 'src/commands/*'`
- Then `rm -rf src-tauri/target` in the worktree (disk is at 95%).

## Waves

### Wave 1 — dispatched 2026-09-17

| Bead | P | Effort | Worktree | Status |
|---|---|---|---|---|
| Arlesh-a4u — Moving a Flow reparents an unrelated Domain | P1 | low | `flow-move-fix` | resumed — edits in tree, uncommitted |
| Arlesh-9qq — List View Ctrl+O | P1 | low | `listview-ctrl-o` | **PR #3** |
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
| Arlesh-6gm — indent subtasks by visible depth | P1 | low | `listview-indent` | dispatched, **stacked on `worktree-listview-path-headers`** (PR base is that branch, not master) |

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

1. Arlesh-je5 — copy-paste duplicate (P1, high) — **already implemented** on the stale
   `worktree-mindmap-duplicate-paste` branch (commit 2620c61, branched before master).
   Needs a rebase onto master + re-gate, not a fresh implementation.
2. Arlesh-cyo — Commitments (P1, high)
3. Arlesh-4yp — Tabs (P1, high)
4. Arlesh-qf3 (P2 low), Arlesh-zem (P2 low), Arlesh-bwc (P2 medium),
   Arlesh-qcb (P2 medium), Arlesh-p2g (P2 medium, blocked by 817),
   Arlesh-aln (P2 high), Arlesh-fxo (P2 high, blocked by 4yp)
5. P3: Arlesh-ba8 (medium), Arlesh-32r (high), Arlesh-y2l (high),
   Arlesh-tgf (high, blocked), Arlesh-3kh (medium, blocked by y2l)

## Open questions for the user

- **Local `master` is 13 commits ahead of `origin/master`** and none of them are agent work — they are
  the spec commits from this session plus `progress.md`. Every agent branch is cut from local master,
  so each PR's GitHub diff shows all 13 plus the real change. `git push origin master` fixes every PR
  at once, but master is the shared mainline and pushing it is the user's call, not an agent's.
- `.claude/settings.local.json.bak` was committed to master in `0c78a8a`. `.gitignore` covers
  `.claude/settings.local.json` but not the `.bak`. Probably wants removing and ignoring.
- **Unexplained cross-worktree writes.** The Arlesh-817 agent found `ListView.test.tsx`, `SPEC.md`
  and `CHANGELOG.md` appearing in its worktree mid-session, correct and in scope, that it did not
  author. Both candidate sibling agents' own trees are clean and self-consistent. Note that
  `/home/atai/Projects/CODE/Arlesh` is a **symlink to** `/home/atai/Green/CODE/Arlesh` — one repo
  reachable by two paths, which is the kind of thing that makes a tool write somewhere unexpected.
  Not conclusively explained; the content was reviewed before it was committed.

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
- The test suite gives **false timeout failures under load** — 17 bogus `Test timed out in 5000ms`
  across untouched suites at load average 64 on 16 cores. Re-run with
  `npx vitest run --testTimeout=60000 --hookTimeout=60000` and check the passing count matches.
- Agents are resumable. If a session dies, send to the agent id rather than re-dispatching: the
  transcript is kept and the worktree holds the uncommitted work.
