# Resources

*One area of the [Arlesh design specification](../../SPEC.md).*

## Domains

Domains are organizational containers for Tasks and Goals. A Domain has a title, description, and a nullable parent Domain.

There are four domain subtypes:

**Aspects** — six built-in, color-coded top-level domains. Not user-managed. Fixed roots of the domain tree.

| Name   | Color      | Focus                                                                 |
|--------|------------|-----------------------------------------------------------------------|
| Red    | Red        | Physical needs: health, physical pursuits                             |
| Purple | Purple     | Psychological needs: social activities                                |
| Green  | Green      | Fulfillment needs: hobbies, knowledge, creative/technical construction|
| Blue   | Blue       | Moral duty: activities for others, social activism                    |
| Gray   | Gray       | Flow-state needs: finance, cleaning, bureaucracy                      |
| Steel  | Light gray | Self-determination: introspection, goal-making, task management       |

**Projects** — large domains (hobby, habit, workplace, etc.). Parent must be an Aspect or another Project. May be linked to a knowledge-base directory. Status: **Active / Achieved / Frozen / Archived**. May carry a **beads id** (see *Beads id* below).

**Domains** — general-purpose organizational containers. Can parent Goals, Tasks, Tags, or other Domains.

**Tags** — flat leaf nodes used as resource markers. Each Tag has a title and a `domain_id` parent. Tags cannot parent other Tags. Tags appear in filtering as a first-class primitive.

## Knowledge Base

The knowledge base is externally managed (Obsidian). Arlesh manages specific note types as structured entities.

**People** — represent persons. Fields: name (= note title), aliases (list of strings), linked note. Person notes are discovered by recursively searching configured directories.

**Scopes** — time range entities. Not manually created; lazily instantiated on first reference and stored as rows. Canonical kinds:

| Kind        | Definition                                      |
|-------------|-------------------------------------------------|
| Season      | Three-month period (Autumn: Sep–Nov, Winter: Dec–Feb, Spring: Mar–May, Summer: Jun–Aug) |
| Month       | Calendar month                                  |
| Week        | Sunday–Saturday, custom 1–52 numbering (not ISO 8601) |
| Day         | Single date; corresponds to an Obsidian note at `{yyyy}/{mm MMMM}/{yyyy-mm-dd}.md` |
| Part of Day | Sub-day band: Morning (06–12), Noon (12–15), Afternoon (15–18), Evening (18–22), Night (22–02), Premorning (02–06). Start inclusive, end exclusive. |

Beyond the canonical hierarchy, an **Exact** scope is defined by two arbitrary datetimes at minute precision (e.g. for a one-off deadline).

Canonical scope containment is hierarchical: Part of Day ⊂ Day ⊂ Week ⊂ Month ⊂ Season. **Night (22:00–02:00) crosses midnight and is parented to the Day it starts on.** Every scope resolves to concrete datetime boundaries (a cached backend function does the resolution); Parts of Day and Exact scopes carry a time-of-day component.

A scope is **active** when it contains the current datetime.

**Containment-based filtering** is evaluated as interval containment on resolved datetime boundaries: filtering by a scope returns every item whose own scope window is wholly contained within it. This works uniformly for canonical, multi-week, and exact scopes. (Denormalized `week_id`/`month_id`/`season_id` may remain as a canonical-vs-canonical optimization.)

**Events** — represent events. Fields: datetime or scope, title, optional linked note.

**Threads** — concretized trains of thought. Fields: title, linked note. Discovered by recursively searching configured directories.

## Goals

Goals represent desired states. Fields: title, parent (Project / Goal / Domain), tags (list), KB resource links (People, Events, Threads, Scopes), status, blockers, beads id.

**Status:** Active / Achieved / Frozen / Archived

Goals are never List View *rows*; they appear instead as a segment of a row's **path header** there (see [*List View*](list-view.md)). (Commitments are not rows either — they get their own section above them; see [*List View*](list-view.md).) Goals can be depended on by Tasks; a Goal-dependency blocks a Task until the Goal is Achieved.

## Tasks

Tasks represent action items. Fields: title, parent (Project / Goal / Domain / Task), tags (list), KB resource links, status, blockers, dependencies, delegation, agentic, beads id.

**Status:** To Do / In Progress / Done

**Blockers:** A Task (and a Goal) can carry an **ordered list of explicit block reasons**, edited in its editor (add / remove / reorder rows). A Task is **additionally** blocked *virtually* by any dependency on a non-Done Task or non-Achieved Goal, with reason `"Blocked by {kind} {id} ({title})"`. The two combine: a Task/Goal reads as **blocked** on the canvas (red stop-sign) when it has **any** reason — explicit or virtual. Explicit reasons live in their own `block_reasons` table (polymorphic `owner_type`/`owner_id`, ordered by `position`); virtual reasons are derived at read time from the dependency edges, never stored. Cross-table type conversion copies the explicit reasons to the new node.

