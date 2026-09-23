# Agent briefs

A brief is the only context an agent gets. Early briefs in this repo said what to build
and how to run the gate; late ones also said what was already decided, what to leave alone,
what else was in flight, and who decides the merge. The late ones went wrong far less.

## Template

Fill every section. Delete one only when it truly does not apply, never to save space.

````markdown
Repo: `/home/atai/Green/CODE/Arlesh`. <Either> Create your own git worktree off
`origin/master` (currently `<sha>`). <Or> Your worktree: `<path>` (branch `<branch>`); work only
there. Do NOT work in the main checkout or any other worktree under `.claude/worktrees/` —
<n> other agents are live in them.

## Do not run local builds            <!-- when df -h / is 90%+ -->

The disk is at <n>%. No `cargo build`/`test`/`clippy`, no `vitest`, no full local gate.
Push and let CI be the test: `gh pr checks <n>`, `gh run view <id> --log-failed`.
`npx tsc --noEmit` is the exception — seconds, no artifacts, and it catches the commonest
break. `cargo fmt` writes no artifacts and is fine. If you believe you cannot proceed without
a build, stop and ask me rather than starting one.

## Task

Implement bead **`<id>`** — "<title>" (P<n>). Run `bd show <id>` and read it in full.
Invoke the `solid` skill before writing code. Read `docs/spec/<area>.md` first.
<If it lands in an existing PR:> This goes into PR #<n> on branch `<branch>`. Commit and
push there. Do NOT run `gh pr create`.

## The problem
<What is wrong or missing, in user terms, with file:line pointers you verified.>

## DECIDED: <ruling>
<Every decision already made, quoted from the user where it came from them, and marked
settled so it is not re-litigated. Include rulings the user rejected, and why.>

## To settle while building, and write into `docs/spec/<area>.md`
<Numbered questions the agent must answer and report. Name the traps you know of.>

