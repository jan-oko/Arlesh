# Phase 4 — `retype_node`

All three tasks (4.1, 4.2, 4.3) are done. The live data-loss bug the scan confirmed is fixed:
retyping is one atomic backend call that carries everything the new kind can hold, repoints every
reference aimed at the node, and refuses — naming each casualty — rather than dropping anything
quietly.

Commits:

| SHA | Task |
|---|---|
| `771ede5` | 4.1 — the pure transfer plan |
| `8e26513` | 4.2 — the atomic command |
| (this) | 4.3 — the frontend collapse, CHANGELOG, this report |

---

## Scope, and where I drew the line

The brief's 4.1 names "goal→task, task→goal, and the domain-table pairs". I implemented exactly
that set of kinds: **goal, task, domain, project, tag**. `info` and the flow items are *not*
covered by `retype_node`, and their branches stay in the frontend:

- **Flow items** (`flow_goal` ↔ `flow_task`) already had an atomic backend command,
  `convert_flow_item`, and `flows/` was off-limits this phase.
- **Info nodes**. An info's parent link is polymorphic across all five retypeable kinds plus
  itself, and an info carries a field (`details`) the other kinds have no counterpart for — so
  bringing it in is a real extension of the transfer table, not a line of glue. The brief never
  names it, and I judged adding it worse value than doing the named set properly. **It is the one
  place a retype can still drop something quietly: `info.details` vanishes on info→goal/task, and
  the `→ info` branch still deletes non-info children through a loop of separate calls.** That is
  a known remaining gap, not an oversight.

Consequently 4.3 is a collapse, not a deletion: `retypeNode`'s body went from **260 lines to
143**, the removed 117 being every branch `retype_node` now owns. What remains is the flow-item
path and the two info paths.

---

## The transfer table I implemented

Source columns, and what each target does with them. **carry** = written onto the new row;
**lost** = reported in `details` and destroyed on confirmation; **n/a** = the source kind has no
such column.

| Field | → Goal | → Task | → Project | → Domain | → Tag |
|---|---|---|---|---|---|
| `title` | carry | carry | carry | carry | carry |
| `position` | carry | carry | carry | carry | carry |
| `is_private` | **carry** | **carry** | **carry** | **carry** | **carry** |
| `status` | carry (mapped) | carry (mapped) | carry (mapped) | lost | lost |
| `time_scope` (4 cols) | carry | carry | lost | lost | lost |
| `on_scope_exit` | carry | carry | lost | lost | lost |
| `plan` | lost | carry | lost | lost | lost |
| `delegate_to` | lost | carry | lost | lost | lost |
| `description` | lost | lost | carry | carry | carry |
| `knowledge_base_directory` | lost | lost | carry | lost | lost |
| tags (`tags_on_*`) | carry | carry | lost | lost | lost |
| block reasons | carry | carry | lost | lost | lost |
| inbound dependency edges | **repointed** | **repointed** | lost | lost | lost |
| outbound dependency edges | lost | carry | lost | lost | lost |

Status mapping, both ways, mirroring `src/utils/status-mapping.ts` so the frontend's preview toast
cannot disagree with what the backend then writes:

- goal/project vocabulary → task: `achieved` → `done`, everything else → `todo`.
- task → goal/project vocabulary: `done` → `achieved`, `blocked` → `frozen`, else `active`.
  (`blocked` is not one of the three values the `tasks` CHECK allows, so that arm is unreachable
  from stored data. Kept for parity, with a comment saying so.)
- goal ↔ project: identity — they speak the same four-value vocabulary.

Child nesting (which children each target can hold) mirrors `ALLOWED_CHILD_KINDS` in
`src/utils/node-meta.ts`, which is the same product rule read from the other end: the context menu
uses it to *hide* a retype that would strand a child, and `tasks::retype` uses it to *name* the
ones a keyboard cycle strands anyway. The duplication is deliberate and cross-referenced in both
files' comments.

