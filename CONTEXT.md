# Arlesh — Domain Glossary

Canonical terms used throughout Arlesh. Code, translation keys, and documentation must use these names consistently.

---

## Entities

**Aspect** — One of six built-in, color-coded top-level life-area containers (Body, Connections, Growth, Duty, Flow, Self). Fixed roots of the domain tree; not user-managed.

**Project** — A large organizational domain (hobby, habit, workplace, etc.) parented under an Aspect or another Project. May link to an Obsidian knowledge-base directory.

**Domain** — A general-purpose organizational container. Can parent Goals, Tasks, Tags, or other Domains.

**Tag** — A flat leaf node used as a resource marker. Each Tag belongs to a Domain parent. Tags cannot parent other Tags.

**Goal** — A desired state. Parented under a Project, Domain, or another Goal. Can have sub-goals.

**Task** — An action item. Parented under a Project, Domain, Goal, Commitment, or another Task. Can depend on Tasks, Goals and Expectations. A delegated Task has every effect of archival.

**Info** — A free-standing note: a one-line body plus an optional long-form **Details** text, stored in `infos`. Parented under an Aspect, Project, Domain, Tag, Goal, Task or another Info (a Tag holds nothing else). Carries no status, scope or tags; on the Mindmap an Info rides along with a kept node but never keeps one. One of the `RetypeKind`s, so any other kind can be retyped to it and back.

**Flow** — A template for a Goal/Task subtree, materialized on demand. A new node kind. Has a title, an **Instance Type** (goal or task), an optional **Target Node**, and a **Flow Window**. May be parented under an Aspect, Domain, Project, or Goal.

**Flow Window** — A Flow's own relevance window, resolved against the start anchor at materialization. Two forms: a **Span** — a coarse Duration of N of a scope kind (`day`/`week`/`month`/`season`), a relative *length* — or a **Phase** — a sub-day, fixed *time-of-day*: a part-of-day band (e.g. Evening) or an exact `HH:MM–HH:MM` clock range, carried date-free on the template and combined with the anchor's date on start. A Habit whose window is a Phase recurs at that fixed time-of-day, stepping whole days by its Gap ("10:00–12:00 daily", "Evening every 2 days").

**Instance Type** — Whether a Flow materializes its root (and constrains its children) as a Goal, a Task, or a Commitment.

**Target Node** — The node under which a Flow's instances are created. **Optional: unset means "my parent"**, resolved wherever the target is read rather than stored on the Flow — so moving a Flow moves its instances with it, and a stored Target Node is by definition a deliberate override that a move leaves where it was put. Overridable again when starting the Flow.

**Flow instance** — The result of starting a plain (non-habit) Flow: a real, persistent, independent Goal/Task subtree copied under the target. Retains a stored link to its originating Flow used only as a UI indicator (no cascading edits). Habit instances differ — they are virtual (see Habit). Dependencies declared between flow items are **remapped per instance/iteration** (Implement waits on this instance's Specify, not the template's); cross-iteration dependencies are not auto-created.

**Flow item** — A child of a Flow (a flow task or flow goal). Like a normal Task/Goal but additionally carries one or more **Cycle Scope** / **Cycle Plan** pairs (see those terms).

**Cycle Scope** — A flow item's *relative* relevance window, expressed as the Nth subscope of the flow scope (a scope kind lower than the flow's), e.g. "3rd day of the 2-week flow scope." Null means the whole flow scope. Resolved to a concrete Time Scope when the flow is started.

**Cycle Plan** — A flow item's *relative* Plan within its Cycle Scope (e.g. the morning of that day). It may also be the Cycle Scope itself — a Part-of-Day scope, which has no finer kind, is planned this way ("Plan to scope"); with no Cycle Plan an occurrence is unplanned. Resolved to a concrete Plan on flow start. A flow item may hold multiple (Cycle Scope, Cycle Plan) pairs; each pair materializes a separate item per start/iteration.

**Habit** — A Flow with a Recurrence pattern. Its instances are generated automatically per iteration and are **virtual**: each is identified by (flow item, iteration scope), rendered from the template, with only divergences (status, edits, dependencies, deletion/archival tombstones) persisted as **Modification** rows. A Habit is **Archived** by the editor's *Archive & new*: it stops recurring, and existing occurrences survive.

**Recurrence** — A Habit's pattern, composed of **Repetition** (a Start anchor, an optional Gap of N of a scope kind ≥ the habit scope, and an optional end) and **Consumption** (see below).

