# Arlesh — Domain Glossary

Canonical terms used throughout Arlesh. Code, translation keys, and documentation must use these names consistently.

---

## Entities

**Aspect** — One of six built-in, color-coded top-level life-area containers (Red, Purple, Green, Blue, Gray, Steel). Fixed roots of the domain tree; not user-managed.

**Project** — A large organizational domain (hobby, habit, workplace, etc.) parented under an Aspect or another Project. May link to an Obsidian knowledge-base directory.

**Domain** — A general-purpose organizational container. Can parent Goals, Tasks, Tags, or other Domains.

**Tag** — A flat leaf node used as a resource marker. Each Tag belongs to a Domain parent. Tags cannot parent other Tags.

**Goal** — A desired state. Parented under a Project, Domain, or another Goal. Can have sub-goals.

**Task** — An action item. Parented under a Project, Domain, Goal, or another Task.

**Flow** — A template for a Goal/Task subtree, materialized on demand. A new node kind. Has a title, an **Instance Type** (goal or task), a **Target Node**, and a **Flow Window**. May be parented under an Aspect, Domain, Project, or Goal.

**Flow Window** — A Flow's own relevance window, resolved against the start anchor at materialization. Two forms: a **Span** — a coarse Duration of N of a scope kind (`day`/`week`/`month`/`season`), a relative *length* — or a **Phase** — a sub-day, fixed *time-of-day*: a part-of-day band (e.g. Evening) or an exact `HH:MM–HH:MM` clock range, carried date-free on the template and combined with the anchor's date on start. A Habit whose window is a Phase recurs at that fixed time-of-day, stepping whole days by its Gap ("10:00–12:00 daily", "Evening every 2 days").

**Instance Type** — Whether a Flow materializes its root (and constrains its children) as a Goal or a Task.

**Target Node** — The default node under which a Flow's instances are created. Overridable when starting the Flow.

**Flow instance** — The result of starting a plain (non-habit) Flow: a real, persistent, independent Goal/Task subtree copied under the target. Retains a stored link to its originating Flow used only as a UI indicator (no cascading edits). Habit instances differ — they are virtual (see Habit). Dependencies declared between flow items are **remapped per instance/iteration** (Implement waits on this instance's Specify, not the template's); cross-iteration dependencies are not auto-created.

**Flow item** — A child of a Flow (a flow task or flow goal). Like a normal Task/Goal but additionally carries one or more **Cycle Scope** / **Cycle Plan** pairs (see those terms).

**Cycle Scope** — A flow item's *relative* relevance window, expressed as the Nth subscope of the flow scope (a scope kind lower than the flow's), e.g. "3rd day of the 2-week flow scope." Null means the whole flow scope. Resolved to a concrete Time Scope when the flow is started.

**Cycle Plan** — A flow item's *relative* Plan within its Cycle Scope (e.g. the morning of that day). Resolved to a concrete Plan on flow start. A flow item may hold multiple (Cycle Scope, Cycle Plan) pairs; each pair materializes a separate item per start/iteration.

**Habit** — A Flow with a Recurrence pattern. Its instances are generated automatically per iteration and are **virtual**: each is identified by (flow item, iteration scope), rendered from the template, with only divergences (status, edits, dependencies, deletion/archival tombstones) persisted as **Modification** rows. A Habit can be **Archived** (stops recurring; existing occurrences survive).

**Recurrence** — A Habit's pattern, composed of **Repetition** (a Start anchor, an optional Gap of N of a scope kind ≥ the habit scope, and an optional end) and **Consumption** (see below).

**Consumption** — A Habit's per-habit configuration for how unfinished instances are treated as iterations pass; the recurring form of a scoped item's **On-exit behavior**. A configurable tree: (1) **Destructive vs Accumulating** — do unfinished instances **lapse** (Archive-on-exit) when their iteration passes, or do they survive (Keep)? (2) if Accumulating, **Overlapping vs Blocking** — are new iterations generated while unresolved instances exist, or withheld? (3) if Blocking, **Catch-up policy** when the open iteration is completed — generate *all pending* missed iterations in order, only the *next* iteration (advance by one), or jump to the *latest* (current) iteration while recording the skipped intermediate iterations as missed tombstones (for streak/history).

**Iteration** — One concrete occurrence window of a Habit, anchored from the Repetition Start plus accumulated flow-scope-and-gap steps. For a **Span** window each iteration occupies one flow window and the Gap is the idle span between one window's end and the next's start, snapped to the canonical scope. For a **Phase** window each iteration is the fixed band/time on its anchor day and the Gap is the whole-day stride between occurrence days (the time-of-day stays fixed) — e.g. "Evening every 2 days". Identified by its anchor scope.

