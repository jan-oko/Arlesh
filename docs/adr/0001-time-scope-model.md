# Time Scope model: relevance vs plan, interval containment, exact scopes

We split an item's time into two concepts — **Time Scope** (when it is *relevant*) and **Plan** (the single scope a Task is *scheduled into*) — repurposing the former single `scope_id` as the Time Scope and adding Plan as a new, task-only field. Scope containment is evaluated as **interval containment on resolved datetime boundaries** rather than equality on denormalized `week_id`/`month_id`/`season_id`, so it holds uniformly across canonical scopes, multi-week flow scopes, and arbitrary minute-precision **exact** scopes.

## Status

accepted

## Considered options

- **One unified scope field** (relevance and scheduling collapsed). Rejected: loses "plan a task into a subscope of its relevance window."
- **Keep FK-equality containment** (denormalized parent ids). Rejected: an exact or flow scope can span multiple weeks/months and has no single canonical parent, so equality can't express containment correctly.
- **Inline exact datetimes outside the scope hierarchy.** Rejected: exact-scoped items would be invisible to canonical containment filters.

## Consequences

- Tasks gain a Plan field; Goals have a Time Scope but no Plan.
- Filtering must support interval containment (overlap/within on resolved boundaries), not just FK equality. Denormalized ids may remain as a canonical-vs-canonical optimization.
- Invariants enforced at write time: `Plan ⊆ TimeScope`, `child.TimeScope ⊆ parent.TimeScope`, `child.Plan ⊆ parent.Plan`. Local over-wide edits are rejected; parent-narrowing or reparenting that would orphan descendants prompts clamp-or-cancel.
- A **null** Time Scope means *inherit the nearest scoped ancestor's window*; an item is truly Unscoped (always active) only when no ancestor is scoped.
- The **Duration** form is snapshotted to a fixed window on save for standalone items (while persisting its duration parameters for display/edit), but stays **relative** inside Flow templates.
- Scopes acquire a time-of-day component (Parts of Day, exact scopes); **Night (22:00–02:00)** is parented to the day it starts on.
- "Archived because the window passed" is a derived/virtual state, never a stored-status mutation.