**Consumption** — A Habit's per-habit configuration for how unfinished instances are treated as iterations pass; the recurring form of a scoped item's **On-exit behavior**. A configurable tree: (1) **Destructive vs Accumulating** — do unfinished instances **lapse** (Archive-on-exit) when their iteration passes, or do they survive (Keep)? (2) if Accumulating, **Overlapping vs Blocking** — are new iterations generated while unresolved instances exist, or withheld? (3) if Blocking, **Catch-up policy** when the open iteration is completed — generate *all pending* missed iterations in order, only the *next* iteration (advance by one), or jump to the *latest* (current) iteration, the skipped intermediate iterations deriving as **Missed** (for streak/history; derived on read, not stored).

**Iteration** — One concrete occurrence window of a Habit, anchored from the Repetition Start plus accumulated flow-scope-and-gap steps. For a **Span** window each iteration occupies one flow window and the Gap is the idle span between one window's end and the next's start, snapped to the canonical scope. For a **Phase** window each iteration is the fixed band/time on its anchor day and the Gap is the whole-day stride between occurrence days (the time-of-day stays fixed) — e.g. "Evening every 2 days". Identified by its anchor scope.

**Modification** — A persisted divergence of a virtual Habit instance from what the template would render, keyed by (flow item, iteration scope). Carries an overridden status, title or blocked reason; a **tombstone** (deleted by the user, lapsed when its iteration passed unfinished, or missed); and per-iteration dependency edges added or suppressed. An instance with no Modification renders purely from the template.

**Commitment** — Something that must be *kept* rather than *done*: an obligation or abstention holding over a window ("asleep by 23:00", "no social media today"). A content node kind alongside Goal and Task, parented anywhere a Task can be, and able to parent Tasks and other Commitments. Unlike a Task it is never completed by acting; it carries a **Verdict** instead of a status, and it is never scheduled, delegated, blocked or depended upon. Recurs by being a Habit's **Instance Type**.

**Expectation** — A wait: something outside your own action that you are waiting on to be released, and may want to monitor (a training run finishing, someone replying). A content node kind parented anywhere a Task can be, holding only Info notes. **Pending** until **Released**, and separately archivable. Tasks can depend on one, and a pending one blocks them; it depends on nothing. Carries a Time Scope and tags like a Task, but no Plan, and an optional **Check every** (a count of days, weeks, months or seasons, from a **Starting** day): while a check is due, a virtual *check task* hangs beneath it, and completing it sets the next one interval after. A **stored** Expectation is created with `Shift+E`; a **spawned** one is the virtual wait derived from an **Asynchronous** Task's template while the Task is done — nothing stores it but an overlay of its own state (released, archived, last check), keyed by the Task and ignored while the wait is not derived. A delegated Task carries a virtual Expectation of its own, released when the Task is done. Not an action item: it is released, never done.

**Verdict** — A Commitment's resolution: `unresolved` · `kept` · `broken`. Always recorded explicitly — neither outcome is ever inferred, from the passage of the window or from the state of the Commitment's children. `unresolved` is the initial value and means only "you have not said".

**Verdict Window** — How long past the end of a Commitment's Time Scope a Verdict may still be recorded. While it lasts the Commitment stays live; once it passes an `unresolved` Commitment is Archived, still unresolved. Expressed as a **Duration** — a count of N of any scope kind — in the same form a Habit's **Gap** and a Time Scope's Duration take, and independent of the Commitment's own scope kind: a monthly commitment may be answerable for two days. Set per Commitment and inherited down the tree like Time Scope; there is no global default. A **commitment Habit** carries one on the flow itself (`flows.verdict_window_n/kind`) and every one of its iterations resolves to that: a virtual iteration has no `commitments` row to carry one, and the flow's Target Node is normally a Project or Domain, which carries none either.

**Backlog** — A Task deliberately set aside: not in play now, kept for later. A stored **Archival** value on Tasks (`Archival::Backlog`), independent of the Task's status, which continues to say where the work stands. Hidden from the Plan and Start presets together with its whole subtree, shown under All, and browsable on its own via the **Backlog** preset. The Task-side counterpart of a Goal's or Project's **Frozen**, but a separate state: neither maps to the other on retype. A Task cannot be both backlogged and planned.

**Agentic** — A Task marked as work that suits being handed to an agent. A stored three-state flag on Tasks (`tasks.agentic`: NULL = inherit, true, false) that **inherits downward and is overridable**, the rule specced for Delegation (not built for Delegation yet — see *Not built yet*): a Task with no value of its own reads its nearest flagged ancestor, and an explicit value — agentic *or* not agentic — replaces it for that Task and its subtree. Inherits *through* kinds that carry no flag (Goal, Project, Domain), and is read only on Tasks. Independent of **Delegation**: the flag says the work suits an agent, a delegate says who holds it, so a Task may be both. Set in the Task editor's Advanced section, badged in both views, and filterable as its own List View pill dimension. Nothing about it dispatches anything.