### Two rules I added that the brief did not specify

1. **A status still at its kind's default is not a loss.** Every goal is born `active` and every
   task `todo`; calling the disappearance of an untouched default a "loss" would prompt on
   essentially every goal→domain conversion for no information. Only a status somebody chose is
   reported. Tested (`a_status_still_at_its_default_is_not_reported_as_lost`).
2. **A retype inside the `domains` table loses no fields at all.** It is a `subtype` UPDATE on one
   row: nothing is deleted, the `knowledge_base_directory` column keeps its value when a Project
   becomes a Domain, and converting back restores it. Reporting it as lost would be false. Only
   stranded children are at stake there. Tested both ways
   (`a_project_becoming_a_domain_keeps_every_field_because_no_row_is_rewritten` vs
   `a_project_becoming_a_goal_does_lose_its_obsidian_directory`).

### Where I disagree with the scan

The scan's field audit is correct on every column it lists. Three corrections and three additions:

| | |
|---|---|
| **Correct, but the line numbers moved again.** | `retypeNode` was at `:794`–`:1053` when scanned; it was at **`:798`** when I started (the file changed between the scan and the brief). The `console.warn` pair was at `:863`/`:879` in the scan and **`:867`/`:883`** by the time I read it. Both are now deleted. |
| **`CreateTaskRequest` does not have `is_private`.** | The scan says "`createTask`'s `CreateTaskRequest` supports `is_private?: boolean` (`src/api/tasks.ts:44`)". It does not — neither the TypeScript interface nor the Rust struct has the field, and `create_task` cannot set it. This does not change the verdict (privacy was dropped, and now carries) but it changes *how*: `create_node` has to follow the insert with an `update_*` call for `position` **and** `is_private`, because `CreateTaskRequest`/`CreateGoalRequest` carry neither. |
| **The KB-link loss the scan flags as "adjacent and worth flagging" is not real.** | `goal_knowledge_base_links` / `task_knowledge_base_links` are dead tables: `grep -rn knowledge_base_links src-tauri/src/ src/` returns **nothing**. No code writes them, so no row exists to lose. I did not carry them. If they are ever populated, `carry_attachments` is where they belong. |
| **Addition: a flow child is silently orphaned today, and the scan does not mention it.** | `flows.parent_type` is `CHECK (parent_type IN ('aspect','project','domain','goal'))` — **not `task`**. The old goal→task branch had no `flow` arm at all (not even the `console.warn`), so retyping a Goal that roots a Flow into a Task left the `flows` row pointing at a deleted goal id, with the same id-reuse amplification as the dependency edges. `retype_node` now reports the flow child as stranded and reparents or deletes it. |
| **Addition: outbound dependencies are lost too.** | The scan covers rows where the node is the *target*. Rows where it is the *owner* (`task_dependencies.task_id`) cascade away with the task row, so a task→goal retype silently forgets everything the task was waiting on. Now counted and reported as `dependencies`. |
| **Addition: a same-table retype can strand a child.** | `updateDomain(id, { subtype })` is one call and looks safe, but a Project with a Project child becoming a Domain leaves an invalid nesting (a Project needs an Aspect or Project above it), and a Domain with any structural child becoming a Tag leaves a Tag holding children it may not have. The old path did neither check nor repair. Now reported and settled. |

---

## Every inbound reference repointed, and how I found them all

The only one that needed repointing for the kinds in scope is **`task_dependencies.dependency_id`**
(with its `dependency_type` discriminator). It is repointed onto the new node when the target is a
goal or a task, and deleted outright when it is not — a project, domain or tag cannot be depended
on, so there is nowhere to aim the edge, and leaving it is exactly the failure mode being fixed.

How I established the list, rather than trusting one:

1. Took the scan's "Other polymorphic references without foreign keys (blast radius)" section as
   the starting set.
