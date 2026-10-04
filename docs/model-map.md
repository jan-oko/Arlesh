# How Arlesh fits together: the model map

The agent-friendly mirror of [`model-map.html`](model-map.html). It has the same groups and cards,
in the same order, with fuller code pointers. It is a map, not the specification. The rules live in
[`SPEC.md`](../SPEC.md) and `docs/spec/`, and each card links to the section that owns its rules.

**Keep the two files in step.** A pull request that adds, removes or changes the meaning of a
concept updates both files, as it updates the spec (see `AGENTS.md`).

Paths are relative to the repo root. `src-tauri/src/` is abbreviated to `rs:` and `src/` (the
frontend) to `ts:`.

## The pipeline

```
 Stored (SQLite)          Board load (derived, never stored)        Filters              Readers
 ───────────────          ───────────────────────────────────       ───────              ───────
 node rows by kind   ──►  1 scope lifecycles (Timing, Overdue)  ──►  presets        ──►  Views (you)
 parent tree              2 Habit occurrences, cooldown blocks       pills               Mindmap, List,
 Flow/Habit templates     3 waits, check tasks                       Rust + TS twins     Plan, Steps, Zen
 overlays                 4 compound status, Review                  shared corpus  ──►  MCP (agents)
 dependencies, reasons    5 blocks: reasons, deps, capacity lock                         roots, private,
 statuses, done instants                                                                 Agentic writes
        ▲                                                                                     │
        └──────────── edits write stored rows and overlays only, never a derived value ───────┘
        │
        └─► undo journal (SQL triggers on every journaled table)
```

The load is `rs:mindmap/mod.rs` (`load_within`, then `load_blocked` adds the capacity lock's
blocks). The steps run in this order: `rs:tasks/scope_rules.rs::derive_all_scope_lifecycles`,
then `rs:nodes/table.rs::derive_habits`, which applies `rs:flows/occurrences.rs`,
`rs:flows/rules/cooldown.rs` and `rs:flows/compound_readings.rs`, then `rs:tasks/compound.rs::settle`,
which also draws the waits, then `rs:tasks/rules/archival.rs::inherit` (what lies beneath a hand
archive reads as archived), then `rs:tasks/rules/review.rs::derive`, then the capacity lock
(`rs:capacity/rules/blocks.rs`) and the compound block, and every Task's effective Plan last
(`rs:mindmap/rules/plans.rs`), once every row, Overdue flag and Archival is in. The MCP snapshot reads the same load (`rs:mcp/`).

## The derivation graph

The HTML page draws this as an interactive graph, and [`model-graph.html`](model-graph.html) shows the same graph on its own, with selectable concepts and their cards. These tables are the mirror of both. Every edge is a value the code reads to compute
the state. Edges marked *(of another node)* read that value on a different node: a compound's
sub-items, or a dependency's target. All of these states are worked out on every board load and
never stored.

