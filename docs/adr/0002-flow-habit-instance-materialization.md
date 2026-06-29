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