2. Read every `CREATE TABLE` in `src-tauri/migrations/` and classified each column that names a
   node into **owned by the node** (has `ON DELETE CASCADE` back to it — dies correctly with it)
   versus **aimed at the node** (must be repointed by hand).
3. Cross-checked the polymorphic ones with `grep -rn` for each table name across `src-tauri/src/`
   and `src/`, to find both what writes them and whether anything reads them at all.

The result, for a goal/task/domain node:

| Reference | Direction | Handling |
|---|---|---|
| `task_dependencies.dependency_id` (+ `dependency_type`) | **aimed at**, no FK | **Repointed**, or deleted when the target cannot be depended on. The bug. |
| `task_dependencies.task_id` | owned, `ON DELETE CASCADE` | Dies with the task. Counted and reported first. |
| `tags_on_goals.goal_id` / `tags_on_tasks.task_id` | owned, `ON DELETE CASCADE` | Re-inserted against the new node before the old row goes. |
| `block_reasons.owner_id` (+ `owner_type`) | owned, **no FK** | Re-set on the new owner, then swept off the old one. |
| `goals.parent_id` / `tasks.parent_id` (+ `parent_type`) | **aimed at**, no FK | Children reparented onto the new row, or settled. |
| `infos.parent_id` (+ `parent_type`) | **aimed at**, no FK | Same. |
| `flows.parent_id` (+ `parent_type`) | **aimed at**, no FK | Same. **Not in the plan.** See above. |
| `domains.parent_id` | **aimed at**, real FK to `domains(id)` | Same; the FK makes a mistake here loud rather than silent. |
| `goal_knowledge_base_links` / `task_knowledge_base_links` | owned, `ON DELETE CASCADE` | Nothing. Dead tables — no code path writes them. |
| `flow_dependencies`, `flow_item_cycles` | flow items only | Out of scope; `convert_flow_item` already handles them. |

**The polymorphic-no-FK pattern is wider than `task_dependencies`, but not in a way that needed a
stop-and-report.** Four of the eight live references above have no foreign key, and all four are
*parent* links that the retype was already going to touch. `task_dependencies.dependency_id` is
the only one that is a peer reference — a row elsewhere in the tree pointing sideways at this node
— and so the only one nothing else in the codebase would ever have noticed going stale. That is
why it, and not the parent links, is where the silent corruption lived.

One subtlety worth recording: `goals.parent_type` / `tasks.parent_type` discriminate **three**
cases, not five. They cannot say `tag` or `aspect` at all, and the tree resolves anything that is
not `goal` or `task` by id against the `domains` table — so the frontend writes `project` for
*every* domain-table parent, including domains and tags. Collecting the children of a domain-table
node therefore has to ask for both the `project` and `domain` spellings, and writing a child's new
parent has to collapse five kinds to three. Both are done in `goal_task_parent_spellings` and
`goal_task_parent_type`, each documented.

---

## The `details` payload

First use of `WireErrorKind::NeedsConfirmation` and of `WireError.details`. Built by
`TransferPlan::details()`; both keys are always present so the frontend can render each list
without probing.

```json
{
  "kind": "needs_confirmation",
  "message": "retyping to task would lose 1 child(ren) and 1 field(s)",
  "details": {
    "lost_children": [{ "kind": "goal", "id": 4, "title": "Finish the tutorial" }],
    "lost_fields":   [{ "field": "plan", "value": "12" }]
  }
}
```

`field` is a **stable key**, not prose: it doubles as the i18n key suffix
(`warnings:lostField.<field>`). The nine keys are `status`, `time_scope`, `plan`, `delegate_to`,
`description`, `knowledge_base_directory`, `tags`, `block_reasons`, `dependents`, `dependencies`.
`value` is a short rendering for interpolation — a count for the collection fields, a Duration
phrase (`"3 week"`) or boundary ids (`"12–15"`) for a window, a 40-character clip for free text.

`on_scope_exit` deliberately has **no key of its own**: the DB invariant is "scoped ⟺ on-exit set",
so it rides with `time_scope` and the one string names both. Two bullets for one concept would be
worse, not more honest.