**Modification** — A persisted divergence of a virtual Habit instance from what the template would render, keyed by (flow item, iteration scope). Carries an overridden status, title, or blocked reason; a **tombstone** (deleted by the user, lapsed when its iteration passed unfinished, or missed when catch-up skipped it); and per-iteration dependency edges added or suppressed. An instance with no Modification renders purely from the template.

**Blocker** — A condition that prevents a Task from being acted on. Either an explicit string reason or a virtual block from an unmet dependency.

**Dependency** — A prerequisite relationship from a Task to another Task or Goal. Circular dependencies are rejected at write time.

---

## Status values

**Task status:** `todo` (To Do / פתוח) · `in_progress` (In Progress / בתהליך) · `done` (Done / בוצע)

**Goal status:** `active` (Active / פעיל) · `achieved` (Achieved / הושלם) · `frozen` (Frozen / מוקפא) · `archived` (Archived / בוידעם)

**Project status:** `active` (Active / פעיל) · `paused` (Paused / מושהה) · `completed` (Completed / הושלם) · `archived` (Archived / בוידעם)

---

## Knowledge Base

**Knowledge Base** — The external Obsidian vault integrated with Arlesh.

**Scope** — A time-range entity (Part of Day / Day / Week / Month / Season) lazily instantiated on first reference.

**Season** — A three-month period.

**Part of Day** — A sub-day scope: one of Morning, Noon, Afternoon, Evening, Night, Premorning. The smallest *canonical* (calendar-aligned) scope granularity.

**Exact scope** — A scope defined directly by two arbitrary datetimes at minute precision, outside the canonical season/month/week/day/part hierarchy. Always already in datetime-boundary form.

**Time Scope** — An item's *relevance window*: when a Task or Goal is meaningful. Expressed in one of two forms — **Boundaries** (an explicit start and end Scope of the same kind, forming an inclusive range) or **Duration** (a start Scope anchor, defaulting to the current scope, plus a length of N of that kind). Both forms resolve to a concrete inclusive `[start, end]` window. On a standalone item the Duration form is **snapshotted** to a fixed window at save time, while persisting its duration parameters (anchor, N, kind) so views and edits stay duration-shaped; inside a Flow template the Duration/cycle scope stays **relative** and is resolved per-instance against the flow scope. A null Time Scope means **inherit the nearest scoped ancestor's window**; an item is truly **Unscoped** (always relevant) only when no ancestor is scoped. Distinct from a Plan.

**Plan** — The specific Scope a Task is *scheduled into*. Tasks only (Goals have no Plan). Must fall within the task's Time Scope (the same scope or a subscope of it). Replaces the former single `scope_id` semantics of "planning".

**Active** — A Scope is active when it contains the current datetime. A Task/Goal is active when its Time Scope is active; Unscoped items are always active.

**On-exit behavior** — Set when a Task/Goal is given an *explicit* Time Scope (and inherited with the window otherwise): what happens once the item's window passes unfinished — **Archive** (the item **Lapses**, dropping from the active view) or **Keep** (the item stays, flagged **Overdue**). The single-occurrence form of a Habit's Consumption root (Archive = Destructive, Keep = Accumulating).

**Overdue** — A derived state: a *Keep*-on-exit Task/Goal whose Time Scope has fully passed while still unfinished. Computed on read from (scope end, now, status); never stored.

**Lapsed** — A derived state: an *Archive*-on-exit Task/Goal — or a Destructive Habit iteration — whose window has fully passed while still unfinished. Computed on read; never stored. Distinct from the deliberate goal **Archived** status (user-declared "no longer relevant").

**Person** — A knowledge-base entity representing a person.

**Event** — A knowledge-base entity representing an event.

**Thread** — A knowledge-base entity representing a concretized train of thought.

---

## Invariants

- An Aspect cannot be reparented, renamed, or deleted.
- A Tag cannot parent other Tags.
- A Goal cannot be the parent of a Task that already has another Goal parent elsewhere in the tree.
- Circular Task/Goal dependencies are always rejected.
- Type cycling (Ctrl+Up/Down) follows the valid-type sequence for the node's parent context.
- Scope containment is evaluated on **resolved datetime boundaries** (interval containment), so it holds uniformly across canonical, exact, and multi-scope-kind windows. Scope X is "within" scope F iff X's window ⊆ F's window.
- A child item's explicit Time Scope must be **wholly contained** within its parent's Time Scope.
- A Task's Plan must be wholly contained within that task's Time Scope, and within its parent's Plan.
- Filtering by a scope returns every item whose scope is wholly contained within it.
- Flow/Habit instances (real copies and virtual instances) must satisfy containment against their **Target Node's** Time Scope. The target picker only offers scope-valid targets; editing the scope of an item that has flow children prompts the user to reconcile one side or the other.
