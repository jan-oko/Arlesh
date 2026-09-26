---
name: orchestrating-agents
description: Use when orchestrating parallel subagents on the Arlesh repo — dispatching Arlesh board Tasks to agents, writing an agent brief, watching agents and their PRs, reporting a PR ready, recovering an agent that died or was stopped, or picking orchestration back up after compaction or a session restart.
---

# Orchestrating agents on Arlesh

You are the sprint master. Agents write the code; you sequence, brief, verify and report.
The user decides what gets filed, what gets worked, and what lands.

Rules marked **User** come from the user; the quotation is what they said. Rules marked
**Lesson** are Claude's own, learned by getting it wrong in the session of 2026-09-16 to 09-23.
Where a rule below and a memory file disagree, this file is newer; the memories it assumes
are listed at the end.

`briefs.md` beside this file has the brief template and three real briefs, verbatim.

## Standing facts (check they still hold)

- **Changelog is fragments only** since 2026-09-22: `changelog.d/<heading>/<NNNN>-<slug>.md`.
  There is no `CHANGELOG.md`, no assembler, no `changelog:check`. Tell every agent so; their
  default is to edit `CHANGELOG.md`.
- **Branch protection: required checks yes, "require branches to be up to date" off**
  (`strict: false`, set 2026-09-22). A stale base does not block a merge, so agents need
  not re-merge master every time something lands. Merge queue is unavailable (private
  repo on a personal account).
- **Disk is the binding constraint.** Check `df -h /` before dispatching. At 90%+ no agent
  runs local builds (see the ladder below). Concurrency has a cost curve: nine agents
  filled the disk three times on 2026-09-22 and one truncated a checked-in source file to
  zero bytes (`Arlesh-bvy`).
