# Flow and Habit instance materialization

Starting a plain (non-habit) **Flow** produces a **real, independent copy** of its subtree under the target node (the flow node becomes its Instance Type), retaining only a UI-level link to the originating template. A **Habit** (a Flow with a Recurrence pattern) instead produces **virtual** instances: each is identified by `(flow item, iteration scope)` and rendered from the template, with only divergences (status, edited fields, dependencies, deletion/archival tombstones) persisted in an overlay table.

## Status

accepted

## Considered options

- **Materialize habit instances as real rows too.** Rejected: an unbounded or open-ended recurrence would generate effectively infinite rows; virtual generation keeps storage proportional to *divergences*, not iterations.
- **Make plain-flow instances virtual/template-linked as well.** Rejected: contradicts "spins up a copy"; one-shot flows should yield ordinary, editable nodes with no live template coupling.
- **Materialize-on-first-touch hybrid.** Rejected: creates two representations of the same instance kind and complicates consumption bookkeeping.

## Consequences

- Two divergent instance representations by design: plain-flow = real/independent, habit = virtual/overlay.
- An absent overlay row renders purely from the template; completing or editing a virtual instance writes an overlay row keyed by `(flow item, iteration scope)`.
- **Cycle Scope/Plan** pairs resolve on every start; a flow item with N pairs materializes N items (uniform for one-shot and per-iteration).
- Intra-template **dependencies remap per instance/iteration**; cross-iteration dependencies are not auto-created.
- **Consumption** is a per-habit configurable tree (Destructive/Accumulating → Overlapping/Blocking → Catch-up: all-pending / next / latest-with-tombstones).
- Instances must satisfy scope containment against their **Target Node**; the target picker is restricted accordingly, and editing the scope of a flow-parent prompts reconciliation.
- Future virtual instances can be **display-pinned** out of the ellipsis node without materializing.
- Editing a Habit's scope/repetition prompts (archive-and-new vs delete-and-regenerate) only when divergent instances exist.

## Amendment, 2026-09-23 — what the overlay is keyed on and holds

Marked here so the consequences above are not read as current where they no longer are:

- The overlay row is keyed by `(instance, iteration scope, cycle pair)`, not `(flow item, iteration
  scope)`. The **instance** may be the flow root itself (migration `0017`, the `flow_root` sentinel),
  and the **cycle pair** was added so the N occurrences an item with N pairs draws in one iteration
  complete separately (migration `0029`; the root and a pairless item key on `0`).
- A *latest* catch-up's skipped iterations are **derived** as Missed, not recorded as tombstones.
- Of the divergences listed, only **status** (with when it was resolved) is written today. The
  table has columns for a title, a block reason and a tombstone, and `habit_instance_dependencies`
  exists for per-iteration dependency edges, but nothing writes them. The ellipsis node and
  display-pinning are not built; they were taken out of the spec and are tracked as `Arlesh-9md`.
- Real children can be attached to one virtual instance (`habit_instance_children`, migration
  `0034`) without materializing it, which keeps the materialize-on-first-touch rejection above.

## Amendment, 2026-09-23 — superseded in representation by ADR 0008

How a virtual instance is represented, keyed and edited is replaced by
[ADR 0008](0008-virtual-node-tables.md): a derived node is an ordinary row of its kind, read through
a per-kind virtual table over a per-kind overlay, with a UUID-v5 id and an `origin` field. This ADR's
decision to keep Habit instances virtual, with storage proportional to divergences, stands.
