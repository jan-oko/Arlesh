# Set-type: potentially destructive conversions

**Status:** analysis / not-yet-specified. Captures the risky conversions the **Set type** context-menu
submenu can now reach directly, so their handling can be designed later.

## Background

The context-menu **Set type** submenu (and Ctrl+Up/Down) drives `retypeNode` in
`src/components/MindmapView/use-mindmap-data.ts`. The submenu only offers kinds that are valid for the
node's **parent** and can hold its existing **children** (`validTypesForCycling` + `typeAcceptsChildren`
in `src/utils/node-meta.ts`). That prevents the two hard-invalid families — a child that can't move
under the new type, and a type the parent can't hold — but it does **not** cover the conversions below,
which currently apply **silently** (no prompt, no data carried). The Ctrl+Up/Down cycle only prompts for
a subset (goal↔task with goal children or a block reason; →info with non-info children); everything else
here is unguarded on both paths.

Cross-table conversions (anything that changes DB table) **create a fresh entity from the title, re-parent
the compatible children, and delete the old row.** Every field not explicitly re-created is dropped.

## 1. Field/attribute loss (fresh entity drops type-specific data)

| Conversion | Carried over | **Dropped (data loss)** |
|---|---|---|
| project → goal / task / info | title, position | project **status**, **knowledge-base directory**, description |
| goal → domain/project/tag | title, position | **status**, **block reason**, **time scope**, **on-scope-exit**, **tags** |
| goal → info | title→body | everything except the title |
| task → domain/project/tag | title, position | **status**, **block reason**, **delegate-to**, **time scope**, **on-scope-exit**, **plan**, **tags** |
| task → info | title→body | everything except the title |
| goal → task | title, position, **status (mapped)**, block reason | **time scope**, **on-scope-exit**, **tags** |
| task → goal | title, position, **status (mapped)**, block reason | **delegate-to**, **plan**, **time scope**, **on-scope-exit**, **tags** |
| info → goal / task / domain | title (from body) | the info **details** field (the multi-line body) |

Same-table domain conversions (project ↔ domain ↔ tag) only flip `subtype` via `updateDomain`, so no row is
deleted — but a project's **status**/**KB directory** become inert once it is a domain or tag (and are not
restored automatically if converted back, only because the columns happen to survive).

## 2. Orphaned children not re-parented

`retypeNode` re-parents goal/task/info children, and now **flow** children too, for the submenu-reachable
conversions where the new node can legally parent a flow (flows may sit under aspect/project/domain/goal):

- **domain/project → goal** and **goal → project/domain** now re-parent a flow child onto the new node.

The remaining gap is only reachable via the unfiltered Ctrl+Up/Down **cycle** (not the submenu): converting
a flow-bearing node to a **task** or **tag** — neither of which can parent a flow — still orphans it. Those
conversions aren't offered by the submenu (`typeAcceptsChildren` excludes `flow` from task/tag), so this is
deferred with the rest of the cycle work.

(Domain-table children — a sub-project/domain/tag — are already excluded by `typeAcceptsChildren`, since
goal/task/info can't hold them, so those aren't reachable.)

## 3. Status remap is lossy by design

goal↔task maps status through `goalStatusToTaskStatus` / `taskStatusToGoalStatus`. A goal's `frozen`
/`archived` collapse toward a single task status (and back), so round-tripping a goal→task→goal does **not**
restore the original status. The cycle surfaces this with a toast; the submenu does not.

## Open questions for a future spec

1. Should cross-table conversions **preserve** transferable fields (block reason, time scope, on-exit, tags)
   rather than drop them? Several already map cleanly between goal and task.
2. Should a conversion that drops data or orphans a flow child **prompt for confirmation** (as the cycle does
   for goal-children/non-info-children), with a summary of what will be lost?
3. Flow children are now re-parented onto the new node for submenu conversions (goal/project/domain
   targets). Should the cycle's task/tag targets re-parent the flow to the surviving **grandparent**
   instead of orphaning it?
4. Should `info → …` carry the **details** field somewhere (e.g. appended to a description) instead of
   dropping it?
