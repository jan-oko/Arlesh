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
| 10 | Arlesh-cyo — Commitments | `worktree-task-backlog` (stacks on #7) |
| 11 | Arlesh-xbi — trap focus in every modal | master |

~~PR #9 (`Arlesh-zem`, delete-dialog focus)~~ **merged 2026-09-18** as `7395cf9`. The freed slot
went to `Arlesh-xbi`, its own follow-up: `use-focus-trap.ts` landed in #9 adopted by exactly one
modal, and Tab still escapes behind the other eleven. Shipped as **PR #11**, 87 files / 1088 tests,
gate green. Back at **8 of 8 — cap reached.**

Three things the agent found that the bead did not ask for, all verified before being believed:

- The nine editor modals all render through one shared `EditorModal` shell, so the trap went on the
  shell once rather than being pasted nine times. It also caught `NodeSearchModal`, which the
  bead's list missed and which leaked the same way.
- **Escape on the delete dialog did nothing at all.** The listener in `use-keyboard-mindmap` is
  gated `if (isInputActive || !isWarningActive) return`, and the dialog calls `useInputCapture()` —
  so it gated off the listener meant to dismiss it. And `isWarningActive` only ever meant the
  *retype* warning, so Escape over the scope-clamp prompt fell through to `mindmap.deselect` and
  silently deselected nodes behind the overlay. Both dialogs now own their own Escape, which is
  also the only idiom that survives stacking.
- **`use-focus-trap` needed a stack.** `checkScopeClamp` is awaited inside an editor's save, so the
  clamp prompt opens while the editor is still mounted; two live traps fought and the one
  underneath pinned focus to the prompt's first button. Only the topmost container acts now, with a
  test that fails without the guard.

**Merge-order note:** #11 touches `MindmapView.tsx`, which #3, #7, #8 and #10 also touch, and
`TaskEditorModal.tsx`, which #7 and #10 touch. It is cut from master and independent, but it is the
most conflict-prone PR in the set — merge it early rather than last.

Local `master` was rebased onto `origin/master` after the merge; the five orchestration commits
that were ahead are still local and still unpushed.

## Stacking

Branches are stacked rather than all cut from master, so a dependent bead can start before its
dependency merges. Each stacked PR's base is the branch beneath it, so it proposes only its own
commit. **Merge bottom-up**: #4 → #6 and #3; #5 → #8; #7 → the `cyo` PR.
`Arlesh-4yp` (Tabs) is deliberately held back until this stack drains — it converts the singleton
Zustand stores to per-tab instances and would conflict with every open PR at once.

## Corrections from the user

- **The subtree indicator wears no pill and belongs in the middle.** Shipped first as a third
  pill in the left-hand group, sharing the shape of the two exit buttons beside it — which made a
  label look like a control. It is now centred in the bar with no border, background or padding.
  The bar became a three-column grid (`minmax(0, 1fr) auto minmax(0, 1fr)`) so the centre is
  centred on the *bar*, not on the gap the two sides happen to leave. Pushed to PR #3 as
  `12af86b`; full suite green at 86 files / 1088 tests.

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
    scripts/branch-instance.sh start <name|all>       # build, then run — the two steps as one
    scripts/branch-instance.sh stop  [name ...|all]
    scripts/branch-instance.sh clean [name ...|all]   # drops binaries, keeps each instance's data

`run` starts each instance's **own Vite dev server** on its **own port** (from 14200) and waits for
it to answer before launching the window. That is not incidental: a debug Tauri build resolves its
frontend from `devUrl` rather than embedding it, so launching the binary before Vite answers gives
the white *"Could not connect to localhost"* window. Release builds embed the frontend and would
avoid the dev server entirely, but they need a second dependency tree in the release profile —
about 4 G — which is not affordable here. A side benefit: an edit in a worktree hot-reloads into
that worktree's window.

Window titles are `Arlesh — <branch>`, so several open at once are distinguishable. Both the title
and the port are compiled in, so the build edits the worktree's `tauri.conf.json` and restores it on
an `EXIT` trap — the restore therefore survives a failed or interrupted build.

Ports are **assigned once and persisted** per instance, never derived from list position: the port
is compiled into the binary, so deriving it would silently break every built instance the moment a
worktree was added or removed.

Instances detach with `setsid` and outlive the shell that started them; `stop` kills the app and its
Vite server by process group. `run all` refuses more than four at once with under 6 GB free.

`start` is `build` then `run`. It takes `run`'s single `<name|all>` rather than `build`'s list,
because it ends by naming the windows it brought up and the `stop` line for them. It puts the memory
question **before** the builds as well as at launch — refusing nine windows is only useful if it
happens before the nine compiles. A branch that fails to build is named, skipped, and left out of
the launch; the branches that did build still start, and the exit status is non-zero. Each build
runs in a **backgrounded** subshell that is then waited on, never one whose status is tested
directly — bash turns `set -e` off for the whole dynamic extent of any tested context (`if`,
`while`, `until`, `!`, and the left side of `&&`/`||`), so both `if ( build )` and `( build ) || ...`
would carry on past a failed cargo and launch a stale binary. A branch that was already running is stopped before its new binary is launched, so `start`
twice replaces that window instead of putting a second WebKit process on the same SQLite file.

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

## Bugs found while the user tested the instances

### `Arlesh-odd` (P1) — "Habit iterations could not be loaded"

Reported on the `listview-ctrl-o` instance, for `לאכול ארוחות נורמליות` and `Journal`. **Not a
branch bug** — it reproduces on master and on the live board. Diagnosed to a real defect rather
than guessed at:

Reproduced by copying the live DB, deleting the 74 Day scopes nothing references (85 → 11), and
running the binary with `RUST_LOG=warn`:

```
WARN arlesh_lib::mindmap: mindmap load: habit payload failed
  error=scope error: database error: ... (code: 5) database is locked
```

Nine failures in one startup; 80 Day scopes existed afterwards, so most flows won the race and a
few lost it. Three facts combine:

1. **A mindmap load writes.** `habit_slots` mints a Day/Week/Month/Season scope per iteration
   slot. The two failing flows are the only `day`-window Habits with no gap, so they need 78 and
   75 new scopes — `load_mindmap` is a large write wearing a read's clothes.
2. **The DB is in `journal_mode=delete`, not WAL** — verified on the live file and every instance
   copy. `database/session.rs`'s module comment reasons explicitly about "sqlx's default WAL
   journal, where a reader never blocks on a writer". The file does not satisfy that assumption.
3. **`SessionFactory::begin` issues a deferred `BEGIN`.** A read-then-write transaction fails its
   upgrade *immediately* with SQLITE_BUSY and no busy handler can retry it. `database::connect`
   sets no `busy_timeout` either.

It looks transient because a failed load still commits the scopes it managed to mint, so the next
startup writes less and wins — until enough days pass to need a fresh batch.

**What makes the loads concurrent (measured, not assumed).** Counting
`SELECT * FROM domains ORDER BY position ASC` — exactly one per `load_mindmap` — in the same debug
run: six inside 7 ms, then a seventh 240 ms later. `useMindmapData` is an ordinary hook with its
own `useState`/`useEffect` and no shared cache, so **every call site loads the whole board on its
own**. There are three: `MindmapView`, `use-filter-display` (→ `FilterChips`, mounted by `TopBar`,
so always live) and `use-list-data` (→ `ListView`). In Mindmap view two are mounted, and
`main.tsx` wraps the app in `<React.StrictMode>`, which double-invokes effects in a dev build —
hence six. **Production is not exempt:** it is two rather than six, and two is enough.

That adds a third candidate fix worth weighing: deduplicating the load so the board is fetched
once per app rather than once per hook consumer removes the contention at its source, and stops
the app fetching ~240 KB of board two to six times on every startup and after every mutation. It
is a bigger change than WAL + an immediate `BEGIN`, and the two are not alternatives.

**Backlogged to P4** by the user on 2026-09-18. The failure is self-healing and the derivation is
retried on every load, so nothing is permanently lost. `Arlesh-9o1` removes the cause; what does
*not* evaporate with it — `journal_mode=delete` against a session layer that reasons about WAL, a
deferred `BEGIN` for sessions that will write, and no `busy_timeout` — stays worth fixing on its
own terms, so the two are deliberately **not** linked by a dependency.

### `Arlesh-9o1` (P3) — derive Scopes instead of storing them

Filed off the question "why do we need to keep scopes in the DB at all?". All 117 scope rows on the
live board are a pure function of `(kind, start_date)` — `label`, `end_date` and the four
containment ids are all computed — and part-of-day is no exception, its bands being constants in
`scopes/model.rs`. The only kind carrying underivable data is `exact`, of which the board has none.

So the table is a materialised calendar filled in as a side effect of rendering, and that side
effect is what `odd` is made of. The plan: derive the canonical kinds and serve them from a backend
**LRU**, which turns the 15 foreign-key columns that reference scopes into value keys — a
cache-minted id cannot survive a restart, so it cannot be what a persisted column points at. Four
questions are left open in the bead rather than pre-decided, including whether `exact` stays a row
(and therefore whether the table survives at all) and whether the LRU earns its keep next to
arithmetic this cheap.

Wide migration — 15 columns across 7 tables, on top of `0024` — so it follows the `cyo` pattern
for rebuilding a populated board.

## Interim fix pushed to PR #5 (2026-09-18)

At the user's call, the inference ships on #5 now rather than waiting for `Arlesh-xw7`:
`flowTargetFollowsParent` re-points a flow's Target Node at the new parent when it was the old
parent. The comparison is on the **normalised node id** (`entityNodeId`), not on `(type, id)` —
7 of the 17 flows store `parent_type='project'` against `target_type='domain'` for the same
`domains` row, and a type comparison would strand exactly those. Verified the two new
"carries the target" tests fail with the inference disabled and pass with it. Gate green at
85 files / 1059 tests (branch baseline 1055). Pushed as `f5c4a2f`.

The bead now carries a **deletion** clause: when the derived default lands,
`flowTargetFollowsParent` and its call site come out, because a null target will *mean* "my
parent" and two mechanisms for one rule is worse than either.

**Watch at merge time:** PR #8 is stacked on this branch and also edits `use-mindmap-data.ts`
near `moveNode`. The new commit shifts line numbers there; #8 was not rebased, deliberately —
rebasing a 24-file branch is exactly what the stacking exists to avoid.

## Dispatched: segment click enters the subtree (PR #3)

User: *"clicking on a path segment should enter the subtree instead of adding a filter. We can
remove the antecedent filtering logic and UI from the normal filters, as this feature replaces
them."* Agent working in `listview-ctrl-o`, pushing to the existing branch — no new PR, so the
8-PR cap is untouched.

Scoped before dispatch: the Antecedent dimension is self-contained, and **`ancestorRefs` on
`TaskListRow` has no consumer but the antecedent match**, so it goes with it. The brief calls out
the one failure a user would actually feel — a stale `antecedent` pill in `localStorage` surviving
`mergePersistedFilterSlice` and narrowing the list invisibly — and asks for a test on it.

**Landed** as `bf1a85e` on PR #3. Gate green, 86 files / 1093 tests (branch baseline 1088; net +5
after deleting one antecedent test and replacing another with two). `ListView` now passes
`enterSubtree` itself — the same function reference `NodeSearchModal`'s `onSelect` already calls —
so there is one code path, not two, and `useSubtreeNav` publishes the descriptor off an effect so
nothing extra was needed.