| Derived state | Reads | Rule | Code |
| --- | --- | --- | --- |
| **Timing** | Time Scope (own or inherited), now | Pending before the window, Active in it, Lapsed after it. Unscoped is Active. | `rs:tasks/rules/lifecycle.rs::derive_timing` |
| **Effective due** | explicit due, Time Scope, on scope exit, Backlog, Habit iteration (the clock's default) | Explicit due wins. Otherwise a backlogged Task has none. Otherwise the window under Keep Overdue and none under Archive. An occurrence's default comes from its clock: none under Window + Archive, its window otherwise. | `rs:tasks/rules/lifecycle.rs::effective_due`, `rs:flows/occurrences.rs::default_due` |
| **Effective Plan** | own Plan, Time Scope, Overdue, effective Plan *(of another node: the parent)*; a Habit's span against its target | Own Plan, else the parent's effective Plan clipped to the node's own window (a wait, a check task and an Overdue Task do not clip). Climbs through every kind. Empty when the two do not meet. Flags an own Plan outside the inherited one, and an empty one. | `rs:tasks/rules/plan_inheritance.rs`, `rs:mindmap/rules/plans.rs::audit`, `rs:flows/rules/span.rs` |
| **Plan position** | Effective Plan, now | Where the Task's effective Plan stands: ahead, current or past. | `rs:mindmap/rules/plans.rs::stamp_plan_timing` (lifecycle `plan_timing`), `rs:filters/rules.rs::is_planned_ahead` |
| **Agentic (inherited)** | own Agentic flag (and ancestors') | Own flag, else the nearest flagged ancestor's. | `rs:tasks/agentic.rs`, `rs:capacity/rules/blocks.rs::reads_agentic` |
| **Expired** | verdict, Verdict Window, Time Scope, now | Unresolved, and now is past window end plus the Verdict Window. | `rs:tasks/rules/lifecycle.rs::verdict_deadline`, `derive_commitment_state` |
| **Resolution** | Timing, status, on scope exit | Only once Lapsed: Completed if done, Missed if unfinished under Archive, none under Keep Overdue. | `rs:tasks/rules/lifecycle.rs::derive_resolution` |
| **Compound status** | compound flag and sub-items' statuses, verdicts and waits; Archived *(of another node)* | Done when every counted item is Done; else In Progress if any is; else Started if any is Started or Done; else To Do. Effectively archived items are not counted, except those archived by finishing. | `rs:tasks/compound.rs`, `rs:flows/compound_readings.rs` |
| **Review** | Agentic, status, agent question waits | On Agent with a pending, live agentic question wait beneath it. | `rs:tasks/rules/review.rs::derive` |
| **Capacity block** | capacity lock, Agentic, status | Lock on, the Task reads as Agentic, and it is not Done. | `rs:capacity/rules/blocks.rs::blocked_tasks` |
| **Archived** (as the presets read it) | stored Archival (a Task's or Commitment's hand archive, a wait's archive), Goal/Project status, Resolution, Expired, verdict and Timing (a Commitment settled), wait status and Timing, Habit iteration (Missed or Lapsed), Archived *(of another node: an ancestor archived by hand)* | Effective Archival is Archived: a Completed or Missed Resolution forces it, or a Commitment is settled or Expired, or a wait is released with its window passed (or released with none), or it was set by hand — or an ancestor Task or Commitment was archived by hand, which its whole subtree inherits. Delegation is not archival (2026-10-03): it has its own pill. | `rs:tasks/rules/lifecycle.rs::derive_archival`, `derive_expectation_state`, `derive_commitment_state`, `rs:tasks/rules/archival.rs::inherit`, `rs:filters/rules.rs::is_archived` |
| **Compound block** | compound status, Blocked *(of another node: its open sub-items)* | Every open counted item is blocked. A pending wait or Unresolved Commitment keeps it unblocked. | `rs:tasks/compound/blocked.rs` |
| **Habit iteration** | status of its occurrences, compound status, verdicts of its Commitment items, releases of its wait items, clock and miss policy, now | Resolved when every template occurrence is settled: done (a compound one by its derived status), a Commitment item's given a verdict, a wait item's released. Otherwise the clock decides: Lapsed (Archive), Missed and carried (Overdue), open and owed (Owed), or the one open Interval instance. | `rs:flows/occurrences.rs::resolutions`, `rs:flows/rules/habits.rs` |
| **Cooldown block** | Habit iteration (done instants, a verdict's or a release's among them), cooldown, clock, now | After an iteration is done, block the next iteration (under Owed, every open one) until the latest done instant plus the cooldown. | `rs:flows/rules/cooldown.rs::holds`, `rs:flows/occurrences.rs::done_instants` |
| **Overdue** | effective due, status, Archived (effective Archival), now | Unfinished, not effectively Archived, and now is at or past the due's end. | `rs:tasks/rules/lifecycle.rs::derive_overdue` |
| **Blocked** | block reasons, dependencies, status *(of another node: each dependency's target)*, capacity block, cooldown block, compound block | Any reason: one written by hand; a dependency on a Task not Done, a Goal not Achieved or a wait still Pending; or a derived block. | `rs:filters/facts.rs::index_blocked`, `rs:filters/rules.rs::is_blocked`, `rs:mindmap/rules/facts.rs` (the board's `dependency_blocks`) |

How the presets read them:

| Preset | Reads | Rule | Code |
| --- | --- | --- | --- |
| **Plan** | status, Archived, Backlog, Delegate, Delegated pill | Hides done Tasks, archived items, backlogged Tasks, and delegated Tasks unless the Delegated pill includes them. | `rs:filters/rules.rs::passes_plan`, `is_hidden_backlog`, `is_dropped_for_delegation` |
| **Start** | Timing, Overdue, Archived, Blocked, Plan position, status, Agentic, Review, On Agent pill, Backlog, Delegate, Delegated pill | Drops blocked subtrees (but not the child dependencies a block waits on), windows Pending or Lapsed unless Overdue, backlogged work, delegated work unless the Delegated pill includes it, Plans still ahead, and On Agent work unless the pill is on. Always keeps Review. | `rs:filters/rules.rs::passes_start`, `passes_agentic_start`, `gate_below`, `is_dropped_for_delegation` |
| **Do / Zen** | status, Agentic, Review, On Agent pill | In Progress and Doing, Review always, Started and On Agent only when their switches ask. | `rs:filters/rules.rs::passes_do_status` |
| **Backlog** | Backlog flag (own or an ancestor's) | Only what was deliberately set aside, with everything beneath it. The inverse of the other presets. | `rs:filters/rules.rs::passes_status` (`Preset::Backlog`) |

---

## 1. What's stored

### Node kinds
- **Is:** the kinds of node:
  - six fixed Aspects as roots, then Projects, Domains and Tags to organise;
  - Goals, which are desired states;
  - Tasks, which are actions;
  - Commitments, which are rules you keep or break;
  - Expectations, which are waits;
  - Infos, which are notes.
- **Why:** each kind answers a different question (do it, reach it, keep it, wait for it) and resolves its own way.
- **Without:** one "item" type with a flag per behaviour, where a Goal could be ticked off like a chore.
- **Lives:**
  - The domain subtypes share `domains` (`rs:domains/`). Tasks are in `rs:tasks/`, Commitments in `rs:tasks/commitments.rs`, Expectations in `rs:tasks/expectations.rs` and Infos in `rs:infos/`.
  - [ADR 0005](adr/0005-commitment-node-kind.md) covers the Commitment kind.
- **Spec:** [Resources](spec/resources.md).

### The parent tree
- **Is:** every node has exactly one parent, and the tree is the board.
- **Why:** windows, the Agentic flag, privacy and archival reach children through it, so a branch is set once.
- **Without:** every node carries its own context, and moving a branch means editing every row.
- **Lives:**
  - `parent_type` / `parent_id` on each kind's table.
  - Ancestor climbs live in `rs:tasks/ancestry.rs`.
  - Frontend tree building lives in `ts:utils/mindmap-tree.ts`.
- **Spec:** [Resources](spec/resources.md), [Mindmap](spec/mindmap-view.md).

### Flows and Habits
- **Is:** a Flow is a template of Task, Goal, Commitment and wait items with relative Cycle Scopes and Plans; the items nest by the parenting table stored nodes obey. Starting it copies real, independent nodes. A Habit is a Flow with a Recurrence (`flow_recurrences`), whose instances are derived, never copied.
- **Why:** repeated structure without retyping it, and recurring work without a growing pile of rows.
- **Without:** weekly chores retyped every week, or the thousands of stored copies a daily habit would leave.
- **Lives:**
  - Templates live in `rs:flows/template.rs`, starting a flow in `rs:flows/mod.rs` and cycles in `rs:flows/cycles.rs`.
  - Tables: `flows`, `flow_tasks`, `flow_goals`, `flow_commitments`, `flow_expectations`, `flow_item_cycles`, `flow_dependencies` and `flow_recurrences` (migration 0094 added the Commitment and wait items).
  - Where an item may sit and what a wait item's first check is: `rs:flows/rules/items.rs`.
  - [ADR 0002](adr/0002-flow-habit-instance-materialization.md) covers how instances are materialised.
- **Spec:** [Flows](spec/flows.md), [Habits](spec/habits.md).

### Overlays
- **Is:** the difference between one derived row and its template: a status, a done time, any field edited on that one row. NULL inherits; a `*_set` flag marks an override *to* NULL.
- **Why:** storage grows with edits, not with elapsed weeks, and template edits still reach every untouched occurrence.
- **Without:** touching an occurrence would freeze a full copy, cut off from later template edits.
- **Lives:**
  - Tables: `task_overlays`, `goal_overlays`, `commitment_overlays` and `expectation_overlays`.
  - Relation differences are in `derived_children`, `derived_dependencies` and `derived_tags`.
  - Code: `rs:nodes/overlay.rs`, `rs:nodes/wait_overlay.rs` and `rs:flows/occurrence_edit.rs`.
- **Spec:** [Derived nodes § Overlays](spec/virtual-nodes.md#overlays).

## 2. What's derived

### Derived nodes
- **Is:** rows that exist because something else does, each an ordinary row of its kind with an `origin`:
  - Habit occurrences (`habit`);
  - a wait's check tasks (`check`);
  - the wait an Asynchronous Task spawns when done (`spawned_wait`);
  - the wait a delegated Task has on its person (`delegation_wait`).
- **Why:** every view, filter and the MCP read one row shape, with no second code path.
- **Without:** each surface special-cases each source, and they drift.
- **Lives:**
  - `rs:nodes/origin.rs`, `rs:nodes/table.rs`, `rs:nodes/waits.rs`, `rs:flows/occurrences.rs` and `rs:tasks/waits.rs`.
  - What a row may be done to, by its origin: `rs:nodes/rules/capabilities.rs`, sent on the board's facts.
  - Frontend: `ts:utils/derived-wait.ts` and `ts:utils/capabilities.ts`.
  - [ADR 0008](adr/0008-virtual-node-tables.md) covers virtual node tables.
- **Spec:** [Derived nodes](spec/virtual-nodes.md).

### Three kinds of id
- **Is:** the three ids a node can have:
  - a stored row's integer **row id**;
  - every node's **full id**, a UUID-v5 (a stored row's is the hash of `{kind}:{row id}`);
  - a **short id**, the shortest prefix of at least three hex digits that is unique and is not any visible row id.
- **Why:** derived rows have no row number, and people need a handle shorter than a UUID that can't be mistaken for a row or PR number.
- **Without:** two id types in every request, and a number meaning three different things.
- **Lives:**
  - `rs:nodes/id.rs` and `rs:nodes/key.rs`.
  - `rs:mcp/ids.rs` (`NodeNames`, `short_id_among`, `board_short_ids`).
  - Frontend: `ts:utils/uuid-v5.ts` and `ts:utils/node-identity.ts`.
- **Spec:** [MCP § Short ids](spec/mcp-server.md#short-ids), [Derived nodes](spec/virtual-nodes.md).

### Two status models
- **Is:** an ordinary Task is To Do, In Progress, Started or Done. A Task that reads as Agentic is To Do, On Agent, Review, Doing or Done. The two are separate types, stored in one column with disjoint spellings (`agentic_todo`, `on_agent`, `doing`, `agentic_done`).
- **Why:** the board has to say who holds the work. On Agent is the agent's; Doing is yours.
- **Without:** agent work reads as yours and fills Do and Zen.
- **Lives:**
  - `rs:tasks/model.rs` (`TaskStatus`, `AgenticStatus`, `Status`, `Status::is_done_db`).
  - What a click, `Enter` and `Alt+Enter` write: `rs:tasks/rules/gestures.rs`, through the `step_task_status` command.
  - Frontend: `ts:utils/status-mapping.ts`; its `convertedStatus` is pinned by `conformance/task-status.json`.
  - The kind is read from `rs:tasks/agentic.rs`.
- **Spec:** [Resources § Agentic statuses](spec/resources.md#agentic-statuses).

### Review
- **Is:** never set. A Task reads Review when it is On Agent with an open agentic question (`question: true`, pending, live) beneath it. Answering, which releases the wait, returns it to On Agent.
- **Why:** it is the only way an agent hands work back, and the question says what you need to do.
- **Without:** agent questions scatter as loose waits, and nothing on the Task says it is waiting on you.
- **Lives:**
  - `rs:tasks/rules/review.rs` (`derive`, `is_open_question`).
  - The board names each Task's open question (`rs:mindmap/rules/facts.rs`); `ts:utils/open-question.ts` finds that wait to draw and answer.
  - The MCP side is `arlesh_waits.ask`, in `rs:mcp/`.
- **Spec:** [Resources § Agentic statuses](spec/resources.md#agentic-statuses), [MCP § Agentic waits](spec/mcp-server.md#agentic-waits).

### Compound
- **Is:** a Task whose status is read off its whole subtree by a progress rule:
  - Done when everything counted is Done;
  - else In Progress if anything is;
  - else Started if anything is Started or Done;
  - else To Do.
  
  It is never stored, and manual status writes are refused. Habit occurrences can be compound too, and their derived status gates their iteration's resolution.
- **Why:** a Task that is the sum of its steps should never disagree with them.
- **Without:** a parent reads Done while a step is open.
- **Lives:**
  - `rs:tasks/compound.rs` (`settle`, the shared rule).
  - `rs:flows/compound_readings.rs` (the Habit pass, before classification).
  - Frontend: `ts:utils/compound.ts`.
- **Spec:** [Resources § Compound](spec/resources.md), [Habits § Added children](spec/habits.md).

## 3. Time

### Scopes and the 02:00 day
- **Is:** Season, Month, Week (Sunday to Saturday), Day, Part of Day and Exact windows. Each is named by a value key such as `{"kind":"week","date":"2026-09-20"}` and is never stored. Every canonical scope starts and ends at 02:00.
- **Why:** a Day must contain its own Night (22:00 to 02:00). A scope contains exactly its parts.
- **Without:** between midnight and 02:00 the Day says "today" while its Night says "yesterday", and everything derived from it flips early.
- **Lives:**
  - `rs:scopes/key.rs`, `rs:scopes/rules/derive.rs` and `rs:scopes/resolve.rs`.
  - Frontend: `ts:utils/scope-key.ts`, `ts:utils/scope-window.ts` and `ts:utils/scope-calendar.ts`.
  - The shared case file is `conformance/scope-keys.json`.
  - [ADR 0009](adr/0009-derived-scopes.md) covers derived scopes.
- **Spec:** [Time Scopes § The day boundary](spec/time-scopes.md#the-day-boundary), [§ Scopes are derived](spec/time-scopes.md#scopes-are-derived).

### Time Scope and Plan
- **Is:** a Time Scope is when something matters. A Plan is the slot you mean to do it in, inside that window. A null Time Scope inherits the nearest window above it. A Task with no Plan of its own inherits one too: its **effective Plan** is the nearest planned node's above it, clipped to its own window. Every reader uses it: Start, the Plan View, badges, the editor and the MCP.
- **Why:** "relevant this month" and "doing it Tuesday morning" are different facts that change at different rates.
- **Without:** either everything is scheduled rigidly, or nothing knows when it stops mattering.
- **Lives:**
  - `rs:tasks/scope_rules.rs` and `rs:tasks/rules/lifecycle.rs`.
  - Plan inheritance is `rs:tasks/rules/plan_inheritance.rs`, read over the whole board by `rs:mindmap/rules/plans.rs` and held on writes by `rs:mindmap/plan_guard.rs`.
  - The board sends what each node inherits (`rs:mindmap/rules/facts.rs`); the frontend reads it, and `ts:utils/plan-scope.ts` walks the Plan View's scopes.
  - [ADR 0001](adr/0001-time-scope-model.md) covers the time-scope model.
- **Spec:** [Time Scopes](spec/time-scopes.md), [§ Plan inheritance](spec/time-scopes.md#plan-inheritance).

### Timing
- **Is:** Pending before the window, Active in it, Lapsed after it. It reads the effective window, own or inherited.
- **Why:** Start should offer only what is in scope now.
- **Without:** next month's work and last month's both crowd today.
- **Lives:** `rs:tasks/rules/lifecycle.rs`; the frontend reads the backend's value (`isStartableWindow` in `ts:utils/filter-tree.ts`).
- **Spec:** [Time Scopes § On-exit behavior](spec/time-scopes.md#on-exit-behavior-timing-resolution-archival-and-the-overdue-flag).

### Due and Overdue
- **Is:**
  - **Due:** the window whose end makes work late. An explicit due wins. A backlogged Task has none. Otherwise, under Keep Overdue, it is the effective window.
  - **Overdue:** a flag set when the work is unfinished, not archived and past the due's end. It shows as an amber border.
- **Why:** being late is separate from being relevant, and late work stays live.
- **Without:** lateness had to be a resolution, which settled and hid work that was still open.
- **Lives:** `rs:tasks/rules/lifecycle.rs` (`effective_due`, `derive_overdue`), and `ts:utils/overdue.ts` on the frontend.
- **Spec:** [Time Scopes § Due scope and the Overdue flag](spec/time-scopes.md#due-scope-and-the-overdue-flag).

### Habit clocks
- **Is:** two clocks:
  - **Window:** lays iterations side by side, and a missed one is Archived, carried into the next one (Overdue), or left Owed.
  - **Interval:** keeps one open instance and counts the Gap from completion.
- **Why:** habits fail differently: a missed run is gone, a missed bill is still owed.
- **Without:** one rule that is wrong for half the habits.
- **Lives:** `rs:flows/rules/habits.rs` and `rs:flows/occurrences.rs`, reading `flow_recurrences.clock` and `miss_policy` (migration 0087).
- **Spec:** [Habits § Clocks](spec/habits.md#clocks).

### Cooldown and done times
- **Is:** a cooldown is a derived block on the next iteration for N finer units after one is done. Under Owed it blocks every open iteration. Every finish records when it happened:
  - `tasks.done_at`;
  - an overlay's `resolved_at`;
  - `achieved_at`, `released_at` and `verdict_at`, from migration 0089.
  
  A Task's done date can be corrected in Advanced.
- **Why:** done on Saturday shouldn't count again on Sunday, and a habit ticked late should count from when it was really done.
- **Without:** back-to-back completions across a window edge, and clocks counting from the moment you remembered to tick.
- **Lives:** `rs:flows/rules/cooldown.rs` (`holds`), `rs:flows/done_date.rs`, `rs:tasks/done_date.rs`; on the frontend, `ts:utils/cooldown-until.ts` and `ts:utils/done-date.ts`.
- **Spec:** [Habits § Cooldown](spec/habits.md#cooldown), [Resources § Done date](spec/resources.md).

## 4. Lifecycle

### Resolution
- **Is:** how a passed window settled an item: Completed, or Missed under Archive. A Habit iteration resolves when every occurrence its template made is settled: done, a compound one by its derived status, a Commitment item's by a verdict (Kept or Broken), a wait item's by its release. A settled item's instant counts for cooldowns and an Interval's gap.
- **Why:** a passed window needs an answer, and the clocks count from it.
- **Without:** old work hangs on with no verdict, and clocks have nothing to count from.
- **Lives:** `rs:tasks/rules/lifecycle.rs` and `rs:flows/occurrences.rs` (`resolutions`, `done_instants`).
- **Spec:** [Time Scopes § On-exit behavior](spec/time-scopes.md), [Habits](spec/habits.md).

### Archival and Backlog
- **Is:** Live, Backlog, Frozen or Archived.
  - **Set by hand:** a Goal or Project's status; a Task's stored Archival — Live, Backlog or Archived, one value at a time; a Commitment's or a wait's own archive.
  - **Inherited:** everything beneath a Task or Commitment archived by hand reads as Archived. Nothing below is written, so unarchiving brings the subtree back as it was.
  - **Derived:** a settled window archives, and so does a released wait whose window has passed (or that has none).
  
  A Task is never both backlogged and planned. Delegation is not archival: a delegated Task answers to its own Delegated pill.
- **Why:** "set aside" and "finished" are different questions, and a backlogged Task keeps its real status. Putting a whole branch away should be one write, and taking it back should restore it exactly.
- **Without:** statuses multiply, every filter has to know them all, and archiving a project means archiving every step in it by hand.
- **Lives:** `rs:tasks/rules/lifecycle.rs`, the inheritance in `rs:tasks/rules/archival.rs`, and `rs:filters/facts.rs`, with the Backlog invariant in `rs:tasks/mod.rs`. Migration 0093 stores the Task's and Commitment's hand archive. The gestures: the context menus (`ts:hooks/use-hand-archive.ts`), the editors' Archived switch, and the MCP's `arlesh_tasks.archive` / `unarchive`.
- **Spec:** [Time Scopes](spec/time-scopes.md), [Resources § Archive](spec/resources.md#archive), [Filtering Logic § The Delegated pill](spec/filtering-logic.md#delegated-pill).

### Commitment verdicts
- **Is:** a Commitment is judged, not done: Kept, Broken or Unresolved. Its Verdict Window bounds how long the answer stays owed; past it, the Commitment Expires.
- **Why:** a rule is kept or broken, and an unanswered night may well have been kept.
- **Without:** a missed check-in would count as a broken commitment.
- **Lives:** `rs:tasks/commitments.rs`; whether one has expired is a board fact (`rs:mindmap/rules/facts.rs`), which `ts:utils/commitment-glyph.ts` draws. [ADR 0005](adr/0005-commitment-node-kind.md) covers the Commitment kind.
- **Spec:** [Resources § Commitments](spec/resources.md#commitments).

## 5. Inheritance

### Agentic
- **Is:** a three-state flag (NULL, true, false) that inherits downward and can be overridden. It decides a Task's status model and what the MCP may write. Each Agentic Task has its own brief, and needs a Spec before it can start.
- **Why:** mark a project for agents in one edit, and pull one Task back out of it.
- **Without:** flagging every Task by hand, and agents writing into your own work.
- **Lives:** `rs:tasks/agentic.rs` and `rs:tasks/rules/agentic.rs`; the board sends what each node inherits (`rs:mindmap/rules/facts.rs`), and `ts:utils/agentic.ts` reads it with the node's own flag. The brief is in `task_agentic_briefs`; MCP write access is in `rs:access/`.
- **Spec:** [Resources § Tasks (Agentic)](spec/resources.md), [Link Inheritance](spec/link-inheritance.md).

### Scope containment
- **Is:** four containment rules: `child.TimeScope ⊆ parent.TimeScope`, `Plan ⊆ TimeScope`, `child.Plan ⊆ parent.Plan` and `Due ⊆ TimeScope`. They are checked on every write. Narrowing a parent offers to clamp its descendants. For Plans, a child's own Plan sits inside the Plan it inherits and no Task may be left with an empty one. After a write the board is read once, and a rule broken within the write's reach (what it wrote and everything beneath) is refused, naming the Tasks. A Habit's span sits inside its target's Time Scope and Plan.
- **Why:** a step can't matter outside the window of the thing it is a step of.
- **Without:** children outlive their parents, and plans are scheduled after the work stopped mattering.
- **Lives:** `rs:tasks/scope_rules.rs`, and for Plans `rs:mindmap/plan_guard.rs` over `rs:tasks/rules/plan_inheritance.rs`.
- **Spec:** [Time Scopes § Containment invariants](spec/time-scopes.md#containment-invariants).

### Link inheritance
- **Is:** Time Scope, Plan and Agentic inherit today. Asynchronous deliberately does not. Tags, knowledge-base links and delegation are specified to inherit but not built.
- **Why:** context belongs on the branch.
- **Without:** re-tagging every child, or filters that miss half a project.
- **Lives:** computed on read by ancestor traversal (`rs:tasks/ancestry.rs`).
- **Spec:** [Link Inheritance](spec/link-inheritance.md).

### Privacy
- **Is:** a node's own Private flag. It hides the node and everything beneath it outside Private Mode, and hides it from the MCP even inside a root.
- **Why:** one switch keeps an area out of sight and out of agents' context.
- **Without:** hiding a subtree node by node, and leaking what was missed.
- **Lives:** `rs:access/`; the board sends which root each node is seen through (`rs:mindmap/rules/facts.rs`); the frontend's filter pass hides private nodes.
- **Spec:** [Filtering Logic](spec/filtering-logic.md), [MCP § Access](spec/mcp-server.md#access).

## 6. Blocks

### Block reasons
- **Is:** an ordered list of reasons written on a Task or Goal by hand.
- **Why:** some obstacles are not on the board.
- **Without:** blocked work looks startable.
- **Lives:** `rs:block_reasons/` (table `block_reasons`).
- **Spec:** [Resources § Tasks (Blockers)](spec/resources.md).

### Dependencies
- **Is:** a Task can depend on a Task, a Goal or a stored Expectation. Until the dependency is met, the Task carries the reason "Blocked by {kind} {short id} ({title})". Cycles are refused.
- **Why:** order between pieces of work is a fact worth recording once.
- **Without:** you remember the order yourself, and Start offers work out of turn.
- **Lives:** `rs:tasks/mod.rs` (`add_task_dependency`), `rs:tasks/rules/dependencies.rs` (`dependency_name`), what a Task may depend on (`candidates`, asked by the `dependency_candidates` command), and the board's `dependency_blocks` and `met` facts (`rs:mindmap/rules/facts.rs`); `ts:utils/blocked-by.ts` words them and `ts:utils/dependency-candidates.ts` finds the offered targets in the search.
- **Spec:** [Resources § Tasks (Dependencies)](spec/resources.md).

### Derived blocks
- **Is:** blocks no one writes:
  - the agent capacity lock, on every Agentic Task not yet Done;
  - a Habit's cooldown;
  - a compound Task whose open sub-items are all blocked.
  
  They gate starting work and never change a status.
- **Why:** one mechanism, so filters, badges and the MCP need nothing new for each.
- **Without:** a special filter rule per feature, each one missing a view.
- **Lives:** `rs:capacity/rules/blocks.rs` (the lock is stored in `agent-capacity.json`), `rs:flows/rules/cooldown.rs` and `rs:tasks/compound.rs`.
- **Spec:** [MCP § Agent capacity](spec/mcp-server.md#agent-capacity), [Habits § Cooldown](spec/habits.md#cooldown), [Filtering Logic](spec/filtering-logic.md).

## 7. Reading it out

### Presets
- **Is:** All, Plan, Start, Do, Backlog and Unblock, each a rule over derived facts. Start, for example, drops:
  - blocked subtrees;
  - Pending and Lapsed work, but not Overdue work;
  - work whose Plan is still ahead;
  - On Agent work, unless asked for.
- **Why:** "what can I begin now?" should have one answer everywhere.
- **Without:** each view invents its own idea of "now".
- **Lives:** `rs:filters/` (`facts.rs`, `rules.rs`, `tree.rs`, `list.rs`), and `ts:utils/filter-tree.ts` and `ts:utils/list-filter.ts` on the frontend.
- **Spec:** [Filtering Logic](spec/filtering-logic.md), [Mindmap § status preset](spec/mindmap-view.md).

### The conformance pair
- **Is:** every rule the frontend must answer per render or per pointer move is written twice — in a Rust `rules` module, which is the definition, and as a TypeScript copy — and one shared case file under `conformance/` runs against both ([ADR 0010](adr/0010-business-rules-layer.md)). The pinned copies are the presets, the Archived, Backlog and Delegated pills and the List View's pills (`preset-filters.json`), the list sections (`list-sections.json`), the Zen View's contents and locked presets (`zen-contents.json`), the parenting table (`parenting.json`), the status models' conversion (`task-status.json`), the Habit fold (`habit-fold.json`), the cooldown options (`cooldown.json`), the cycle grid (`flow-cycles.json`), the Plan View's triage, refusal and sections (`plan-triage.json`), and scope keys, windows, labels and the day boundary (`scope-keys.json`).
- **Why:** the views filter and draw on every keystroke without a round trip, and the corpora keep the copies honest; everything else the frontend reads from the backend instead.
- **Without:** the agent's board and yours drift apart silently.
- **Lives:** `conformance/`, run by the `*-conformance.test.ts` files beside each TypeScript copy and by the Rust tests under `src-tauri/tests/`.
- **Spec:** [Filtering Logic § Where the definition lives](spec/filtering-logic.md).

### Pills and the focus exemption
- **Is:** filters combine as Any, All and Not. The selected node stays on screen, dimmed, after your own edit stops it matching.
- **Why:** completing a Task under Plan shouldn't make it vanish from under the cursor.
- **Without:** every edit risks losing your place.
- **Lives:** `rs:filters/pills.rs` (the pills, also on an MCP read), `ts:utils/list-filter.ts`, `ts:utils/filter-modes.ts`, `ts:utils/focus-exemption.ts` and `ts:utils/filter-layout.ts`.
- **Spec:** [Filtering Logic](spec/filtering-logic.md).

### Views
- **Is:** five views over one tree and one filter model:
  - **Mindmap:** the tree;
  - **List:** rows;
  - **Plan:** triage into scopes;
  - **Steps:** one level at a time;
  - **Zen:** what is in progress.
- **Why:** different jobs need different shapes of the same truth.
- **Without:** five boards to keep in step.
- **Lives:** `ts:components/MindmapView`, `ListView`, `PlanView`, `StepsView` and `ZenView`, with tabs in `ts:stores/`.
- **Spec:** [Tabs](spec/tabs.md), [Mindmap](spec/mindmap-view.md), [List](spec/list-view.md), [Plan](spec/plan-view.md), [Steps](spec/steps-view.md), [Zen](spec/zen-view.md).

### The MCP
- **Is:** the agents' door to the board.
  - Agents see only inside the roots you open, and never anything private.
  - They write only Agentic Tasks, and create Tasks Agentic.
  - They read the same derived board you see, paged.
  - They hand work back by asking a question.
- **Why:** a clean, bounded context for an agent, on the same truth you see.
- **Without:** agents read everything, or a separate copy that disagrees.
- **Lives:**
  - `rs:mcp/` (snapshot, tasks, waits, `ids.rs`, `access.rs`, `capacity`) and `rs:access/` (`AccessMap`).
  - The roots are stored in `mcp_roots`.
- **Spec:** [MCP Server](spec/mcp-server.md).

## 8. Keeping it honest

### The undo journal
- **Is:** SQL triggers on every journaled table record each row's before and after image. One gesture is one step, and Ctrl+Z replays it in reverse, across windows. MCP writes are journaled as the agent's and are not undoable from the app.
- **Why:** a trigger can't be forgotten by a command that doesn't know it exists.
- **Without:** an inverse to write for every one of eighty-odd commands, with the next one missing it.
- **Lives:**
  - `rs:undo/`, and `scripts/generate-undo-triggers.sh`, which a test compares against the schema.
  - [ADR 0006](adr/0006-undo-via-a-trigger-written-row-journal.md) covers the trigger-written journal.
- **Spec:** [Undo](spec/undo.md).

### Migrations
- **Is:** numbered schema steps, applied in order and never edited once applied. Data is moved aside, never dropped; for example, `retired_beads_ids` from 0091.
- **Why:** your real database must reach every new shape without losing anything.
- **Without:** upgrades that refuse to start, or quietly discard history.
- **Lives:** `src-tauri/migrations/`, run by sqlx at startup (`rs:database/`).
- **Spec:** the migration notes in each area file.

### A truthful board
- **Is:** three habits keep the board true:
  - Nothing derived is stored, so nothing derived goes stale.
  - Every window hears about every change.
  - An agent whose next step is yours must say so with a question.
- **Why:** you act on what the board says, and a board that lies costs more than none.
- **Without:** stale copies, windows that disagree, and work that looks held when it is waiting on you.
- **Lives:** `rs:board.rs` and `ts:api/board.ts` for the board-changed broadcast, and `AGENTS.md` for the hand-back rule.
- **Spec:** [Windows & Tray § The board-changed broadcast](spec/window-tray.md#the-board-changed-broadcast), [MCP § Agentic waits](spec/mcp-server.md#agentic-waits).