**Dependencies:** Tasks can depend on other Tasks or Goals. Circular dependencies are rejected at write time.

**Delegation:** A Task can be delegated to a Person.

**Agentic:** A Task can be marked **Agentic** — work that suits being handed to an agent. It is a stored three-state flag (`agentic` — NULL / true / false), not a boolean, because it **inherits downward and is overridable**, exactly as Delegation does: a Task with no value of its own reads its nearest flagged ancestor, so marking a whole branch is one edit, and an explicit value replaces what would have been inherited — including an explicit **not agentic**, which is how one Task comes back out of an agentic branch. The value inherits *through* Goals, Projects and Domains, which carry no flag of their own.

It is **Tasks only**: an agent performs actions, where a Goal is a desired state and a Commitment is kept rather than done. It is also **independent of Delegation** — the flag says the work suits an agent, a delegate says who holds it, so a Task may be both, either or neither, and the delegated/undelegated filter is untouched by it. Set from the **Advanced** section of the Task editor (Inherit / Agentic / Not agentic, with the Advanced section opening on arrival when the Task carries an explicit value), and from the bare **A** binding in the Mindmap and List View, which is a **two-state toggle over the resolved value**, not a cycle through the stored one: it reads what the Task currently *reads as* and writes the opposite — agentic → explicit *Not agentic*, anything else → explicit *Agentic*. The flag stores three states but a Task only ever shows two, and *Inherit* under a non-agentic parent is the same picture as an explicit *Not agentic*, so a cycle spent a press moving between them with nothing on screen to show for it — marking a fresh Task agentic appeared to take two presses. The consequence is deliberate: **the key can no longer return a Task to *Inherit***, which is an editor-only state, and a press on a Task that was merely inheriting *yes* pins it to an explicit *no*. That is the price of no press being invisible. Creating a sibling with `Shift+Enter` carries over the source Task's **own stored** value, explicit or not-set — the stored column, never the resolved one, since freezing an inherited *yes* into an explicit one would silently cut the new Task off from the ancestor deciding for it, which the ordinary downward rule already covers. It is shown as its own **status-row badge** in both views, on a Task that reads as agentic whether it said so itself or inherited it; and filterable as its own List View pill dimension. Retyping a Task to any other kind drops an explicit flag and names it in the confirmation prompt alongside every other lost field; duplicating a Task copies it, all three states alike. A one-click **delegate** button belongs beside the flag once Delegation can point at an Agent rather than only a Person; the slot is left for it and nothing about this dispatches anything.

**Time Scope & Plan:** A Task carries a **Time Scope** (relevance window) and an optional **Plan** (a single scope it is scheduled into). Goals carry a Time Scope but no Plan. See [*Time Scopes & Planning*](time-scopes.md).

**Backlog:** A Task may be put in the **Backlog** — deliberately set aside, not in play now, kept for later. It is the Task-side answer to what **Frozen** already does for a Goal or Project, and it is a stored **Archival** value (`live` / `backlog`) rather than a fourth status: status keeps meaning *where the work stands*, Archival *whether it is in play at all*, so a backlogged Task that was In Progress still says so when it is pulled back, and the Enter status cycle is untouched. **Frozen** stays Goals/Projects-only and **Backlog** Tasks-only; they are separate states and neither maps to the other on retype (a Frozen Goal retyped to a Task arrives as a plain To Do Task, as before; a backlogged Task retyped to any other kind comes back into play, and the dropped Backlog is named in the retype confirmation prompt alongside every other lost field — see [*Retyping (backend)*](mindmap-view.md)). A backlogged Task is hidden from **Plan** and **Start** together with its whole subtree, shown under **All**, browsable on its own through the **Backlog** preset, and marked with its own status-row badge (not the Frozen snowflake). It is set and cleared from two places that mean exactly the same thing: a **Backlog** switch in the **Task editor**, as a switch rather than a status pill, since it is a separate axis from where the work stands — a backlogged Task keeps whatever status it had; and the bare **B** binding in the Mindmap and List View. The Goal editor has no such control and never gains one: a Goal is set aside by its own **Frozen** status. Backlog is deliberately *not* protective: a scoped backlogged Task whose window lapses unfinished still resolves **Missed** and archives, flagged as a conflict — see [*On-exit behavior*](time-scopes.md).