**The stale-key hazard was worse than the brief supposed**, and this is the part worth remembering.
`mergePersistedFilterSlice` does `{ ...defaults, ...filter }` — shallow. Its own doc comment says it
exists precisely to stop a slice field rehydrating as `undefined`, but it does not recurse, so a
persisted `pills` map **replaces the default one wholesale**. A retired key is therefore carried
forward and re-persisted indefinitely, and — the real bite — **the next pill dimension anyone adds
rehydrates as `undefined` and crashes `matchesPillGroup`** for every existing user. Fixed with
`withCurrentPillDimensions`, which rebuilds the map from `PILL_DIMENSIONS` alone, typed to take
`Record<string, unknown>` rather than pretending persisted input already conforms.

Its home is `list-filter.ts`, List View's own vocabulary, not the shared `persist-merge.ts`. That
is defensible, but it leaves `useFilterStore` (the Mindmap's) sharing the same shallow merge with
the same latent hazard the moment it gains a nested map. Awaiting the user on whether to bead it.

Also corrected: two other `[Unreleased]` entries advertised Antecedent as shipped ("eight new
filter dimensions" → seven). It never reached a release, so they were made to describe reality
rather than carrying a `Removed` note for something no user ever had. Agent also caught `README.md`,
which my file map missed.

## Reverted: the Backlog switch's move (PR #7, `3a9a9fc`)

User: *"Please move the backlog switch back down. Don't make UI changes based on my mistakes plus a
guess."*

**The failure was mine before it was the agent's.** I wrote `Arlesh-n66.1` as "no way to move a Task
to Backlog from its editor" — stating a missing feature as fact, from a report that only established
the user had looked and not seen it. The agent correctly found the control, correctly diagnosed my
bead as wrong, and then filled the gap with a theory about *why* it was missed, and acted on it. It
should not have; the bead invited it.

`TaskEditorModal.tsx` is byte-identical to `293ff1a` again — diffed, not eyeballed. Suite green at
1093.

**Kept**, because it is independent of the guess: the tests (they assert behaviour, not DOM order,
which is why they survive the revert) and the SPEC entry points, which were a genuine gap — SPEC
documented neither the editor switch nor the Mindmap's bare `B`, only List View's. **Stripped**:
every claim about placement, from SPEC and CHANGELOG.

Written to memory as a standing rule: **a control the user missed is evidence they missed it, not
evidence about where it belongs.** When a bead says a feature is missing and it is not, the finding
*is* the deliverable — report where it actually is and stop. Now in the resume briefs for the
Commitments cluster, since `cyo.2` and `cyo.3` are exactly where the same slip could recur.

## Recovered work confirmed on master

**PR #14 and #17 merged.** Verified on `origin/master`: `src-tauri/src/duplicate/mod.rs` present,
all four `duplicate_*` commands registered, and `0025_flow_target_defaults_to_parent.sql` in place.
The work stranded by #8's merge order is back, and the derived Target Node shipped with it.

## PR #17 — and the biggest find of the run

`Arlesh-xw7` shipped: a null Target Node now *means* "my parent", the eager default is gone from
`convert_to_flow`, `flowTargetFollowsParent` and its `moveNode` call site are deleted, and migration
`0025` nulls the targets that already resolved to their parent. Verified against a copy of the real
board: **15 rows changed, 0 non-null left, all 15 flows resolve to the identical host node before and
after**, `integrity_check` and `foreign_key_check` clean. Two corrections to the bead's own figures —
the board has 15 flows, not 17, and **8** of them (not 7) carry `parent_type: "project"` against
`target_type: "domain"`, which is exactly the set a `(type, id)` comparison would have stranded.

### `Arlesh-atb` — clearing a nullable field over IPC silently does nothing

Found outside the brief, and it is the most consequential thing today. `Option<Option<T>>` is how an
update request spells *absent = unchanged, null = clear* — but **serde collapses an absent key and an
explicit JSON `null` into the same outer `None`**, which every `update_*` reads as "unchanged". You
clear a field, the save reports success, nothing changes.

Verified independently rather than taken on report: **17 such fields across three model files**
(`flows/model.rs` 10, `tasks/model.rs` 6, `infos/model.rs` 1) and **no `deserialize_with`, no
double-option handling anywhere on master** — so serde's default applies to all of them. The exposed
fields include `time_scope`, `plan`, `on_scope_exit`, `delegate_to` and an Info's `details`.

PR #17 fixes it for the flow Target Node only, because clearing the target is the route back to the
derived default and so was in scope. **The other sixteen fields are still broken.** The agent proved
it with a test that failed `left: None, right: Some(None)` before the fix.

It sits at bd's default P2; the agent declined to choose and proposed **P1**. I agree — it is a
silent discard of user intent across the whole editing surface, which is the exact failure the
no-silent-drop rule exists for. **The user's call.**

### Two process notes

The tarpaulin warning paid for itself: the agent's first run reported **74.62%** and failed the
floor, with the shortfall concentrated in files it never touched. Re-run alone: **90.72%**. Because
it had been warned, it did not "fix" coverage that was never broken.

The agent used `dangerouslyDisableSandbox` for two network calls (`git push`, `gh pr create`) after
the sandbox blocked DNS. Everything else ran sandboxed. Flagged for the user rather than buried.

## Conflict sweep against master (2026-09-18)

Test-merged every open PR rather than waiting to find out at merge time. Three had real conflicts:

| PR | Against master | Action |
|---|---|---|
| #12 `type-cycle-filter` | `MindmapView.tsx` | **resolved, pushed** — import collision only: master added `useSubtreeNav`, this branch added `hiddenNodeKinds` to the `filter-tree` import. Both needed. Green at 1168. |
| #7 `task-backlog` | `SPEC.md`, `ListView.tsx`, `use-keyboard-list-view.test.ts` | **queued** — `worktree-backlog-loss-prompt` is stacked on it and mid-gate |
| #10 `commitments` | same three files | **queued** — an agent is working in that worktree now |

#13, #14, #15 and #16 are clean.

**Why #7 and #10 wait**: merging master into a branch an agent is working in, or whose base another
agent is mid-gate against, moves the ground under them. #7 and #10 share the same three conflicts,
which says master's ListView/SPEC changes (the path-header and Ctrl+O work) landed after both
branched — one resolution will inform the other.

## Tabs landed — PR #16, the largest change of the run

58 files, **+2551 / −396**, one commit, 87 → 96 test files and 1144 → 1225 tests. Note the size: the
agent described it as "+485/−396 across 33 changed files plus 20 new ones", which is true of the
*existing* files but understates the whole — the new files carry the rest.

**The persistence migration is the part that could have hurt, and it was done properly.** Verified
directly rather than taken on report: `tab-persistence.ts` reads the three legacy keys
(`arlesh-view`, `arlesh-filter`, `arlesh-list-filter`) and folds them into a single tab, and it
rebuilds rather than spreads — `mergeFilterDefaults` for the flat level, **`withCurrentPillDimensions`
on top** for the nested pill map, which is exactly the second-level hazard that has bitten this repo
twice. 16 rehydration tests, including the two that matter most: a blob written before `archivedMode`
existed, and one still carrying a retired Antecedent pill. Plus corrupt blob, tab with no id, and an
`activeTabId` naming a tab that is gone.

**Two judgement calls beyond the bead**, both correct and both argued in a new ADR 0007:

- The **clipboard** had to leave `use-mindmap-store`, or it would have become per-tab — which would
  defeat copying in one tab and pasting in another, a stated requirement.
- **`pathHeaderIcons`** lived in `use-view-store`, which the bead makes per-tab. Moved to a new
  app-wide `use-display-store` rather than letting a *taste preference* silently reset per tab. The
  branch axis stays per-tab because it is genuinely per-subtree.

**Two follow-ons the conversion forced**, either of which would have shipped as a bug:

- A restored subtree root may name a node that no longer exists — a view rooted at nothing shows
  nothing, with no pill to escape by. Now exits to the true root, but only when the tree is
  *loaded*: an empty tree is what a load in progress looks like.
- `MindmapView` centred on every `subtreeRootId` change, which with per-tab roots fired on every tab
  switch and discarded the pan/zoom that tab was holding. Now centres only for a root change within
  the same tab.

**Ctrl+W** is taken by the app: nothing bound it, no native accelerator is declared, and the capture-
phase dispatcher `preventDefault`s so the webview never sees it. Closing the last tab is refused by
the store and turned into `closeWindow()`.

Flagged for review, not acted on: `src/test/setup.ts` now imports `use-tabs-store`, because the
`getState()` accessors resolve through the active tab, so every suite needs one to exist — that is
why ~12 existing test files needed no edit. And `reloadTabs()` is exported but only tests call it.

## Backlog editor: the control existed, buried (PR #7, `1b4f35f`)

The user's *"found no way to backlog a task from the editor"* was not a stale build and not a
missing feature. **The switch had shipped in the original Backlog commit**, wired and tested — it
just sat sixth, below Title, Status, Time Scope, On-scope-exit and Plan. Verified against
`293ff1a`: `fieldBacklog` at line 195, the scheduling group above it. Someone opening a Task to set
it aside reads the status row, sees To Do / In Progress / Done, and concludes it is not there.

Moved directly under the status pills, and kept a `Switch` rather than becoming a fourth pill —
SPEC is explicit that Backlog is a separate axis from status, so a backlogged Task that was In
Progress still says so. A pill in that row would claim otherwise.

**The Goal-editor worry was unfounded and is now pinned.** The status control is not shared:
`TaskEditorModal` and `GoalEditorModal` each map their own list over shared CSS. Two new tests
assert the Goal editor offers no Backlog control and saves no `archival` field.

**The entry points agree on meaning and differ on ceremony, deliberately.** Backlogging a *planned*
Task is refused by the backend (`TaskError::BacklogWithPlan`). The hotkey paths answer with a
confirm modal because there is no preview; the editor never lets the refusal happen, clearing the
Plan field in front of you. Same write, same invariant, different affordance. Left as is — it reads
as correct rather than as drift.

## `Arlesh-6dm`: finished but never shipped

Its agent committed `9aa2175`, left a clean worktree — and then completed without pushing, without
opening a PR, and without delivering a report. The bead was still `in_progress`. Nothing was lost;
the failure was in the hand-off, not the work.

Resumed rather than redone, with the three things it still owed: merge the base (which had moved
under it via `1b4f35f`), re-run the gate on the merged result, push and open the PR. **Worth
remembering as a failure mode**: a `completed` agent with no report is not the same as a finished
task, and the branch state is the thing to check, not the status.

## PR #15 — `start`, and a bash trap worth remembering

`scripts/branch-instance.sh start <name|all>` = build then run. Two findings from it are worth more
than the feature:

**A tested context would have silently broken the harness.** Bash switches `set -e` **off for the
entire dynamic extent of any command whose status is tested** — `if`, `while`, `until`, `!`, and the
left-hand side of `&&` / `||` — subshells and the functions they call included, and an explicit
`set -e` inside does not restore it. The agent reported this as specific to `if`; I reproduced it
and it is not:

```
A) ( inner ) && echo ok || echo failed   →  inner ran past `false`, subshell "succeeded"
B) if ( inner ); then … fi               →  same
C) ( inner ) & if wait "$!"; then … fi    →  inner stopped at `false`, status propagated
```

The general form is the one to remember, because `cmd_x && …` is the shape someone is far more
likely to write by accident than `if ( … )`. Audited the rest of the script: only line 57,
`[ "$free" -ge "$MIN_FREE_GB" ] ||`, has the shape, and it is a plain test with no function behind
it — not exposed. The first version wrapped each build in
`if ( trap restore_conf EXIT; build_one "$name" )`; with a stubbed failing cargo it sailed past the
failure, past a failed `cp`, printed "ready" and launched a **stale binary**. The build is now a
backgrounded subshell that is waited on (`( … ) & if wait "$!"`), which keeps errexit and still
reports status. Found by testing the failure path, not by reading.

**`start` twice on one branch** would have been `Text file busy` on the copy, and a second launch
would have put two WebKit processes on one SQLite file. `build_one` now writes `arlesh.new` and
`mv -f`s it in (the running process keeps its old inode), and `start` stops a running instance
before relaunching, reusing Vite.

Memory guard asked **twice** — once before building, so a refused `start all` is refused before nine
compiles rather than after them, and again at launch, which is authoritative because a long build
changes what is free. Partial build failure: build what can build, start what built, name what
failed, exit non-zero.

Pre-existing bug found and left alone, filed as **`Arlesh-63c`**: `stop` sometimes leaves Vite
running. It records `$!` of a backgrounded `setsid npm run dev`, but `setsid` forks a new session
leader when its caller is already a process-group leader, so the recorded pid can be a wrapper that
has already exited — `kill -- -PID` then hits nothing while `stop` still reports success.

Beads `Arlesh-rtu` and `Arlesh-63c` both landed at bd's default P2; the agent correctly declined to
choose. **Both need the user's priority call** (it proposed P3 for `rtu`).

## Disk, second round: the same mistake, mine

Back to 99%. **Two active worktrees had regrown private target dirs** — 3.4 GB and 3.9 GB — because
their briefs set `CARGO_TARGET_DIR` for tarpaulin but not for `cargo test`. That is the same leak as
this morning and the same omission, in briefs I wrote after diagnosing it.

Reclaimed the main checkout's idle `src-tauri/target` (5.2 GB) instead, since no build was running
against it and it rebuilds on demand: **3.6 GB → 8.8 GB free.** Messaged both running agents to
prefix `CARGO_TARGET_DIR` on remaining Rust commands and to remove their private target *after*
their gate passes — not before, which would force a rebuild mid-gate.

## Fixes dispatched into their parent PRs (2026-09-18)

Both dispatched to work **on the existing branch**, not on a stack above it — extending the user's
ruling for `evu` to the whole set. Commitments and Backlog have never shipped, so five trailing
"fixed" entries for features no user has seen would be fiction; each feature arrives complete
instead.

- **PR #10 (`worktree-commitments`)** — one agent taking `cyo.3` → `cyo.2` → `cyo.4` → `cyo.1` →
  `evu`, in that order: the editor tells you what cyo.1 and evu must fit into, and the base glyph
  must precede its resolution variants.
- **PR #7 (`worktree-task-backlog`)** — `n66.1`, the editor route into Backlog. Brief asks for an
  inventory of the *existing* entry points too, since three that disagree about when Backlog clears
  would matter more than a missing fourth.

**Six agents now running.** Past the two-agent ceiling this run established, at the user's call. The
mitigation is that resumption from transcripts has worked twice today, so a rate limit costs time
rather than work.

**Two re-merges I owe, and told both agents not to touch:** PR #13 is stacked on #10, and
`worktree-backlog-loss-prompt` is stacked on #7. Both bases are about to move.

## User-reported fixes, beaded (2026-09-18)

From a testing pass. Five beads, all children of the feature they belong to so they merge with it
rather than trailing behind:

- **`Arlesh-n66.1`** (P2) — no way to move a Task to Backlog from its editor. A state you can enter
  but cannot find is close to one that does not exist.
- **`Arlesh-cyo.1`** (P2) — a Commitment with no scope drops out of the type cycle. The rule is real
  (`CONTEXT.md`: there is no Unscoped Commitment) but silently removing the option makes it read as
  a missing feature. Should offer it and resolve the scope on commit — prompt or cancel.
- **`Arlesh-cyo.2`** (P2) — the Commitment glyph reads as a Task. Must stay legible at the three
  sizes it is actually drawn at: mindmap node, List View row (`ICON_R = 10`), path header (7).
- **`Arlesh-cyo.3`** (P2) — a Commitment has no editor. Note for whoever takes it:
  `worktree-commitments` already carries `CommitmentEditorModal.tsx` and `VerdictWindowField.tsx`,
  so **check whether this is a wiring gap before writing a component.**
- **`Arlesh-cyo.4`** (P3) — kept / broken / live / past-window all draw the same glyph. Depends on
  cyo.2; build on the new base glyph, not the old.

Per the user, **`Arlesh-evu` goes under the existing commitments PR (#10)** rather than becoming its
own. Consequence to handle: PR #13 is stacked on #10, so #10's branch moving means #13 needs its
base merged in afterwards.

`Arlesh-xbi` re-closed — the PR #11 closure was deliberate. User: *"low priority for review and it
clutters against more interesting features. Will reopen later."* Deferred, not abandoned; the bead
records how to revive it without re-implementing.

## Disk: 99% → 98%, and the leak that caused it

The instances were never the problem (33 MB all told). **Four worktrees had grown their own
`src-tauri/target`** — 3.4G, 3.3G, 1.5G, 1.1G — because agents ran `cargo test` from their worktree
without `CARGO_TARGET_DIR`, so only tarpaulin used the shared warm tree. Removed the two whose
agents had finished: **2.9 GB free → 7.4 GB**. Also removed seven merged worktrees.

**The fix is in the briefs**: agent instructions now say to run Rust from `src-tauri/` *and* point
`CARGO_TARGET_DIR` at the shared tree for `cargo test`, not just for tarpaulin.

## PR #14 — the #8 recovery, and a coverage lesson

Opened as **PR #14**. Gate: lint clean, tsc clean, vitest 86/1075, `cargo test --lib` 232,
`tests/duplicate.rs` 9, **tarpaulin 90.96%** — the exact figure #8's own branch reported, which is
what a byte-identical commit onto an unchanged-Rust master should give.

**Coverage lesson worth keeping.** The first run reported **83.17%** and failed the 90% floor. It
was not a regression: two `cargo tarpaulin` runs were sharing `$HOME/.cache/arlesh/tarpaulin` at the
same time — mine and an agent's — and **concurrent runs against one warm target dir produce garbage
numbers in both**. Re-running alone on a quiet box gave 90.96%. Had I believed the first number I
would have "fixed" coverage that was never broken. Every agent brief now carries this, along with
`pgrep -x cargo-tarpaulin` (never `-f`, which matches its own command line and hangs forever).

## Rate limit, second time

All three agents died at once on the session limit — `xw7` at "All tests green. Now the coverage
gate", `lvc` mid-gate, `4yp` mid-tests. Same recovery as before: **resumed from transcripts, not
re-dispatched.** `lvc` reported it redid nothing and finished as **PR #13**.

`lvc` also corrected its own brief: the bead is not frontend-only — its second acceptance criterion
is a refusal at `flows::start`, i.e. Rust. Its Rust diff is one integration test, no `src/` change.
It found the write genuinely broken, not just the glyph: `useCommitmentVerdict` parsed a commitment
id out of the node id, which for `habit-3-0-virtual` is `NaN`. Two follow-up beads, `Arlesh-evu` and
`Arlesh-mrq`, both **awaiting the user's priority call** (the agent proposed P2 and P3).

## Two stranded PRs — the stacked-merge hazard, twice (2026-09-18)

The cap was never the risk. **Merge order was.**

### PR #8 — merged into a branch that had just been absorbed

```
PR #5  merged 09:30:04  →  master
PR #8  merged 09:30:22  →  worktree-flow-move-fix
```

Eighteen seconds, wrong order. #8's base went to master first, so #8 merged into a branch nothing
pointed at any more. Its PR reads `MERGED` and the work went nowhere. Verified on `origin/master`:
`src-tauri/src/duplicate/` absent, all four `duplicate_*` commands absent from `lib.rs`.

**Recovery:** `49fa540` turned out to be a clean single-parent squash holding exactly #8's 23 files,
so it cherry-picked onto master as itself — no re-showing of #5's already-squashed content. Branch
`worktree-copy-paste-duplicate`. Gate: lint clean, tsc clean, vitest 86/1075, `cargo test --lib`
232 passed, `tests/duplicate.rs` 9 passed. Coverage running.

### PR #11 — closed, not merged

`gh pr view 11` → `merged: null`, closed 09:49:22. Only `DeleteConfirmModal` adopts
`use-focus-trap` on master, which is PR #9's single adoption — so Tab still escapes behind eleven
modals, and neither Escape fix landed. Bead `Arlesh-xbi` **reopened**, since the board should
reflect master rather than the existence of a PR. Branch `worktree-modal-focus-trap` still holds
`c75019a`, gate-green when written. **Awaiting the user on whether the closure was deliberate.**

### The rule this run learned

**Merge the child into the parent first, then the parent to master.** #3 → #4 → master worked
exactly that way and all three landed clean; #6 → #4 → master likewise. #8 is the counterexample.

## Conflicts resolved after master moved

All three were the same shape — two branches each adding a first bullet to the same CHANGELOG
section, neither claiming the other's slot:

- **#4**: one file. Gate green 87/1120.
- **#6**: two files, and the second was real — the indentation fixtures passed `ancestorRefs`, a
  `TaskListRow` field deleted when the Antecedent dimension went, since that filter was its only
  consumer. The fixtures assert on `ancestors` anyway. Gate green 87/1131.
- **#12**: one file. Gate green 86/1102.

## Session restart

The Claude Code process exited mid-run, stopping the `xw7` and `lvc` agents with 15 and 17
uncommitted files respectively. **Resumed from their transcripts rather than re-dispatched**, with
instructions to `git status`/`git diff` first and not redo what was already there — the same
recovery that worked when four agents were killed earlier in the run.

`Arlesh-4yp` (Tabs, P1, high) dispatched at last: it was held all run because it converts singleton
Zustand stores to per-tab state and would have conflicted with every open PR. With the board down to
three, its moment arrived. The brief points it at the persist hazard specifically — turning flat
per-app state into a nested per-tab structure is exactly the operation that walks into the shallow
merge that has already bitten this repo twice.

Holding at three agents rather than four while tarpaulin runs: four concurrent vitest runs on 15 GB
is the configuration that took the whole fleet down earlier.

## Flow copying, beaded in two (2026-09-18)

The "couldn't be pasted here" toast turned out to be two separate things wearing one string.

**`Arlesh-p74`** (P3, quick fix) — the message. `onPaste` refuses for three unrelated reasons
(invalid drop target, virtual node, Flow) and says the same sentence for all of them, one that
blames the *destination*. Cost a real session checking whether PSYCHE was a legal parent; it was.
Fix groups the skipped nodes by reason, keeps the no-silent-drop rule, and points at cut.

**`Arlesh-nrb`** (P2, feature) — actually copying Flows. Grilled to two decisions:

- **A copied Habit is a Habit.** Full Recurrence, original Start anchor and all. The user chose this
  against re-anchoring to today, in their words: *"Copy flows are usually copy then modify, so I'm
  fine with clutter until the node settles."* **The back-filled iterations are an accepted
  consequence, not an oversight** — the bead says so explicitly, so nobody later "fixes" it.
- **Flow items copy within their own template only.** A Cycle Scope is an offset into the flow
  window; inside the same template that offset still means what it meant, and into a different flow
  it would need the anchor resolution `start` already solves once. Not worth solving twice.

Not copied: completion Modifications (history belongs to the original) and started `flow_instances`
(real Goals/Tasks already materialised elsewhere).

The technical trap is recorded: **`fork_flow` is the right shape and the wrong policy.** It already
deep-clones a template, but deliberately drops the Recurrence and Modifications because it serves
the habit editor's archive-&-new path. Reuse the cloning, not the omission, and leave archive-&-new
behaving exactly as it does.

`Arlesh-a18` (Flows beneath a copied node) now depends on `nrb` — same missing `duplicate_flow`
seen from the other side, and it should be wiring rather than a second implementation.

## Dispatched into the freed slot: `Arlesh-qf3`

PR #3 merged — into `worktree-listview-path-headers` rather than master, so the stack collapsed
*upward*: #4's branch now carries both, and #6 is still stacked beneath it. Seven open, so one slot,
taken by `Arlesh-qf3` (P2, effort:low — type cycling offers kinds the filter hides, so the node
converts and vanishes). Cut from master, worktree `type-cycle-filter`.

The brief pushes on the part that is actually hard rather than the symptom: *which* filters should
suppress a cycle target. A kind hidden outright for every node is not the same as a kind hidden
because this particular node would fail a status test, and the two views may not even agree
(`useFilterStore` vs `useListFilterStore`). Flagged that PR #10 likely touches `node-meta.ts` too.

## PR #8 pulled the inference in — and what the Journal move actually showed

User: *"Should the flow target inference be in duplicate-paste-v2 branch? Tried to move Journal flow
from REFLECT to PSYCHE node, but the instance didn't move with it."*

**Yes, and it wasn't.** `worktree-duplicate-paste-v2` sat on `e4aa88c`, the commit before the
inference. Merged `worktree-flow-move-fix` in as `8df6ad9` — **clean auto-merge, no conflict**,
which retires the merge-order hazard flagged earlier: the two `moveNode` edits do not collide. Gate
green at 85 files / 1069 tests.

**But that is not what the user saw.** In that instance's database Journal (flow 10) is still
`parent_id = 9` (REFLECT) with `target_id = 9`, and no flow anywhere has PSYCHE (109) as a parent.
**The move never happened at all** — nothing to do with the target lagging behind.

The mechanism is #8's own, in `use-node-actions.ts`:

```ts
if (isCopy && (node.kind === "flow" || node.kind === "flow_goal" || node.kind === "flow_task")) return false;
```

A **copy**+paste of a Flow is deliberately refused, because `je5` scoped Flow duplication out. It
raises `pasteSkipped` — *"1 node couldn't be pasted here"* — and moves nothing. **Cut**+paste and
drag still move it. So a `Ctrl+C` would produce exactly the observed state.

Worth its own bead if the user wants one: that toast reads as a *placement* problem ("couldn't be
pasted **here**") when the real reason is that Flows have no duplicate. Two different messages, one
string.

## Path headers carry their parent's kind glyph (PR #3, `28c279a`)

User: *"add an icon for the parent node type in the path headers"* — then, on seeing the first
attempt, *"Not to each segment - to the whole header item."* I had read it as one glyph per
segment; it is one glyph per header, for the **nearest** ancestor, the node the rows below hang
directly from. Reverted and redone rather than patched over.

Reuses `NodeIcon` — the same component the Mindmap's `NodeRect` and List View's own `TaskRow`
already render — so there is one glyph vocabulary across all three rather than a fourth set of
icons. `currentColor` plus `color: var(--text-primary)` on the wrapper gives it the emphasis the
last segment already carries.

An Aspect has no glyph anywhere in the app (`NodeIcon` returns `null` for one), so a header that
ends at an Aspect opens with nothing rather than reserving an empty box. Tested both ways.

Gate green: 86 files / 1095 tests.

**Then made switchable from the gear** (`1b7deb2`), on the user's follow-up. `pathHeaderIcons`
lives in `useViewStore` beside `mindmapOrientation` — that store's domain is *how the app is
displayed*, and the glyph toggle is the List View's exact counterpart to the Mindmap's branch axis,
gated to its own view the same way. Default on; the switch turns it off.

The persist question was the real one, since **adding a field to a persisted store is precisely the
operation that trips the bug this branch just fixed**. It does not apply here, and the reasoning is
now in the store's doc comment: `useViewStore` passes only `{ name: "arlesh-view" }` — no custom
`merge`, no `partialize` — so zustand's default top-level spread operates at exactly the level its
fields live at, and an older blob simply lacks the key and keeps the default. The filter stores need
`mergePersistedFilterSlice` because they partialize to a nested `{ filter: … }` that the same spread
replaces wholesale. Verified rather than assumed, with a test that rehydrates a real pre-toggle blob
and asserts the other two fields *did* apply, so it cannot pass vacuously.

Also caught: **`28c279a` never put the glyph in `SPEC.md`** — it touched only the component, tests
and CHANGELOG. SPEC is the authoritative document per CLAUDE.md, so that was my omission; it now
carries the single-glyph rule, the Aspect exception and the toggle.

86 files / 1101 tests.

## Follow-up from testing PR #5 — `Arlesh-xw7` (P2)

"Instances don't seem to move with it." Instances render under the **Target Node**, not under the
Flow, and `moveNode` sets `parent_*` while leaving `target_*` alone. #5 is not the cause — before
it a move wrote to the `domains` table and the flow never moved at all, so this is simply the next
thing visible once moving works.

Grilled to the real question. The default target is **snapshotted at create** rather than derived:
`convert_to_flow` says so in its own comment, and all 17 flows on the board carry a non-null target
equal to their own parent. So the two fields drift the moment a flow moves, and nothing can
distinguish a target that is the parent *by default* from one deliberately pointed at it.

Settled: **null means "my parent", derived at read time.** A move then carries the instances by
construction, with no inference in the move path; an explicit target is deliberate by definition
and stays. A migration nulls the targets that already equal their parent — the same inference, made
**once**, where it can be inspected, rather than on every move forever.

One wrinkle recorded in the bead: null is already taken. `injectHabitInstances` falls back to the
flow node when the target is null, so null currently means "render under the Flow". Nothing on the
board is in that state; the fallback is demoted to the parent-not-in-tree case.

Out of scope and stated so: the one started flow instance (7 real nodes) is ordinary Goals/Tasks
and must never be dragged by moving a template.

**Noticed alongside, not filed:** 7 flows carry `parent_type='project'` against a `domains` row
whose `subtype` is `domain`. Flows reference nodes by `(type, id)` and domains/projects/tags share
one table, so **retyping a node leaves every flow referencing it with a stale type label**.
Rendering tolerates it — `FlowEditorModal` normalises the domain-table type back to `domain-<id>`
for exactly this reason — but it is real. Awaiting the user on whether to bead it.

## Follow-ups from PR #11

- **`Arlesh-l25`** (P2) — editor dialogs take no focus when they open, so their new Escape handler
  has nothing to fire from until you Tab or click in. Pre-existing and identical in both views, so
  it is not the cross-view inconsistency `xbi` was about, but it is the one place the SPEC contract
  #11 wrote down is not yet true.
- **`Arlesh-ru8`** (P3) — `NodeSearchModal.tsx` line 41 uses a **literal NUL byte** as a `join()`
  separator (`n.path.slice(0, k).join("\0")`). Confirmed on master with `cat -v`. Git prints
  `Bin 4944 -> 5065 bytes` instead of a diff and the file is invisible to `grep`.

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

## Standing rules

- **Priorities are the user's.** Any bead Claude or a dispatched agent files goes to the user for
  its priority. File it with the full description and evidence, then name it with a *proposed*
  priority and adjust on their answer. Agent briefs that end with "file beads for any follow-up you
  left out" must say the same. Set 2026-09-18, after `Arlesh-odd` was filed P1 unilaterally.

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