The frontend narrows the payload through `retypeLosses()` in `src/api/retype.ts`, which goes
through `isWireError` from `src/api/errors.ts` and then validates every element of both arrays. No
`as`, no `any`. An unrecognised `field` key renders through `warnings:lostFieldFallback` rather
than showing a raw key, so a field added to `tasks::retype` degrades to readable text.

The acknowledgement is the `strandedChildren` argument. Passing it *at all* is the consent;
passing `reparent` or `delete` is the choice for children. When only fields are at stake the modal
shows one button, which still sends `reparent` — a no-op when nothing is stranded, but the command
refuses again without it.

---

## The rollback test, and the commit-removal run

`a_retype_that_fails_after_the_create_leaves_the_tree_exactly_as_it_was`
(`src-tauri/tests/tasks.rs`) follows the precedent set by
`a_convert_to_flow_aborted_after_the_delete_restores_the_subtree_and_leaves_no_template`: it
stands in for the caller, runs the command's own shape (begin → plan → apply → commit), and fails
where the command's `?` would fire.

It first proves the transaction is not vacuous — inside it, the new task exists and the goal is
already gone — then injects a real failure (planning a retype of goal `909909`, which does not
exist), drops the session without committing, and asserts against the pool that the goal is back
with both tags and its block reason, that the new task id never existed, that **both dependency
edges still name the goal**, and that the task child never moved.

For the commit-removal demonstration I deleted both `db.commit()` calls from
`commands/retype.rs` and reran:

```
$ CARGO_INCREMENTAL=0 cargo test --test tasks retype
running 3 tests
test the_retype_node_command_carries_a_goals_scope_tags_and_inbound_dependencies_onto_the_task ... FAILED
test a_retype_that_fails_after_the_create_leaves_the_tree_exactly_as_it_was ... ok
test the_retype_node_command_refuses_until_the_caller_acknowledges_the_children_it_would_strand ... FAILED

---- the_retype_node_command_carries_a_goals_scope_tags_and_inbound_dependencies_onto_the_task stdout ----
thread '...' panicked at tests/tasks.rs:2656:6:
called `Result::unwrap()` on an `Err` value: RowNotFound

---- the_retype_node_command_refuses_until_the_caller_acknowledges_the_children_it_would_strand stdout ----
thread '...' panicked at tests/tasks.rs:2807:5:
assertion `left == right` failed: the stranded sub-goal moves up to the retyped node's own parent
  left: ("goal", 1)
 right: ("project", 7)

test result: FAILED. 1 passed; 2 failed; 0 ignored; 0 measured; 53 filtered out
```

Both command-level tests fail, each on a different assertion, and neither fails for an incidental
reason: the first cannot find the new task's row in the pool at all, the second finds the stranded
sub-goal still under the goal it was supposed to have left. The rollback test correctly still
passes — it never commits, so removing the commit changes nothing for it.

The 4.1 unit tests were likewise seen red first, against a stub `plan_retype` that carried only
title/position/privacy: **18 of 23 failed**, the 5 that passed being the ones asserting exactly
those three fields or asserting that nothing is lost.

---

## How noisy the uniform consent rule is in practice

Measured against the rule as implemented (default statuses and same-table field retention both
suppress a prompt), for a node with no children:

| Conversion | Prompts? | Why |
|---|---|---|
| goal → task, nothing set | no | everything a goal has, a task has |
| goal → task, scoped, tagged, blocked | **no** | all three carry now |
| task → goal, **with a Plan** | **yes, always** | a goal has no Plan column |
| task → goal, with a delegate | yes | no delegate on a goal |
| task → goal, neither | no | |
| project ↔ domain ↔ tag, any fields | no | one row, `subtype` UPDATE, nothing deleted |
| goal/task → project/domain/tag, scoped or tagged or blocked or depended-on | yes | none of it exists there |
| goal/task → project/domain/tag, bare | no | title/position/privacy/status all carry |
| domain/project/tag → goal/task, **with a description** | yes | no description column on either |