**Delegate** — Who holds a delegated Task: a **Person**, or the **Agent**. Stored as a `(kind, id)` pair on Tasks (`tasks.delegate_kind` / `delegate_id`) rather than a Person id, so delegating to an agent does not invent a Person; there is one Agent target and it carries no id. Specced to inherit downward and be overridable, whichever kind either end is (not built yet — see *Not built yet*). Independent of **Agentic**: the flag says the work suits an agent, the Delegate says who holds it. Set to the Agent with the one-click **Delegate to agent** button beside the Agentic flag. Nothing about it dispatches anything.

**Asynchronous** — A Task whose doing starts a **wait** rather than finishing something: send the email, order the part, kick off the build. A stored boolean on Tasks (`tasks.asynchronous`, NOT NULL, default false) that **does not inherit** — deliberately unlike **Agentic** — because "starts a wait" is a property of one concrete action, and a subtask of an asynchronous Task is usually the work you do *after* the wait. Tasks only. While the flag is on the Task may carry an optional **Expectation template** (title, tags, a Time Scope rule, Check every; no status); while such a Task is done, a virtual **spawned** Expectation is derived from it. Without a template nothing is spawned. Set from a switch in the Task editor (the template fills the Expectation section below it) and the bare `W` key, badged in both views with an hourglass, filterable as its own List View pill dimension, and the flag the List View's opt-in **Asynchronous first** ordering reads.

**Instance child** — A real node attached to one virtual Habit instance and no other, keyed by the same (instance, iteration scope) pair a **Modification** is. May be anything a Task can parent. Never gates its iteration's resolution — marking the occurrence done while a child is unfinished asks for confirmation instead, and nothing about that is stored. Archives with its occurrence as a unit, and counts as a divergence — so `delete instances and regenerate` removes it.

**Path header** — A List View row's location, rendered once above the contiguous run of rows that share it (`Growth › CODE › ARLESH › Features`). Names every ancestor **not** rendered as a row above the task — always through to the Goal, and including any ancestor Task the active filter hides. Each segment is clickable and **enters** that node as the subtree, the same re-rooting `Ctrl+O` performs. Replaces the former Goal header and its visibility toggle.

**Visible depth** — How far a List View row is indented: the number of its ancestor Tasks that are themselves visible rows under the active filter, not its depth in the tree. The counterpart of the **Path header**, by one rule — the header names every ancestor not rendered above the row, the indentation counts every ancestor that is — so the list never implies a parent that is not on screen.

**Blocker** — A condition that prevents a Task from being acted on. Either an explicit string reason or a virtual block from an unmet dependency.

**Dependency** — A prerequisite relationship from a Task to another Task or Goal. Circular dependencies are rejected at write time.

---

**Gesture** — One thing the user did, and the unit Ctrl+Z reverses. A gesture may span several backend commands: pasting five nodes is five commands and one gesture. Opened and closed explicitly by the caller, and opens **nest and join** — an open inside an open joins the gesture already running rather than starting a second one, so only the outermost close ends it. A gesture that is never opened is simply one command's worth of undo rather than a broken one.

**Undo Journal** — The record of every journaled row change, written by database triggers rather than by the commands themselves, so a command cannot fail to be covered. Each entry carries its gesture, the row before and after, and the **source** of the write.

**Write source** — Who caused a write: the user, or the MCP server. Both are journaled; only the user's enter the Undo Stack.

**Undo Stack / Redo Stack** — The gestures Ctrl+Z will reverse and Ctrl+Shift+Z will reapply. One pair for the whole app, not one per tab or window. Session-scoped: closing Arlesh empties both.

**Tab** — One place in the board you are looking at, held open alongside others. A Tab **owns** everything about a view of the board: its **subtree root**, which View it shows (Mindmap, List or Plan), its branch orientation, the scope kind its Plan View pass fills, its Mindmap filter set and its List View filter set, its selection, its collapsed nodes, the Habit histories it has opened and its pan/zoom. Switching Tabs swaps all of it at once, and nothing a Tab owns is visible to, or changed by, another Tab. What is **app-wide** and shared across every Tab: the theme, the **Clipboard**, the Undo/Redo stacks, the display preferences in the settings popover and in the Plan View's two pane menus, and the board itself. A Tab's name, root, view, orientation, Plan scope kind, both filter sets and opened Habit histories are restored on reopening; its selection, collapsed nodes and pan/zoom are not — those are working state.

