# Commitment is its own node kind, not a flag on Task

Arlesh needed to represent things that are *kept* rather than *done* — "asleep by 23:00",
"no social media today". The obvious cheap move is a boolean on Task. We added a fifth
content node kind instead, because a Commitment's resolution runs the opposite way to a
Task's: a Task untouched when its window closes is **Missed**, whereas a Commitment
untouched may well have been **Kept**. A flag cannot express that inversion without
making every Task code path ask whether this Task is really a Task.

## Status

accepted

## Context

`Resolution` (`src-tauri/src/tasks/lifecycle.rs`) derives Completed / Missed / Overdue
from a node's `status` plus its window position. The derivation is monotonic in one
direction: absence of progress means failure. That is correct for work and wrong for a
rule you hold to, where absence of an act is frequently the success case.

The Goal kind is no better a home. A Goal can be Achieved, Frozen or Archived, but it has
no vocabulary for having been *broken* — and "I failed to keep this" is the single most
important thing this feature has to record. Encoding Broken as Archived would overload a
status that already means "no longer relevant".

Two further properties separate a Commitment from both existing kinds: it is never
scheduled (its window *is* the commitment, so a Plan has nothing to mean), and it is
never a unit of work in a dependency graph (nothing gates it and it gates nothing).
Roughly a third of a Task's fields are meaningless on it.

## Considered options

- **An `is_commitment` flag on Task.** No migration beyond a column, no new
  `RetypeKind`, no new editor, and rows already appear in List View. Rejected: every
  filter, lifecycle derivation, preset rule, badge mapper and MCP serializer that handles
  a Task would have to branch on the flag, and the branches are not local — they change
  what a status *means*, not just what is displayed. A kind that inverts the semantics of
  the fields it inherits is not a variant of that kind.
- **A Goal subtype.** Reuses Goal's no-Plan rule and its parent-acceptance rules, both of
  which a Commitment wants. Rejected on the missing Broken state, as above.
- **A rule attached to a Scope rather than to the domain tree.** Matches how the things
  are phrased ("today: no social media") and needs no tree work at all. Rejected: a node
  outside the domain tree has no Aspect, Project or tag, so it is invisible to every
  filter, every view and the whole inheritance model. The feature would arrive already
  disconnected from the rest of the app.
- **A second recurrence mechanism for repeating commitments.** Rejected in favour of
  widening a Flow's **Instance Type** from `goal | task` to `goal | task | commitment`.
  Habits already mean "a recurring template whose instances are virtual and whose
  divergences are Modification rows keyed by (flow item, iteration scope)" — which is
  exactly a per-night verdict. A parallel engine would have to reimplement Recurrence,
  Iteration, catch-up and pinning, and would drift.

## Consequences

- A new `commitments` table, a new `RetypeKind` variant, a position in the `Ctrl+↑/↓`
  cycle after Task, an editor modal, a node icon, and a section in the MCP snapshot.
  This is the cost that buys the semantics; it was paid knowingly.
- **Verdict is never derived.** Not from the window passing, not from children completing.
  `unresolved` therefore carries real information — "you have not said" — that any
  defaulted verdict would destroy. A polarity field (abstentions default Kept, obligations
  default Broken) was considered and rejected on exactly this ground, despite being truer
  to how the two shapes behave in practice.
- The **Verdict Window** (`archive_unresolved_after`) is the sole automatic state change
  in the kind, and it moves *Archival*, never the Verdict. It replaces two mechanisms that
  would otherwise apply: per-node On-exit behavior, and a commitment Habit's Consumption
  configuration, which is consequently fixed to Accumulating + Overlapping.
- It is stored as a `(n, kind)` Duration — the same shape a Habit's **Gap** and a Time
  Scope's Duration form already use — and its kind is independent of the Commitment's own
  window, so a monthly commitment can be answerable for two days.
- SPEC's **"List View rows are Tasks only"** no longer holds. Commitments render as their
  own section above the task rows.
- A Commitment must have an **effective** Time Scope, its own or inherited. This is the
  first kind in the model for which being Unscoped is invalid rather than merely
  always-active.
- The four preset rules gain a Commitment branch, including one carve-out that does not
  mirror any Task rule: **Plan** shows `broken` commitments whose window is still open,
  because a broken commitment remains a live problem until its window closes, while a kept
  one is settled.

## Amendment, 2026-09-23 — the Verdict Window's columns

The Verdict Window was built as the pair `verdict_window_n` / `verdict_window_kind` (migration
`0027` on `commitments`, and migration `0028` on `flows` for a commitment Habit), not as a column
named `archive_unresolved_after`. Nothing else in the decision changed.