**The brief's prediction is right and it is the dominant case.** Task→Goal is one of the two most
common conversions in the app, and a Plan is the single most commonly set optional field on a
task, so *most* task→goal retypes will now stop and ask. Everything else is quiet in the common
case: the two rules above took goal→task (the other common conversion) from "always prompts"
(scoped or tagged goals are normal) down to "never", and took the whole domain-table triangle from
"prompts whenever a Project has a directory link" to "never".

So the noise is concentrated in exactly one transition. If it becomes a complaint, the cheapest
fix is **not** the asymmetric rule in general — it is to special-case `plan` as a notification
(a toast, like the status remap already gets) while everything else keeps consent. The seam for
that is one line: `TransferPlan::loses_anything` already separates `lost_children` from
`lost_fields`, and the frontend already has a toast path beside the modal path. The full
asymmetric rule (consent for children, notification for all fields) is the next step out and
would also silence the `dependents` warning, which I think is the one field loss most worth
keeping loud.

---

## Verification

Baselines were established first, on an otherwise idle machine, and both matched the brief.

### Backend (`src-tauri/`)

| Command | Before | After |
|---|---|---|
| `CARGO_INCREMENTAL=0 cargo build` | clean | clean |
| `CARGO_INCREMENTAL=0 cargo clippy --all-targets` | 0 warnings | **0 warnings** |
| `CARGO_INCREMENTAL=0 cargo test` | **355 passed, 0 failed** | **386 passed, 0 failed** |

The 31 new tests: 26 unit in `tasks::retype`, 1 in `error::wire` (the `needs_confirmation`
constructor), 4 integration in `tests/tasks.rs`. `tests/tasks.rs` went 52 → 56 and every
pre-existing test in it still passes.

One clippy warning appeared mid-way and was fixed rather than allowed: `clippy::type_complexity`
on an eight-element tuple in a test's `query_as`, replaced with a named `RetypedTaskRow` struct.

### Frontend (repo root)

| Command | Before | After |
|---|---|---|
| `npm test` | **78 files, 1006 passed** | **78 files, 1006 passed** |
| `npx tsc --noEmit` | clean | clean |
| `npm run lint` | clean | clean |
| `npm run build` | clean (485.35 kB) | clean (485.40 kB) |

The frontend count is unchanged by coincidence: I removed 10 tests in `use-mindmap-data.test.ts`
that asserted the old per-call sequence and added 6 that assert the single `invoke`, then added 4
to `use-node-type-manager.test.tsx` for the refusal-becomes-the-prompt flow.

Those 10 removals are worth naming, because they are the tests the scan warned about: they
"encode the current field/tag/dependency drops as expected behavior, they don't catch them as
bugs". Keeping them would have meant keeping the bug.

**The false 18-failure baseline from yesterday did not recur.** Both baseline runs and both final
runs were clean, with no concurrent build competing.

---

## Files changed

**Backend**

- `src-tauri/src/tasks/retype.rs` *(new)* — the pure transfer plan, and the transactional executor
  beneath it. 26 inline unit tests.
- `src-tauri/src/commands/retype.rs` *(new)* — the thin Tauri wrapper, and the consent handshake.
- `src-tauri/src/tasks/mod.rs` — registers the module; adds four module-private `TaskOperator`
  methods for the inbound dependency edges (`count_dependents`, `count_dependencies`,
  `repoint_dependents`, `drop_dependents`).
- `src-tauri/src/error/wire.rs` — `WireError::needs_confirmation`, plus a test.
- `src-tauri/src/domains/model.rs` — `Default` on `UpdateDomainRequest` (one derive).
- `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs` — module and command registration.
- `src-tauri/tests/tasks.rs` — the fixture and four integration tests.

**Frontend**