**Step** — The node you are standing on plus its direct children: one screenful of the **Steps View**. You **descend** into a card and **climb** back out, and the metaphor is a staircase. Deliberately not *level*, which already means a scope level (day → week → month → season) with "level node" as a concrete thing in Habits. A Step's header card is the node itself, drawn so it can be acted on without leaving the level; at the true root it stands for the whole board and has no node behind it.

**Tab label** — What a Tab is called in the strip: the title of the subtree it is rooted at, or a fixed label for a Tab showing the whole tree. Stored with the Tab rather than looked up, since an inactive Tab has no view mounted to resolve a title; refreshed whenever that Tab is visited.

## Status values

**Task archival:** `live` (Live) · `backlog` (Backlog) — Tasks only; a Task is never manually Archived.

**Goal / Project archival:** `live` (Live) · `frozen` (Frozen) · `archived` (Archived) — `backlog` is never valid here.

**Commitment verdict:** `unresolved` (Unresolved) · `kept` (Kept) · `broken` (Broken)

**Task status:** `todo` (To Do) · `in_progress` (In Progress) · `done` (Done)

**Goal status:** `active` (Active) · `achieved` (Achieved) · `frozen` (Frozen) · `archived` (Archived)

**Project status:** `active` (Active) · `achieved` (Achieved) · `frozen` (Frozen) · `archived` (Archived)

---

## Knowledge Base

**Knowledge Base** — The external Obsidian vault integrated with Arlesh.

**Scope** — A time-range entity (Part of Day / Day / Week / Month / Season, or an Exact window), identified by its value key, a JSON object such as `{"kind":"week","date":"2026-09-20"}`. Scopes are derived, never stored.

**Season** — A three-month period.

**Part of Day** — A sub-day scope: one of Morning, Noon, Afternoon, Evening, Night, Premorning. The smallest *canonical* (calendar-aligned) scope granularity.

**Exact scope** — A scope defined directly by two arbitrary datetimes at minute precision, outside the canonical season/month/week/day/part hierarchy. Always already in datetime-boundary form.

**Time Scope** — An item's *relevance window*: when a Task or Goal is meaningful. Expressed in one of two forms — **Boundaries** (an explicit start and end Scope of the same kind, forming an inclusive range) or **Duration** (a start Scope anchor, defaulting to the current scope, plus a length of N of that kind). Both forms resolve to a concrete inclusive `[start, end]` window. On a standalone item the Duration form is **snapshotted** to a fixed window at save time, while persisting its duration parameters (anchor, N, kind) so views and edits stay duration-shaped; inside a Flow template the Duration/cycle scope stays **relative** and is resolved per-instance against the flow scope. A null Time Scope means **inherit the nearest scoped ancestor's window**; an item is truly **Unscoped** (always relevant) only when no ancestor is scoped. Distinct from a Plan.

**Plan** — The specific Scope a Task is *scheduled into*. Tasks only (Goals have no Plan). Must fall within the task's Time Scope (the same scope or a subscope of it). Replaces the former single `scope_id` semantics of "planning".

**Active** — A Scope is active when it contains the current datetime. A Task/Goal is active when its Time Scope is active; Unscoped items are always active.

**On-exit behavior** — Set when a Task/Goal is given an *explicit* Time Scope (and inherited with the window otherwise): what happens once the item's window passes unfinished — **Archive** (its Resolution reads **Missed** and it is effectively Archived, dropping from the active view) or **Keep** (the item stays, its Resolution **Overdue**). The single-occurrence form of a Habit's Consumption root (Archive = Destructive, Keep = Accumulating).

**Overdue** — A derived state: a *Keep*-on-exit Task/Goal whose Time Scope has fully passed while still unfinished. Computed on read from (scope end, now, status); never stored.

**Lapsed** — A derived state. For a Task, Goal or Commitment it is a **Timing**: the item's window has fully passed, finished or not (an unfinished *Archive*-on-exit item's Resolution is then **Missed**, a *Keep*-on-exit one's **Overdue**). For a Habit iteration it is a status: a Destructive iteration whose window passed unfinished. Computed on read; never stored. Distinct from the deliberate goal **Archived** status (user-declared "no longer relevant").

**Person** — A knowledge-base entity representing a person.

**Event** — A knowledge-base entity representing an event.

**Thread** — A knowledge-base entity representing a concretized train of thought.

---

## Not built yet

Specced, and deliberately kept, but not in the app today. Nothing above depends on them.

