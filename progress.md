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
| Arlesh-a4u — Moving a Flow reparents an unrelated Domain | P1 | low | `flow-move-fix` | dispatched |
| Arlesh-9qq — List View Ctrl+O | P1 | low | `listview-ctrl-o` | dispatched |
| Arlesh-817 — List View path headers | P1 | medium | `listview-path-headers` | dispatched |
| Arlesh-n66 — Task Backlog | P1 | medium | `task-backlog` | dispatched |

### Queue (refill as slots free)

1. Arlesh-je5 — copy-paste duplicate (P1, high) — **already implemented** on the stale
   `worktree-mindmap-duplicate-paste` branch (commit 2620c61, branched before master).
   Needs a rebase onto master + re-gate, not a fresh implementation.
2. Arlesh-6gm — indent subtasks (P1, low) — blocked by Arlesh-817.
3. Arlesh-cyo — Commitments (P1, high)
4. Arlesh-4yp — Tabs (P1, high)
5. Arlesh-qf3 (P2 low), Arlesh-zem (P2 low), Arlesh-bwc (P2 medium),
   Arlesh-qcb (P2 medium), Arlesh-p2g (P2 medium, blocked by 817),
   Arlesh-aln (P2 high), Arlesh-fxo (P2 high, blocked by 4yp)
6. P3: Arlesh-ba8 (medium), Arlesh-32r (high), Arlesh-y2l (high),
   Arlesh-tgf (high, blocked), Arlesh-3kh (medium, blocked by y2l)

## Standing risks

- **Disk**: 16G free of 299G. `~/.cache/arlesh/tarpaulin` is 17G and is shared by every agent —
  they serialize on cargo's lock rather than each building their own 17G tree. Only agents
  touching Rust run tarpaulin.
- `node_modules` in each worktree is a symlink to the main checkout's. Agents must not run
  `npm install`.