## Out of scope
<What NOT to touch, and who owns it instead (another bead, another agent's PR).>

## In flight nearby
<Each other branch touching the same files or API: bead, PR, what it changes, and the
resolution rule if they meet ("keep your content, then run `cargo fmt`", "5vp lands first").
Ask the agent to tell you if it changes a shared API's shape.>

## Conventions (read `CLAUDE.md` and every file in `.claude/rules/` first)

- Design decisions go in the `docs/spec/` area file, never `SPEC.md`.
- Changelog: one fragment `changelog.d/<added|changed|fixed|removed>/<NNNN>-<slug>.md`,
  numbered above every number you can see. There is no `CHANGELOG.md` and no assembler.
  Nothing user-visible? No fragment. A fix inside an unshipped feature's PR amends that
  feature's fragment instead of adding a "fixed" one.
- New user-facing strings go through i18n (`translating-ui` skill).
- Rust unit tests in sibling files (`foo.rs` declares `#[cfg(test)] mod tests;`,
  `foo/tests.rs` holds it). No `.unwrap()`/`.expect()` outside tests.
- TypeScript: no `any`, no `as`, `@/` imports, named exports except React components.
- **Migration numbers are assigned centrally** — if you need one, stop and ask.

## Do NOT

- **Do NOT run `bd create`** or change any bead's priority. Report anything worth filing.
- Do not fix unrelated things you notice, and do not widen the task into an audit. Report them.
- Never push to `master`. No time estimates.

## Stop and ask me, rather than guess

A product decision; a spec ruling; two designs that disagree in a merge; a bead that reports
"no way to do X" where X exists (say where it is — do not move UI on a guess); anything
that needs a build or a migration number.

## Merge and CI are yours

Merge `origin/master` in before opening the PR, and again if it goes stale. Resolve
mechanical conflicts yourself. **A clean merge is not evidence** — two green branches often
merge without a conflict and still fail to build; run `npx tsc --noEmit` after every merge,
then push and read CI. **Push after every commit** — a session can die mid-task and unpushed
work is unrecoverable. Open the PR and drive its CI green.

Commit messages and the PR description end with the attribution lines from your system
reminder.

**The PR will not be merged without the user's explicit word**, green or not. Never merge it.

## Report back

- PR number, head commit, and the passing run, verified with `gh pr checks` — not remembered.
- `git log @{u}..` output (must be empty) and `git status` clean.
- Your answers to the questions above, and the route you chose where there were options.
- What the user must look at by hand: anything jsdom or CI cannot show (layout, contrast,
  pagination, drag, feel).
- Anything you noticed but did not fix.
````

### What each section is for

| Section | The failure it prevents |
|---|---|
| DECIDED | An agent re-opening a ruling, or "fixing" toward the rejected design. |
| Out of scope / In flight | Two agents editing one file; a misfiled review item built in the wrong view. |
| Stop and ask | Agents resolving product questions by guessing; chasing a non-existent bug. |
| Merge and CI are yours | Claude doing every master merge by hand; the gate run three times. |
| Never merge it | Agents treating green as done. |
| `@{u}..` in the report | "Merge resolved, PR is MERGEABLE" with nothing committed. |
| Look at by hand | The user reviews for product feel; this tells them where to look. |

## Worked examples

Three real briefs from 2026-09-22/23, verbatim. They predate `strict: false` and the
fragment-only changelog in places — where they say "protection requires a current base" or
mention `npm run changelog`, the template above is current.

- **Example 1** — a feature bead with a hard decision the orchestrator verified against
  master first, two routes named with their traps, and a sibling bead in flight on the same API.
- **Example 2** — a review-only brief: one mechanical property to prove, and an explicit
  demand to say which claim is being made. Note its check (`git diff -w`) was wrong for a
  reflow; the reviewer caught it. That is the "check your check" lesson — keep the shape,
  question the command.
- **Example 3** — a takeover of a user-stopped agent: uncommitted work first, the
  predecessor's transcript as context, the user's ruling quoted exactly, and a misfiled item
  to revert.

### Example 1 — `Arlesh-8xc`, make an editor save one Gesture (feature)

~~~~markdown
Repo: `/home/atai/Green/CODE/Arlesh`. Create your own git worktree off `origin/master` (currently `e77f560`). Do NOT work in the main checkout or any existing worktree under `.claude/worktrees/` — five other agents are live in them.

## Do not run local builds

**Disk hit 100% earlier today and corrupted files mid-write three times**, once truncating a checked-in source file to zero bytes. Five agents are running.

So: **do not run `cargo build`, `cargo test`, `cargo clippy`, `vitest` or a full local gate.** Push your work and **let CI be the test** — `gh pr checks <n>`, `gh run view <id> --log-failed`, iterate until green.

`npx tsc --noEmit` is the one exception: it is seconds, needs no build artifacts, and catches the commonest breakage. Run that before pushing.

If you believe you genuinely cannot proceed without a build, stop and ask me rather than starting one.

## Task

Implement bead **`Arlesh-8xc`** — "Make an editor save one Gesture, so one Ctrl+Z undoes it" (P1). Run `bd show Arlesh-8xc` and read it in full; its design and acceptance sections were written today from the user's decisions and are settled.

Invoke the `solid` skill before writing code, per `.claude/rules/solid.md`. Read `docs/spec/undo.md` before touching anything.

## The problem

Saving an editor issues several independent writes, each its own undo step: `update_task`, `set_block_reasons`, one call per tag change, one per dependency change, plus the staged beads-id clear. Undoing what the user thinks of as one action takes several Ctrl+Z presses, and the count depends on which fields happened to change.

`src/api/gesture.ts`'s `withGesture(name, run)` already groups invokes into one Gesture. The four editor save handlers do not use it. They are in `src/components/MindmapView/use-node-editor.ts`: `onTaskSave` (~:165), `onGoalSave` (~:203), `onCommitmentSave` (~:230), `onProjectSave`.

## DECIDED: a save is all-or-nothing

The user ruled today: if any write in the save fails, **none of them stand**. No half-applied edits.

**This is the hard part, and wrapping the handler does not achieve it.** I verified on master: `src-tauri/src/commands/undo.rs` exposes only `open_gesture`, `close_gesture`, `undo`, `redo` and `undo_status`. **There is no abort.** `withGesture` closes in a `finally`, which *commits* what was written rather than rolling it back — so the naive wrap gives you "one undo step containing a half-save", which is not what was asked for.

Two routes. Read the undo engine and decide, then say which and why:

**(a) A new `abort_gesture` command** that discards the gesture's journal entries. Cleanest semantically. A backend change, and it has to decide what happens to entries already written.

**(b) `close_gesture` then immediately `undo`.** No backend change, reuses what exists — **but it leaves the failed save on the REDO stack**, so the next Ctrl+Y replays a save that was refused. That is almost certainly wrong, so this route also needs the redo stack cleared. Do not assume (b) is free.

## Three more decisions

1. **Gesture name per editor.** `rememberName` feeds `src/utils/gesture-label.ts`. Pick names that read correctly in an undo label, and match the vocabulary the existing Mindmap callers already pass — read those first rather than inventing a second style.
2. **A save that changed nothing must not push an empty undo step.** Check what the backend does with an empty gesture; do not assume.
3. **Nesting.** `openGesture` returning null is already tolerated and logged, which is what makes a nested call safe. Establish whether any editor save can be reached from inside another gesture, and say what you found.

## Report the failure properly

A failed save must say what failed. `Arlesh-zlg` (#59) landed the refusal policy in `docs/spec/mindmap-view.md`: a gesture that cannot act says so out loud, with the backend's own reason appended via `getErrorMessage`. A `console.error` is a note to the developer, not an answer to the user. Note `useMindmapStore.showToast` is a **single slot** — a second call overwrites the first.

## Conventions (read `CLAUDE.md` and every file in `.claude/rules/` first)

- Design decisions go in `docs/spec/undo.md`, never `SPEC.md`. It must record that an editor save is one Gesture **and what happens when one fails**.
- **Never hand-edit `CHANGELOG.md`.** One `changelog.d/fixed/<NNNN>-<slug>.md` fragment, numbered above every number you can see. Do **not** run `npm run changelog`.
- Rust unit tests live in sibling files: `foo.rs` declares `#[cfg(test)] mod tests;`, `foo/tests.rs` holds the body. An inline `mod tests { … }` under `src-tauri/src/` fails CI's coverage gate.
- `.unwrap()`/`.expect()` are banned outside tests.
- TypeScript: no `any`, no `as`, `@/` imports, named exports except React components.
- **Migration numbers are assigned centrally** — if you need one, stop and ask.

Two CI gates are newer than most beads: `cargo fmt --check` and `cargo clippy --locked --all-targets -- -D warnings`, on a toolchain pinned to 1.98.1 by `rust-toolchain.toml` at the repo root. CI will tell you if you trip them.

## Do NOT

- **Do NOT run `bd create`** or change any bead's priority. Report anything worth filing.
- Do not fix unrelated things you notice. Report them.
- Never push to `master`.

## Merge and CI are yours

Merge `origin/master` before opening the PR and keep it merged; protection requires a current base. **Push after every commit** — a session died mid-write today and unpushed work was unrecoverable.

**A clean merge is not evidence.** Nine times today two green branches merged with zero textual conflict and still failed to build. Since you are not building locally, `npx tsc --noEmit` after every merge is your cheap check, and CI is the real one.

Note `Arlesh-ckf` is in flight and adds a write that clears a Task's Backlog flag when it goes in progress, as one Gesture with the status change. Different files, same `withGesture` API — if you change its shape, tell me so I can warn that agent.

Commit messages end with:
```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```
PR description ends with:
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Report: PR number and passing run, which abort route you chose and why, the four gesture names, what you found about empty gestures and nesting, and anything you noticed but did not fix.
~~~~

### Example 2 — review the rustfmt sweep PR #57 (review only)

~~~~markdown
Repo: `/home/atai/Green/CODE/Arlesh`. **This is a review task — read and verify only. Do not change any code, do not push, do not merge, do not comment on the PR.** Report back to me and I will act.

Review **PR #57 — "Adopt rustfmt: sweep the tree, then gate it (Arlesh-vqf)"**, branch `rustfmt-sweep` (head `b1fe4429`). Both required CI lanes are already green; your job is not to re-run CI.

Work in a scratch worktree or use `git fetch` + `git show`/`git diff` from a read-only checkout. Do not disturb the existing worktrees under `.claude/worktrees/` — other agents are live in them.

## What this PR is

Two things, which should be two separate commits:
1. A `cargo fmt` sweep of the Rust tree — mechanical, expected to touch most of the 132 `.rs` files.
2. A `cargo fmt --check` step added to `ci.yml`'s rust lane.

It may also fold the `Install llvm-tools-preview` step into `rust-toolchain.toml`'s `components` list. That was authorised **only if it is genuinely one line and CI stays green**.

## The central question

**A formatting sweep must be provably semantics-free.** Your job is to confirm that property — NOT to read 1110 hunks of whitespace and form an opinion about style. If the property holds, the diff's size is irrelevant. If it does not, that is the finding, however small.

Concretely, verify:

1. **The sweep commit changes nothing but formatting.** The strongest check is mechanical, not visual: for the sweep commit alone, confirm `git diff -w --ignore-blank-lines <parent> <sweep-commit> -- 'src-tauri/**/*.rs'` is **empty**. If it is not empty, every remaining hunk is a real change that must be justified — find them and report each one precisely (file, line, what changed). Be aware `-w` does not hide everything: a moved `?`, a changed method-chain split that alters nothing, and a reordered `use` list all survive it. Reordered imports in particular are a rustfmt behaviour, not a semantic change — judge each surviving hunk on its merits rather than assuming.

2. **The sweep commit is ONLY the sweep.** No `.rs` file outside `src-tauri/`, no test logic, no `ci.yml`, no docs, no `changelog.d/` fragment (nothing user-visible changed, so there should be none). If the CI step is in the same commit as the sweep, say so — that defeats the point of separating them.

3. **The before/after test evidence is real.** The PR body should state `cargo test` results from before and after the sweep and they should be identical. Check the numbers are actually present and actually equal — not just asserted.

4. **No `rustfmt.toml` was added.** The decision was stock rustfmt, deliberately, so that the config is not something anyone has to argue about later. If one exists, that is a finding.

5. **The CI step placement.** `cargo fmt --check` has no toolchain, build or cache prerequisite, so it belongs at the **very top** of the rust lane beside the inline-test-module guard, where it fails in seconds rather than after a six-minute compile. Read the surrounding comments in `ci.yml` — that file argues carefully about step ordering and the new step should match its reasoning and voice. Check it runs with `working-directory: src-tauri`, or explain why it does not need to.

6. **If `llvm-tools-preview` was absorbed into `components`:** this one deserves real scrutiny, because it is coverage tooling riding along in a whitespace PR. Confirm the coverage lane still passed and that `llvm-tools-preview` is genuinely present in the pinned toolchain rather than silently dropped. Note that `rust-toolchain.toml` sits at the **repo root** on purpose — rustup reads it from the cwd upwards, and `rustup component add`, `rustc --version` and rust-cache's `rustc -vV` probe all run at the root. If this change is anything other than trivially safe, say so plainly; I would rather drop it than merge it on a maybe.

## Context you need

- Master is `6184d54`. Protection requires an up-to-date base, so check whether #57 actually carries current master.
- `rust-toolchain.toml` pins 1.98.1 (landed in #55, `bfc69ce`). The sweep must have run under **that** rustfmt, not an older local one — otherwise CI and the sweep disagree and the gate will fail on the next person's machine. Check for evidence of which version produced the diff.
- Four times today, two green branches merged with zero textual conflict and still failed to build, because one widened a type and the other constructed it. A clean merge here proves nothing on its own.
- GitGuardian is stuck `pending` repo-wide and is not a required check. Ignore it.

## Report back

A short verdict first: **merge / do not merge**, and why in one sentence. Then:
- The result of the mechanical whitespace-only check, with the exact command you ran and its output.
- Any surviving non-whitespace hunk, named precisely.
- Whether the commits are separated as intended.
- Your assessment of the CI step placement.
- The `llvm-tools-preview` question, if it applies.
- Anything else you think I should know before merging, and anything you deliberately did not check.

Be direct about uncertainty. If you cannot establish the semantics-free property mechanically, say that rather than substituting a visual skim — "I read a lot of it and it looked like formatting" is not the same claim and I need to know which one you are making.
~~~~

### Example 3 — take over PR #69 from a stopped agent (takeover)

~~~~markdown
You are taking over PR #69 (bead Arlesh-lnm, "Make the Plan View usable") from a previous agent that was stopped mid-work by a session restart. Your worktree: `/home/atai/Green/CODE/Arlesh/.claude/worktrees/lnm-plan-usable` (branch `lnm-plan-usable`). Work only there.

**Your predecessor's full transcript** is at `/home/atai/.claude/projects/-home-atai-Green-CODE-Arlesh/1b129e98-b069-4da0-9240-81ac45506a91/subagents/agent-a61c8608e93700cba.jsonl` (JSONL; the user/orchestrator messages and its own text are the useful parts — extract them with a small python script rather than reading raw). Read it enough to understand the whole round: the original brief, the user's review items, and the corrections. Also read `progress.md` in the worktree and the PR description (`gh pr view 69`).

## Where it stopped

10 files are modified and **uncommitted** — the only copy. **Commit and push them first**, before anything else, even if tests fail (a WIP commit is fine).

Its last words: the scopes-mock fix took `PlanView.test.tsx` from 24 failures down to **2**, both refusal tests; cause found — it namespaced `usePlanMove`'s `t`, so the key-echoing i18n stub now renders `planView:refusedTimeScope` instead of `refusedTimeScope`. It was fixing that and finishing the rule change. Earlier, `npx tsc --noEmit` failed only in `src/utils/plan-triage.test.ts` (lines ~109–130: `partitionForScope` gained a 4th `parent` argument, the tests still pass 3). Verify both yourself.

## The candidates rule, as the user stated it

"Left side shows all relevant, and either unplanned or planned to parent scope. Unplanned can be hidden with the toggle. Since season scopes have no parent, the toggle does nothing for them, and they show all relevant unplanned."

```
candidates = relevant work that is (unplanned) OR (planned to the parent scope)
toggle OFF → both halves; toggle ON → unplanned half hidden, parent-planned only
inert ⟺ the scope being filled has no parent ⟺ it is a Season
```
"Parent" is one rung coarser than the scope being filled. The inert case is **structural, not defensive** — the user explicitly rejected generalising it ("The season exception does not generalize. Seasons are the only top-level scope, which is the whole rationale."). With a parent present and nothing planned into it, an empty pane is a true answer. **Do not update a test to expect an empty candidates pane unless the scope genuinely has nothing** — check each failing case. Write the rationale into `docs/spec/plan-view.md`.

## Also outstanding

- **Revert the root-card work** ("Arlesh" centred root card) — misfiled into this bead; it belongs to the Steps View. The predecessor said it was reverting the root header; verify no `PaneEntry` `"root"` variant or `.rootHeader` remains and that a run hanging off the frame is headed as it was before.
- The one open call with the user — group-by-path being candidates-only — leave as built, mention in report.
- Update the PR description to reflect this round.

## Standing rules (from the user; non-negotiable)

- Never push to `master`. **No local builds** (disk at 94%): `npx tsc --noEmit` and targeted `npx vitest run <file>` are fine; no cargo locally — push and read CI (`gh pr checks 69`).
- Push after every commit.
- You own CI and merging master in (run `npx tsc --noEmit` after every merge — a clean textual merge is not evidence). Escalate only design disagreements.
- **#69 will not be merged without the user's explicit word.** Never merge it.
- No `bd create`, no unrelated fixes (report them instead), no time estimates.
- Changelog: fragments only, `changelog.d/<heading>/<NNNN>-<slug>.md`; no `CHANGELOG.md`, no assembler.
- Read `.claude/rules/` before writing code.
- Final report: commits, PR CI state verified via `gh`, `git log @{u}..` empty, and what the user must look at (things jsdom can't show).
~~~~