**Invariant: a Task is never both backlogged and planned.** Enforced at write time, asymmetrically, because the two directions differ in how much they throw away: backlogging a Task that has a Plan is **refused pending confirmation**, prompting with the option to clear the Plan and backlog in one action (declining leaves both untouched); setting a Plan on a backlogged Task simply takes it out of the Backlog, with no prompt — the gesture is unambiguous — and raises a **toast**, so the change is never silent.

A Task's **goal**, **project**, and **aspect** are resolved as the nearest ancestor of each type.

## Commitments

Commitments represent things that must be **kept** rather than **done**: an obligation or an abstention held over a window — "asleep by 23:00", "no social media today". Fields: title, parent (Project / Goal / Domain / Task / Commitment), Time Scope, **Verdict**, **Verdict Window**, tags (list), KB resource links, privacy, beads id.

A Commitment is its own content node kind, not a flag on Task, because its resolution runs the opposite way round: a Task untouched when its window closes is **Missed**, whereas a Commitment untouched may well have been **Kept**. A Goal is no better a home — it can be Achieved, Frozen or Archived, but has no vocabulary for having been *broken*, which is the single most important thing this kind has to record. See `docs/adr/0005-commitment-node-kind.md`.

**Verdict:** Unresolved / Kept / Broken. **Never derived** — not from the window passing, not from children completing. `unresolved` means only *you have not said*, which is real information that any defaulted verdict would destroy. Finishing every child Task of a Commitment therefore does **not** mark it Kept: credit is for the outcome, not for the sub-steps. Children's progress shows beside the verdict as a hint, and nothing more. A polarity field (abstentions default Kept, obligations default Broken) was considered and rejected on exactly this ground.

**Verdict Window:** how long past the end of its Time Scope a Commitment stays answerable — a **Duration**, a count of N of any scope kind, in the same `(n, kind)` form a Habit's **Gap** and a Time Scope's Duration take. Its kind is independent of the Commitment's own window, so a monthly commitment can be answerable for two days and a daily one for a week. Null inherits the nearest ancestor Commitment that sets one; nothing above setting one means it never expires, and there is no global default. Once `window end + N × kind` has passed with the Verdict still `unresolved`, the Commitment's effective **Archival** becomes **Archived** — still unresolved. **This is the only automatic state change in the kind, and it moves Archival, never the Verdict:** not having judged something is itself part of the record, and it stays visible under **All**.

**Lifecycle.** **Timing** (Pending / Active / Lapsed) reads the window alone, as for every other kind. **Resolution** is replaced by the Verdict. **Archival** is Live until either a verdict is recorded *and* the window has passed (the commitment is settled), or the Verdict Window runs out unresolved. There is no per-node On-exit behavior: a Commitment always Keeps, and the Verdict Window is what eventually ends that.

**Required scope.** A Commitment must have an **effective** Time Scope — its own, or inherited from a scoped ancestor. It is the first kind in the model for which being **Unscoped** is invalid rather than merely always-active: a rule held over no window has nothing to be kept or broken over, so one with no scoped ancestor at all is refused at write time. Inheritance is what makes this liveable — several of tonight's commitments sit under one scoped parent without repeating the window on each.

The rule is enforced at write time, but it is **not** enforced by hiding the option: Commitment stays in the `Ctrl+↑/↓` cycle whether or not a window is in reach, because an option that silently is not there reads as a missing feature rather than as a rule. The refusal is instead put to the user as a question — pick a window for it, or cancel — raised off the backend's refusal rather than predicted in the frontend, so a node that already inherits a window is never asked for one it has. The window chosen in answer rides on the `retype_node` call itself rather than being written to the source node first, so the conversion stays one atomic write: cancelling leaves the node exactly as it was, and there is no half-retyped state to recover from.

