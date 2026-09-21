# Filtering Logic

*One area of the [Arlesh design specification](../../SPEC.md).*

Filters apply to task/goal lists. Any number of filters can be active simultaneously, each in one of three modes:

- **Any** — item must match at least one Any-mode filter
- **All** — item must match every All-mode filter
- **Exclusion** — item must not match any Exclusion-mode filter

Combined logic: `(union of Any-filters) AND (intersection of All-filters) AND NOT (union of Exclusion-filters)`

Filterable fields: parent domain/task, dependency, status, delegate-to, delegated/undelegated, agentic, Person/Event/Thread/Scope, planned scope, Project, Aspect, Goal, Tag.

**Focus exemption.** The **selected** node renders whatever the filter says about it, for as long as it stays selected — so a node that stops matching *because of your own edit* (completing a Task under Plan, cycling a Task to a Goal under Do, marking something Private) stays where it is instead of vanishing out from under you. It renders **dimmed**, carrying the status-icon badges that already say why it no longer matches; there is no new chrome. It overrides **every** hiding rule, the hard-hiding ones included — Private Mode, the Info/Flow type toggles, a shelved Project, a blocked subtree under Start — not just the soft preset/tag/pill filters. That is safe because toggling any of those *is* a filter change, which ends the exemption, so a private node can never survive into a Private-Mode-off view; the only case that survives is one you just marked private yourself, while still on it.

It **ends** when focus leaves — the selection moves, or Escape clears it — and on filter change, subtree change and reload. Nothing about it is persisted. It never resurrects a node: arrowing away removes it, and arrowing back does not bring it back, because it is no longer on screen to arrive at.

The exemption covers the focused node **and every ancestor needed to reach it**, and nothing else. The Mindmap keeps a non-matching node only as the ancestor of a match, so exempting a node without its chain would draw it detached; an ancestor that surfaces only to carry it is dimmed too, and carries nothing else with it — revealing (say) a private Project as an ancestor does not spill the rest of its subtree into the view. The List View needs no chain: its rows are Tasks, and a row's hidden ancestors are already named in its path header, so there the exemption is exactly one row, held in its own place in the list.

It is a **render-time** exemption: the filter's definition is unchanged and the filter's own answers are unchanged. Anything that counts, filters or exports off the filter sees exactly what it saw before — only the view holds the extra node.

---