- `src/api/retype.ts` *(new)* — the typed `invoke`, the kind guard, and the `details` narrowing.
- `src/components/MindmapView/use-mindmap-data.ts` — `retypeNode` 260 → 143 lines; both
  `console.warn("… orphaned")` paths deleted; `RetypeOptions.strandedChildren` added.
- `src/components/MindmapView/use-node-type-manager.ts` — `runRetype` turns a `needs_confirmation`
  refusal into the existing modal and any other rejection into a toast; `buildRetypeActions`
  renders the payload; the client-side prediction of goal-children and block-reason consequences
  is gone.
- `src/i18n/locales/en/warnings.json` — 20 new keys (13 of them the `lostField` group).
- `src/components/MindmapView/use-mindmap-data.test.ts`,
  `src/components/MindmapView/use-node-type-manager.test.tsx` — rewritten for the new contract.

**Docs**: `CHANGELOG.md` (one `Fixed` entry), this report. `VERSION.txt` untouched.

---

## Self-review findings

Things I changed after writing them, recorded because the reasoning matters more than the diff:

- **I did not copy `convert_flow_item`'s field coverage**, as instructed. `is_private` carries
  here, and `Carried`'s doc comment says explicitly that the precedent drops it and that this is
  the bug deliberately not imported. The integration test asserts it off the row, so it cannot
  regress quietly. I did **not** fix `convert_flow_item` itself — `flows/` was off-limits and
  another agent is in it. **That bug is still live** and should be its own ticket.
- **The block-reason "consequence" in the old prompt was informational, not a loss** — it said
  "Block reason will carry over". Under the new contract that is simply true and unremarkable, so
  the modal it used to raise is gone. Block reasons carry; nothing is asked.
- **I kept the status-remap toast.** It is a notification about something that always happens and
  cannot be declined, which is the opposite of a consent prompt. Folding it into the modal would
  have made the modal appear on every goal↔task retype.
- **`keep_if` / `keep_list` / `keep_count` are three near-identical helpers.** That is one past
  the Rule of Three's threshold, but they differ in what "absent" means (`None`, empty, zero) and
  collapsing them needs a trait with three impls to save six lines. I left them.

## Concerns

1. **Info nodes are the remaining silent drop.** `info.details` disappears on info→goal/task, and
   the `→ info` path still deletes non-info children through a loop of separate calls with no
   transaction. This is the same class of bug, one kind over. It should be a follow-up.
2. **`convert_flow_item` still drops `is_private`.** Confirmed by the scan, confirmed by me, not
   fixed here because `flows/` was another agent's worktree.
3. **Reparent-up can be refused by the schema, and then the whole retype aborts.** Moving a
   stranded child to the retyped node's own parent is validated only by the `parent_type` CHECK
   and the `domains.parent_id` FK. When the parent cannot hold the child, the write is rejected
   and the transaction rolls back — loud and safe, but the user gets a database error rather than
   a sentence explaining that Delete is the only route. I judged loud-and-correct better than a
   pre-flight check I could not test exhaustively, but it is a rough edge.
4. **`delete_child` on a domain-table child with children of its own will fail**, because
   `domains.parent_id` has no `ON DELETE`. Same shape as (3): correct, rolled back, but a raw
   error. Reparent is the working route.
5. **`read_children` reads all infos, all flows and all domains and filters in Rust**, because
   those operators have no by-parent query and I was not willing to add one to `flows/`. Those
   tables are small (tens of rows) and this runs once per retype, so it is not a practical
   problem, but it is not how the other child lookups work.
6. **The child-nesting table now exists twice** — `RetypeKind::accepts_child` in Rust and
   `ALLOWED_CHILD_KINDS` in TypeScript. They serve different purposes (hiding a menu item vs.
   naming a casualty) and neither can import the other, so both carry a comment pointing at the
   other. If they drift, the symptom is a retype the menu offers that then prompts, or vice versa
   — annoying, not corrupting.