**Children and the graph.** A Commitment holds Tasks (the supporting steps: "phone on charger", "set alarm") and other Commitments ("no social media this month" containing each day's), with the usual containment rule between a parent Commitment's window and a child's. It holds no Goals. It is **never scheduled** (the window *is* the commitment, so there is no Plan), and takes **no part in the dependency graph in either direction** — nothing gates it and it gates nothing. It is neither delegable nor blockable.

**Recurrence** rides the existing Flow/Habit machinery rather than a second engine: a Flow's **Instance Type** extends from `goal | task` to `goal | task | commitment`, so a nightly "asleep by 23:00" gets Recurrence, Iteration and catch-up as they already are, and each night's verdict is a Modification row keyed by `(flow item, iteration scope)`. Consumption is fixed to Accumulating + Overlapping for commitment habits — **refused at write time**, not merely documented — because the Verdict Window is the bounding mechanism instead: under Destructive a passed iteration classifies **Lapsed**, a derived "went unfinished" the kind forbids, and under Blocking one unanswered night would withhold every night after it. The Habit's Verdict Window lives on the flow row (`verdict_window_n`/`verdict_window_kind`, migration `0028`), because a virtual iteration has no Commitment row to carry one and the Target Node is normally a Project or Domain, which carries none either. It is set in the flow editor, which offers the field only for a commitment Instance Type and clears it when the flow stops being one — a window on a goal or task Habit would be a value nothing ever reads. A commitment flow likewise has no **root Cycle Plan**: the window *is* the commitment, so there is nothing to schedule it into. An iteration whose Verdict Window has run out with no verdict recorded derives as **Expired**: archived, still unresolved, and never Missed. A commitment flow holds **no goal items** — a Commitment cannot parent a Goal, so such a template would derive no iterations at all: `Ctrl+↑/↓` does not offer `flow_goal` on one, `create_flow_goal` refuses it, and a flow that already holds goal items is refused the switch to `commitment` rather than being allowed into that state and told about it afterwards.

**Retype.** Commitment joins the `Ctrl+↑/↓` cycle immediately after Task, and goes through the same atomic `retype_node` path as every other kind. Nothing translates between a status and a Verdict in either direction — `done` is not `kept` — so a non-default status is reported as lost on the way in and a recorded verdict on the way out, through the existing confirmation prompt. Title, position, privacy, tags, Time Scope and the beads id carry across.

## Beads id

A Task, Goal, Commitment or Project may carry an optional **beads id** — the identifier of the issue tracking it in `bd` (beads), e.g. `Arlesh-5fs`. It is a mirror of an id `bd` owns, not a value this app authors, and so is **write-restricted**:

- The **MCP server is the only source**. Each resource operator exposes a single setter (`set_beads_id`); `UpdateTaskRequest` / `UpdateGoalRequest` / `UpdateDomainRequest` have no field for it, and no gesture can **author or edit** a beads id from the UI. Two named exceptions write the column from the UI side, and neither can produce a value `bd` did not issue.
- **Exception one: duplication.** Copy+Paste's `duplicate_*` commands *propagate* the id a node already carries onto its copy — only ever a value `bd` issued and the source already had. A source with no link produces a copy with no link. The accepted consequence is that two nodes can show the same issue id, and `bd` holds no record of the second.
- **Exception two: clearing.** Authoring and editing need a value the UI has no way to obtain; **dropping** a link needs none, and a link to a closed, wrong or duplicated issue otherwise has to go back through MCP to remove. One dedicated command, `clear_beads_id(node_type, node_id)`, writes null and nothing else — mirroring the MCP tool's shape rather than adding a field to any update request, and called by the editor's **Save** rather than by the × itself. Only `task`, `goal`, `commitment` and `project` are accepted, and a Domain that is not a Project is refused as it is on the way in. Nothing is told to `bd`: the issue is untouched, and this only removes Arlesh's mirror of the link.
- Every read that returns a Task, Goal or Domain carries it.
- The UI shows it **read-only but for its ×, only where it is set** — as the **Issue** row in the Task, Goal, Commitment and Project editors, directly under the title. A node with no beads id shows no row at all: no label, no placeholder.
- The **×** takes no confirmation dialog, but it does not write either: it **stages** the clear, which **Save** performs and Cancel, Escape or closing the editor discard along with every other unsaved field. An earlier draft had it write straight through, on the reasoning that one nullable column is not worth a confirmation and `Ctrl+Z` puts the link back anyway. That was revised in use: the argument was about *confirmation*, and it silently answered a second question — whether this one field escapes the form the other fields are held in. It should not. Cancel means nothing was written, and a field that ignores it is worse than a field that asks.
- The clear is sent **before** the update it is saved with, so a refused clear leaves the node exactly as it was rather than half-saved, and the refusal appears on the editor's own error line with the editor still open. A clear that lands and an update that is then refused is the reverse case: the link is gone, the edits are not, the error says so, and `Ctrl+Z` reverses the clear. The clear is a Gesture of its own, so a save that also clears is two `Ctrl+Z`s — as a save that also retags or re-links is already several.
- The row **stays, greyed and without its ×, for the life of the editor** rather than vanishing: a dialog that reflows under the pointer hides the very thing it is reporting. Greyed means *staged*, not *gone*. Reopening the editor after the save shows no row, which is the steady state.

The column lives on `domains` for the Project case, but only the `project` subtype is given one and only a Project surfaces it; Aspects, Domains and Tags leave it null.

---
