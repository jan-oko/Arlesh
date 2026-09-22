# Filtering Logic

*One area of the [Arlesh design specification](../../SPEC.md).*

Filters apply to task/goal lists. Any number of filters can be active simultaneously, each in one of three modes:

- **Any** — item must match at least one Any-mode filter
- **All** — item must match every All-mode filter
- **Exclusion** — item must not match any Exclusion-mode filter

Combined logic: `(union of Any-filters) AND (intersection of All-filters) AND NOT (union of Exclusion-filters)`

Filterable fields: parent domain/task, dependency, status, delegate-to, delegated/undelegated, agentic, Person/Event/Thread/Scope, planned scope, Project, Aspect, Goal, Tag.

## The scope selector

The **Scope** dimension has two halves. Six derived tokens — Unscoped / Active / Overdue / Lapsed / Planned / Unplanned — say *what state* an item's window is in, and answer a question with no period in it. The **scope selector** names the period: it holds one scope, picked from the Scope Picker as a single scope or a range, together with two choices about how it is compared.

| Choice | Values |
|---|---|
| The scope | one scope, or a range, from the Scope Picker |
| **Axis** | **Relevance** — the item's effective Time Scope — or **Plan** |
| **Match** | **Within** — the item's window ⊆ the picked one — or **Overlapping** |

It is a control of its own in the top bar beside the status preset, in every view, reading the current scope or **Any scope**, with a clear button on it. Not a chip in the active-filter row: with nothing selected there would be no chip at all, and so nothing to click to start, and "which period am I looking at" is a question a planning pass re-asks constantly. It **joins** the derived tokens and the status preset rather than replacing either, and there is **one selection at a time** — setting another replaces it, so there is never a union of scopes to reason about.

**The selection lives per tab**, beside the other filters (see [*Tabs*](tabs.md)). Two tabs pointed at different weeks is most of the reason tabs exist: comparing two periods becomes the same gesture as comparing two subtrees. What is stored is the picked scope's **boundary ids**, never the window they resolve to — the scope columns are the invariant and the window is derived from them ([*Time Scopes*](time-scopes.md)), so a window written down would be a stale copy the next time that derivation changes.

### What the two rules mean

- **Within** answers *"what belongs to exactly this week"*. It is the rule scope filtering always had, now one of two.
- **Overlapping** answers *"what is relevant **during** this week"*, and keeps the season-scoped item that spans it. This is the question a planning pass asks, and it is the selector's default.

Both are evaluated on **resolved datetime boundaries**, which is what makes them hold uniformly across canonical, part-of-day and exact scopes, and across a range whose endpoints are of different kinds. A range is resolved to **one** window — the start of its first endpoint through the end of its last — and compared as a single interval. Windows are half-open, so two adjacent scopes do not overlap: next week's work is not this week's.

### What each axis reads

**Relevance** reads the item's **effective** Time Scope: its own, or — a null Time Scope meaning *inherit* — the nearest scoped ancestor's, exactly as Timing, Resolution and containment already read it. An item that is truly **Unscoped** is *always relevant*, which reads as an unbounded window: it **overlaps** every scope and is **within** none.

**Plan** reads the Task's own Plan and nothing else. A Plan is never inherited — a subtask of a Task planned into Tuesday is not itself planned into Tuesday — so an unplanned item, and every Goal and Commitment, matches nothing on this axis. Absence is an answer here rather than an inapplicable question, which is the same reading the List View's Scope-state dimension already takes, where *Unplanned* is one of its two values.

Only the kinds that carry a window are judged at all. A Domain, a Project or a Flow item has none, so it passes the selector and shows, as always, only as the ancestor of a content match — the rule the tag predicate already follows.

### One core, two panes, one corpus

The selector is part of the **definition** in `src-tauri/src/filters/`, not a frontend-only narrowing: an agent asking *"what is relevant in W35"* and a person looking at the board must not get two answers. `BoardFilter` carries the selection as a resolved window — the form both surfaces reduce to, since the app names a scope through the Scope Picker and an agent through `arlesh_scopes` — and the [MCP server](mcp-server.md) accepts it on `arlesh_snapshot.load`. Cases in `conformance/preset-filters.json` cover all four axis × match combinations and both evaluators replay them.

The [Plan View](list-view.md)'s two panes are **two of these four combinations, fixed**: its *planned* pane is Plan × Within and its *candidates* pane is Relevance × Overlapping. They share the selector's implementation of Within and Overlapping and are not settable by it — the two panes need *opposite* settings to be useful, which one control cannot express, and picking Plan × Within for both would empty the candidates side. The selector narrows the tree that feeds that view, as every other filter does.

**Where the definition lives.** The status presets and the override pills are defined once, in `src-tauri/src/filters/`, so that the [MCP server](mcp-server.md) and the two views answer the same question the same way — an agent reading the board and a person looking at it disagreeing about what is live, silently, is the failure this exists to prevent. The frontend does **not** call into that definition: its filter pass is synchronous and runs per render, and an IPC round trip in front of every selection move would be a regression, so it keeps a synchronous evaluator of its own. The two are held together by `conformance/preset-filters.json` — a corpus of boards, filters and kept nodes, written from this specification and generated by neither implementation, which the Rust tests and the frontend tests both replay. Changing a rule in one language and not the other fails the other language's build. The **focus exemption** below is deliberately not part of it: it is a render-time overlay on the view's own selection, not a filter rule.

**Focus exemption.** The **selected** node renders whatever the filter says about it, for as long as it stays selected — so a node that stops matching *because of your own edit* (completing a Task under Plan, cycling a Task to a Goal under Do, marking something Private) stays where it is instead of vanishing out from under you. It renders **dimmed**, carrying the status-icon badges that already say why it no longer matches; there is no new chrome. It overrides **every** hiding rule, the hard-hiding ones included — Private Mode, the Info/Flow type toggles, a shelved Project, a blocked subtree under Start — not just the soft preset/tag/pill filters. That is safe because toggling any of those *is* a filter change, which ends the exemption, so a private node can never survive into a Private-Mode-off view; the only case that survives is one you just marked private yourself, while still on it.

It **ends** when focus leaves — the selection moves, or Escape clears it — and on filter change, subtree change and reload. Nothing about it is persisted. It never resurrects a node: arrowing away removes it, and arrowing back does not bring it back, because it is no longer on screen to arrive at.

The exemption covers the focused node **and every ancestor needed to reach it**, and nothing else. The Mindmap keeps a non-matching node only as the ancestor of a match, so exempting a node without its chain would draw it detached; an ancestor that surfaces only to carry it is dimmed too, and carries nothing else with it — revealing (say) a private Project as an ancestor does not spill the rest of its subtree into the view. The List View needs no chain: its rows are Tasks, and a row's hidden ancestors are already named in its path header, so there the exemption is exactly one row, held in its own place in the list.

It is a **render-time** exemption: the filter's definition is unchanged and the filter's own answers are unchanged. Anything that counts, filters or exports off the filter sees exactly what it saw before — only the view holds the extra node.

---