- **Delegation**, beyond the **Delegate** itself and the one-click Agent button. No UI picks a Person as a delegate, a Delegate does not inherit down the tree (the specced rule is an override that holds across kinds), and there is no delegate-to or delegated/undelegated filter (when built, both treat the Agent as a delegate like any Person).
- **Tag and knowledge-base-link inheritance in filtering.** A tag filter tests a node's own tags, not its ancestors'. Knowledge-base links (Person, Event, Thread, Scope) have tables but nothing writes them, and nothing filters on them.
- **Obsidian discovery.** People and Threads are not discovered from the vault; they exist only as rows created through the backend.

---

## Invariants

- An Aspect cannot be reparented, renamed, or deleted.
- A Tag cannot parent other Tags.
- Circular Task/Goal dependencies are always rejected.
- Type cycling (Ctrl+Up/Down) follows the valid-type sequence for the node's parent context.
- A Commitment must have an **effective** Time Scope — its own, or inherited from a scoped ancestor. A Commitment with no scoped ancestor at all is rejected; there is no Unscoped Commitment.
- A backlogged Task hides with its whole subtree in Plan and Start, as a Frozen or Archived Project already does.
- A Task is never both backlogged and planned. Backlogging a planned Task asks first and offers to clear the Plan; planning a backlogged Task takes it out of the Backlog.
- A forced **Archived** Resolution overrides a stored **Frozen** *or* **Backlog**, flagging the conflict either way — setting an item aside does not exempt it from its own window.
- A Habit instance is never materialized by being diverged from. A per-instance child is recorded against the virtual instance; the instance stays virtual (ADR 0002).
- An iteration is resolved when every one of its non-tombstoned instances is done. **Instance children** are not instances and never gate resolution; completing an occurrence over an unfinished child asks for confirmation instead.
- A List View row's **Path header** and its **Visible depth** partition its ancestors: every ancestor is named in exactly one of the two, never both and never neither.
- A Commitment's Verdict is never derived. Neither its children nor the passing of its window ever sets it.
- A Commitment's **Verdict Window** is the only automatic state change in the kind, and it moves **Archival**, never the Verdict: an unresolved Commitment whose window has run out archives *still unresolved*.
- **Plan** shows `broken` Commitments whose window is still open, and not `kept` ones — a commitment already broken today is a live problem until the window closes, where a kept one is settled. This mirrors no Task rule.
- A Commitment takes no part in the dependency graph, in either direction, and has no Plan, no delegate and no block reasons.
- Only a Task carries **Agentic**, and it is independent of the delegate: a Task may be agentic, delegated, both or neither. An explicit value always beats an inherited one, in either direction.
- Only a Task carries **Asynchronous** (and its optional Expectation template), and it stops at the Task it is set on: a child of an asynchronous Task is not itself asynchronous. It is independent of every other flag on the Task.
- Scope containment is evaluated on **resolved datetime boundaries** (interval containment), so it holds uniformly across canonical, exact, and multi-scope-kind windows. Scope X is "within" scope F iff X's window ⊆ F's window.
- A child item's explicit Time Scope must be **wholly contained** within its parent's Time Scope.
- A Task's Plan must be wholly contained within that task's Time Scope, and within its parent's Plan.
- Filtering by a scope returns every item whose scope is wholly contained within it.
- Flow/Habit instances (real copies and virtual instances) must satisfy containment against their **Target Node's** Time Scope. The target picker only offers scope-valid targets; editing the scope of an item that has flow children prompts the user to reconcile one side or the other.
- A Gesture is the unit of undo, never a command. Two commands inside one gesture are undone together or not at all.
- Only writes whose **source** is the user enter the Undo Stack. An MCP write is journaled and never undoable — Ctrl+Z reverses what the user did, never what an agent did.
- A write made with no Gesture open is journaled **ungrouped** and is never offered as an undo step. Forgetting to open a Gesture makes a change un-undoable; it never makes Ctrl+Z reverse a different one.
- Applying an undo or a redo is itself a write, and is never journaled. The stacks are the only record that it happened.
- Derived and materialized rows are not journaled. Undoing a gesture must not fight the code that regenerates them.
- There is one Undo Stack for the whole app. One board, one history of changes to it.
- A Tab's state is reachable only through that Tab. No action in one Tab changes the subtree root, view, filters, selection, collapsed set or viewport of another.
- The Clipboard and the theme are never per-Tab. Cutting in one Tab and pasting in another is the point of having two.
- There is always at least one Tab. The gesture that would close the last one closes the window instead.
- A restored subtree root whose node no longer exists falls back to the true root rather than leaving a Tab rooted at nothing.