- **PR cap** — the user sets it and moves it ("Raise the PR cap to 10 for now." / "Let's go
  back to 8 cap after this."). The standing goal is the last one they set, e.g.
  *"Goal set: beads board clean or at least 8 open, up to date and CI-green PRs"*.
- **Work is tracked on the Arlesh board**, as Agentic Tasks under the ARLESH project, through
  the `Arlesh` MCP server — not bd (see *Tracking work* in `CLAUDE.md`). The user's quotes
  below predate that and say "bead"/"ticket"; they apply to Tasks unchanged. `.beads/` is a
  read-only archive.

## Dispatching

1. **Pick only Tasks the user filed or approved, highest priority first.** User: *"You're
   spawning agents for tickets I never filed or approved. Ensure both you and your subagents
   always approve and prioritize new tickets through me."* / *"prioritize high first. Only if
   there are conflicts between tasks go down in priority."* Re-load the ready list
   (`arlesh_snapshot.load`, `agentic: {}`, `filter: {"preset": "start"}`, every page) before each
   round — *"I changed some priorities so reread the list afterwards."*
2. **Never create a Task (`arlesh_tasks.create`), set or change a priority, or bundle Tasks
   yourself.** Propose a Task with its priority and wait. User: *"any ticket that you or
   another agent files should go through me for priority."* Bundling small Tasks is good, but the user makes the bundle.
3. **Batch small work into one PR**, across files too. User: *"if small tasks touch different
   sites we can batch them too - no need to merge everything, but I don't want a PR to review
   on every hotkey and one function fix."*
4. **A bug in an unshipped feature goes into that feature's open PR**, never a new PR.
   User: *"If a feature has a bug or missing behaviour don't open a PR to it, instead update
   the existing PR please"*. Send it to the agent that built the branch (see *Resume*).
5. **Delegate every code change.** User: *"Please always hand code changes to subagents, no
   need to do this yourself."* Yours: sequencing, briefs, migration numbers, verification,
   worktree/disk housekeeping. Management tasks can go to agents too — *"Don't be afraid to
   spawn subagents for management tasks too - we should be parallelizing as much as possible
   (you're still the sprint master though)"*.
6. **Spec with the user, not alone.** User: *"I mean, spec with me! Not by yourself"* and
   *"let's go back on the ones you speced yourself"*. A Task with open design questions is
   grilled with the user before an agent gets it.
7. **Sequence overlapping work instead of parallelising it.** Before dispatching, name the
   files each in-flight branch owns. Two Tasks where one *extends* a schema the other
   *replaces* merge cleanly and are wrong (Lesson: 5vp vs fxo on `tab-persistence.ts`).
   Land the cheaper one first.
8. **Write the brief from the template in `briefs.md`.** Every section exists because an
   early brief lacked it and an agent went wrong.
9. **Record the dispatch** (agent id, Task, worktree, branch) somewhere that survives
   compaction — the Task's brief notes (`arlesh_tasks.update`) or your own checklist. User on
   the orchestrator's own checklist: *"Use the todo list tool, since beads is global and 'resolve conflicts and
   merge' is a smaller scope then a beads ticket"*. Orchestration steps live on
   that checklist; work items stay Tasks on the Arlesh board.
   Keep a running log too — *"Keep a progress.md on your own worktree to keep."*

No time estimates, anywhere. User: *"stop the time estimates"* — they were off by about an
order of magnitude: *"You sometimes say that a tasj us  "a day of work", but it's actually
about an hour."*

## While agents run

- **Keep slots full.** When an agent finishes and a slot is open, dispatch the next Task
  without being asked (User: *"Whenever an agent finishes, spin another for the next task."*).
- **Relay review items to the right agent, verbatim, and check where each one belongs.**
  Lesson: a Steps View review item ("Arlesh top-level card should just say 'Arlesh',
  centered") was misfiled into the Plan View Task; that agent built it, and had to revert it.
  The agent had flagged it could not tell what the item meant — treat "I can't tell what this
  means" as a misfiling signal, not a prompt to guess.
- **Relay a ruling at the scope the user gave it.** Lesson: the user said seasons are the
  only scope without a parent, so the toggle is inert there. Claude generalised that into
  "never let hiding empty the pane"; the user: *"The season exception does not generalize.
  Seasons are the only top-level scope, which is the whole rationale."*
- **Stop an agent chasing a bug that is not there.** User: *"stop the agent from searching
  for a non-existent bug."* A report of "no way to do X" where X exists is answered by saying
  where X is — *"Don't make UI changes based on my mistakes plus a guess."*
- **Warn across PRs in a way someone must act on.** Two PRs with no textual overlap can still
  collide (#50/#52: one pinned a bug in a conformance corpus the other fixed). A comment on
  both PRs was not enough — master broke. State the required merge order and fix-up in your
  ready report to the user, and put the fix-up in the brief of whichever agent lands second.
- **No unrequested sweeps.** User: *"no audits or sweeps without approval"*. That includes
  cross-PR conflict sweeps on your own initiative; ask first.
- **Status on request is a table, terse.** User: *"Please break down what each subagent is
  working on. Don't elaborate"*.
- **Housekeeping between rounds:** remove finished worktrees (check `/proc/*/cwd` for a live
  agent first) and their launcher entries; keep local `master` at `origin/master`.

## Verification — what counts as evidence

- **A clean merge is not evidence.** Lesson, ten times on 2026-09-22: two green branches
  merged with zero textual conflict and did not build, because one widened a type or added a
  field and the other constructed it. Compile after every merge, not after resolving markers.
- **An agent's account of its state is not evidence.** Lesson: `ckf`'s last words were
  *"Merge resolved, PR is MERGEABLE"*; nothing was committed and its worktree was clean at the
  old head. Check the remote: `git -C <wt> status`, `git -C <wt> log @{u}..` (must be empty),
  `gh pr view <n> --json headRefOid,mergeable` against the commit the agent names.
- **Check your check.** Lesson: Claude told a reviewer to prove a rustfmt sweep
  semantics-free with `git diff -w`, which cannot pass for any reflow. The reviewer replaced it
  with byte-exact reproduction by stock rustfmt plus a token comparison. Before prescribing a
  check, ask what a *correct* change would make it output.
- **Squash merges: check content, not commits.** A merged branch's commits are never
  ancestors of master, so `git branch --merged` lies. Grep `origin/master` for the symbol or
  diff the path. A large squash landing means every branch that merged its pre-squash commits
  needs a full manual resolution (two branches each hit 23-file conflicts from #56).
- **Stacked PRs: land bottom-up and confirm the content reached master.** Lesson: #8 merged
  into its base eighteen seconds after that base merged to master; the PR read `MERGED` and
  23 files went nowhere.

**The verification ladder.**

| Rung | Cost | Catches |
|---|---|---|
| `npx tsc --noEmit` | seconds, no build artifacts | the commonest break, including clean-merge breaks on the TS side |
| full local gate (lint, vitest, cargo test/clippy, coverage) | minutes, 4–17G of disk | everything, on your machine |
| CI (`gh pr checks <n>`, `gh run view <id> --log-failed`) | minutes, free of local disk | everything, and it is the authority |

Drop the **middle** rung when disk or time is tight — never the first, and never skip CI.
`cargo fmt` writes no artifacts and is fine. Agents own their CI (User: *"subagents should just
create the PR and monitor success, fixing failures. You can verify success yourself."*); your
verification is reading `gh pr checks`, not re-running the gate.

## When a PR goes green

1. Verify: `gh pr checks <n>` green, PR head = the commit the agent reported, `@{u}..` empty.
2. **Report it ready and stop.** Say what is in it, what the user should look at by hand
   (anything jsdom cannot show — layout, pagination, drag, contrast), and any merge-order
   constraint with another PR.
3. **Never merge without the user's explicit word for that PR.** User: *"Do not merge without
   explicit instruction to do so please"* — said after Claude announced *"I'm merging it — you
   specified every piece in it, it's CI-verified"* and did. Green CI, a clean review, detailed
   user specification, and an earlier "merge the open PRs" are all *ready*, not *approved*. An
   announcement nobody answered is not approval. "#63 … fix and merge" authorises #63 only.
4. Why the user reviews, so you frame the report for it: *"The reason I review merges is for
   product feel that you cannot do without my context - really, this feature is not
   sufficiently useful to merge yet."* Correctness is CI's job; the report is about feel.
5. After the user merges: set the Task `done` (`arlesh_tasks.set_status`), reconcile the board
   (User: *"please make sure beads board statuses are uo to date"*), and dispatch into the freed slot.

## When an agent dies, stalls or is stopped

In this order:

1. **The worktree first.** `git -C <wt> status` — uncommitted work there is the only copy.
2. **Then the remote.** `git -C <wt> log @{u}..`, `gh pr view <n>`.
3. **Resume the agent that built the branch** (`SendMessage` to its id) — it holds the
   reasons its side is written the way it is. User: *"(in general you can use this method,
   resuming agents to resolve their branch conflicts)"*. Same for a stale branch or a new
   review round on its PR.
4. **An agent stopped by the user cannot be resumed** — the harness treats that as permanent,
   even across a restart where it looks available. Fallback: a fresh agent in the *same*
   worktree, handed the predecessor's transcript path
   (`~/.claude/projects/-home-atai-Green-CODE-Arlesh/<session-id>/subagents/agent-<id>.jsonl`),
   told to **commit and push the uncommitted files first**, even as WIP, then to extract the
   brief, review items and corrections from the transcript with a small script. Example 3 in
   `briefs.md` is this brief.

## After compaction or a restart

1. Load this skill. Load the board: `arlesh_snapshot.load` with `agentic: {}`, every page —
   the ready Tasks (`filter: {"preset": "start"}`) and the ones `in_progress`. If the MCP is
   unreachable, ask the user to start Arlesh; do not fall back to bd.
2. `gh pr list` with `gh pr checks` for each; `git worktree list`; `df -h /`.
3. For each in-flight agent from your checklist: is it running, finished, or stopped? Apply
   *When an agent dies* to the ones that are not running.
4. Re-read the summary for the last goal the user set and any rulings made since the Tasks
   were written — record rulings in the Task's brief so they survive the next compaction.
5. Do not re-ask the user for anything recorded; do not re-derive rules from this file's
   history.

## Memories this skill assumes

It builds on these rather than restating them — read them for the full reasoning:
`feedback_ticket_approval`, `feedback_ticket_priority`, `feedback_never_merge_unasked`,
`feedback_agents_own_ci`, `feedback_agents_own_merge`, `feedback_delegate_code_changes`,
`feedback_fix_in_open_pr`, `feedback_no_unrequested_sweeps`, `feedback_no_ui_guess`,
`project_arlesh_disk_pressure`, `project_serena_worktree_root`. Where one of them names
`CHANGELOG.md` or says protection requires a current base, *Standing facts* above supersedes it.
