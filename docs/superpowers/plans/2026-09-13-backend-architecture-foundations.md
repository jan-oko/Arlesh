# Backend Architecture Foundations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the backend's three structural defects — no atomicity, no seam between deciding and writing, and no structured errors at the command edge — and cash the fixes in on the two operations that are currently broken because of them: `retype_node` (silent data loss) and the flow renderer (untestable logic).

**Architecture:** Six phases, each landable on its own. A structured error type replaces string-erased errors at every command. A session factory replaces the pool-per-repository arrangement, making a transaction expressible for the first time. The four duplicated ancestor walks collapse into one impure climb feeding pure searches. `retype_node` moves from the frontend into one atomic backend command. The flow materialiser splits into a pure renderer and a dumb writer. The mindmap's 15-call fan-out collapses to one command.

**Tech Stack:** Rust 1.96 (edition 2021), Tauri 2.0, sqlx 0.8.6 + SQLite, thiserror, tracing, Tokio. Frontend: React, TypeScript (strict), Zustand, Vitest.

**Source report:** `docs/reports/architecture-review-2026-09-13.html` (candidates 1–5)
**Related ADR:** `docs/adr/0004-database-sessions-and-resource-operators.md`

---

## Global Constraints

- `.unwrap()` and `.expect()` are **banned** in non-test code — propagate with `?`.
- Domain errors are `thiserror` enums. `#![deny(missing_docs)]` and `#![deny(clippy::all)]` hold: every `pub` item gets a doc comment.
- `tracing::instrument` on non-trivial async functions.
- Rust unit tests go inline in `#[cfg(test)] mod tests`; integration tests in `src-tauri/tests/`.
- Tauri commands stay thin — they delegate to domain modules and do no logic.
- TypeScript: `any` and `as` are banned; `@/` import alias; named exports except React components.
- Test commands: `cargo test` (backend, from `src-tauri/`), `cargo clippy --all-targets`, `npm test` (frontend), `npm run build` (typecheck), `npm run lint`.
- **Each phase must leave `cargo test` and `npm test` green before the next begins.**
- Commit at the end of every task. Do not leave the working tree dirty.
- CHANGELOG entries only where behaviour changes for the user — Phases 3, 4 and 6. Phases 1, 2 and 5 are refactors and get no entry.

---

## Decisions already settled

These were decided during grilling. Do not re-litigate them; if one turns out to be wrong, stop and raise it.

| Area | Decision |
|---|---|
| Sequencing | Foundation first: errors → sessions → ancestry → retype → render → load |
| Session shape | Factory owns the pool; a session owns one connection; per-resource operators are temporaries |
| Session modes | `connect()` pooled, `begin()` transactional with manual commit |
| Session typing | `Db<Pooled>` / `Db<Transactional>`; `commit()` exists only on the latter |
| Migration scope | All 11 repositories in one pass |
| Broken ancestor chain | Reported, never swallowed: read path treats it as unconstrained, write path rejects |
| Ancestry shape | One impure climb returns the chain; every question is a pure search over it |
| Chain links | Narrow records (`kind`, `id`, `parent`, `time_scope`, `plan`, `on_exit`), not full rows |
| Containment check | Pure; reports the **first** violation only (behaviour-preserving) |
| Retype preservation | Everything transferable, plus tags, plus repointing inbound references |
| Retype consent | Uniform — refuses until told what to do about **both** lost children and lost fields |
| Flow scope resolution | Resolved up front into a lookup table; the renderer stays pure |
| Flow node references | Placeholder ids in the rendered plan; the writer maps them to real ids |
| Mindmap load | One command, one envelope; **the frontend keeps assembling the tree** |
| Error shape | Tagged payload (`kind` + `message` + `details`) the frontend matches on |

---

# Phase 1 — Structured errors at the command edge

Every command currently ends `.map_err(|error| error.to_string())`, flattening each domain error into an opaque string. Phases 3 and 4 both need the frontend to distinguish specific failures from generic ones, so this comes first.

### Task 1.1: Give `AppError` a `FlowError` variant

`AppError` omits `FlowError` entirely, so the 34 flow commands cannot use it.

**Files:**
- Modify: `src-tauri/src/error.rs`

**Interfaces:**
- Produces: `AppError::Flow(#[from] FlowError)`.

- [ ] **Step 1:** Add the `Flow` variant to `AppError` with `#[error(transparent)]` and `#[from]`, matching the existing four.
- [ ] **Step 2:** `cargo build` — confirm no ambiguity errors from the new `From` impl (`FlowError` already wraps `TaskError` and `ScopeError`; if the blanket conversions conflict, drop `#[from]` on the new variant and convert explicitly at the command edge).
- [ ] **Step 3:** `cargo clippy --all-targets` clean. Commit.

### Task 1.2: The wire error type

**Files:**
- Create: `src-tauri/src/error/wire.rs` (or extend `src-tauri/src/error.rs`)
- Test: inline `#[cfg(test)] mod tests`

**Interfaces:**
- Produces: a serialisable struct carrying a stable machine-readable `kind`, a human `message`, and an optional `details` payload; plus a conversion from `AppError` that assigns a kind to every variant of every domain error.

- [ ] **Step 1: Write the failing test.** For each domain error variant, assert the conversion yields the expected `kind`. Start with the ones later phases depend on: not-found, containment-violated, invalid-request, needs-confirmation, database.
- [ ] **Step 2:** Define the wire struct with `serde::Serialize`. `kind` is a fixed string set, not free text — an enum serialised in snake_case.
- [ ] **Step 3:** Implement the conversion from `AppError`, walking into each domain error to assign a kind. Unmapped variants fall back to a generic kind rather than panicking.
- [ ] **Step 4:** `details` is an optional structured value, unused until Phase 4. Keep it `Option` so nothing is forced to populate it yet.
- [ ] **Step 5:** Tests pass; clippy clean. Commit.

### Task 1.3: Convert every command

**Files:**
- Modify: every file in `src-tauri/src/commands/`

- [ ] **Step 1:** Replace `.map_err(|error| error.to_string())` with the wire conversion across all ~80 commands. The command signatures change from `Result<T, String>` to `Result<T, WireError>`.
- [ ] **Step 2:** `cargo test` — existing integration tests in `src-tauri/tests/` must still pass.
- [ ] **Step 3:** Commit.

### Task 1.4: Frontend error handling

**Files:**
- Modify: `src/api/*.ts` (the `invoke` wrappers)
- Create: a type guard for the wire error shape
- Test: alongside

**Interfaces:**
- Produces: a typed error value the hooks can switch on; **no message-text matching anywhere.**

- [ ] **Step 1: Write the failing test.** A rejected `invoke` surfaces a typed error with the right `kind`.
- [ ] **Step 2:** Add the type guard (`unknown` narrowed by predicate — `as` is banned) and thread it through the `src/api/` wrappers.
- [ ] **Step 3:** Update existing catch sites to read `kind` where they currently inspect strings. Where a site only toasts the message, leave it.
- [ ] **Step 4:** `npm test`, `npm run build`, `npm run lint` green. Commit.

---

# Phase 2 — Database sessions

Fully specified in **ADR-0004**. Read it before starting; it records the five rejected alternatives and why.

The defect: a pool's contract is "any free connection", while a transaction is a claim on *one*. A `BEGIN` on one connection has no authority over writes sent to another — so no arrangement where each repository independently reaches into the pool can ever be atomic.

### Task 2.1: The factory and the typed session

**Files:**
- Create: `src-tauri/src/database/session.rs`
- Test: inline

**Interfaces:**
- Produces: a factory owning the pool; `connect()` returning a pooled session; `begin()` returning a transactional one; `commit()` present only on the transactional type. The two are distinguished by a zero-cost type marker, so a function requiring atomicity says so in its signature.

- [ ] **Step 1: Write the failing test.** A transactional session's writes are invisible until commit, and vanish when the session is dropped without one.
- [ ] **Step 2:** Define the marker types and the session, generic over the marker.
- [ ] **Step 3:** Implement `connect()` and `begin()` on the factory; implement `commit()` only for the transactional marker.
- [ ] **Step 4:** Wire the factory into the Tauri managed state at bootstrap, alongside the existing pool. Both coexist during the migration.
- [ ] **Step 5:** Tests pass; clippy clean. Commit.

### Task 2.2: Migrate the repositories to operators

Eleven repositories, 84 public methods, 153 `self.pool` references (flows 78, tasks 35, knowledge_base 13, infos 9, scopes 7, domains 7, block_reasons 4).

**Files:**
- Modify: all 11 repository modules

**Interfaces:**
- Each repository becomes stateless. Its methods move onto a per-resource operator borrowed from the session per call (`db.goals().create(…)`), never stored.

- [ ] **Step 1:** Migrate `block_reasons` first — 4 references, and the only module with an existing transaction, so it proves the shape end to end.
- [ ] **Step 2:** Migrate `scopes`, `domains`, `infos`, `knowledge_base` (small; 36 references combined).
- [ ] **Step 3:** Migrate `tasks` (35 references).
- [ ] **Step 4:** Migrate `flows` (78 references). Expect the borrow-checker diagnostic *"cannot borrow as mutable more than once"* wherever two operators were bound at the same time — the fix is always to use them inline rather than binding them. `start` (`flows/mod.rs:1606-1608`) and `convert_to_flow` (`:1164-1166`) each bind three; delete the bindings and prefix the call sites.
- [ ] **Step 5:** The five single-resource helpers (`offset_scope` `:692`, `resolve_pair` `:717`, `habit_slots` `:1361`, `resolve_window` `:1465`, `resolve_flow_window` `:1491`) keep taking a single operator — do not widen them to take the session.
- [ ] **Step 6:** `cargo test` green after each repository. Commit per repository.

### Task 2.3: Make the composite operations atomic

**Files:**
- Modify: `src-tauri/src/flows/mod.rs`, `src-tauri/src/tasks/mod.rs`

- [ ] **Step 1:** Change `start`, `fork_flow`, `convert_to_flow`, `set_iteration_done` and the subtree deletes to take a transactional session in their signatures, so calling them non-atomically is a compile error.
- [ ] **Step 2:** Their commands open the transaction, call the operation, and commit. **Nested composite operations join the caller's session and never open their own** — only the outermost caller decides the boundary.
- [ ] **Step 3: Write the regression test.** `convert_to_flow` deletes the original subtree after ~150 lines of inserts and has no test today. Add one that forces a failure part-way and asserts neither a partial template nor a half-deleted subtree survives.
- [ ] **Step 4:** Remove the now-unused pool from managed state. Commit.

---

# Phase 3 — The ancestry chain

`scope_rules.rs` contains the same climb four times (`:66`, `:181`, `:213`, `:245`): *start at a node, ask whether it carries what you want, else step to its parent.* They differ on what they seek, where they start, and — the part that matters — what a broken chain means.

`scope_governance` swallows a missing parent and reports "nothing found" (deliberately, per the comment at `:74`, so one bad row doesn't blank the whole mindmap). The other three propagate and reject the write. Both are right for their caller, but today "nothing found" conflates *"nothing above this is scoped"* with *"the chain broke and I don't know"* — and that conflation is what lets the write path skip validation on a corrupt tree.

### Task 3.1: The chain climb

**Files:**
- Create: `src-tauri/src/tasks/ancestry.rs`
- Test: inline

**Interfaces:**
- Produces: a narrow link record (`kind`, `id`, `parent`, `time_scope`, `plan`, `on_exit`) and a chain value holding the ordered links plus how the walk ended — reached the root, or broke at a named reference.
- Consumes: the tasks and goals operators from Phase 2.

- [ ] **Step 1: Write the failing test.** A three-deep chain climbs to the root; a chain whose middle parent is missing ends as broken, naming the missing reference.
- [ ] **Step 2:** Define the link and chain types. The chain includes the starting node — callers that want ancestors-only skip the first link.
- [ ] **Step 3:** Implement the climb with a narrow query per kind reading only the six fields, not the full row.
- [ ] **Step 4:** Guard against a cycle in the parent chain (a corrupt tree could loop forever). Terminate and report it as a broken chain.
- [ ] **Step 5:** Tests pass; clippy clean. Commit.

### Task 3.2: The pure searches

**Files:**
- Modify: `src-tauri/src/tasks/ancestry.rs`
- Test: inline

**Interfaces:**
- Produces: pure functions over a chain — nearest scoped ancestor, its time scope, the governing window and on-exit behaviour, nearest planned ancestor. **No database, no `async`.**

- [ ] **Step 1: Write the failing tests** using handwritten chains — no fixtures, no database. This is the whole point of the shape; if a test here needs a database, the split is wrong.
- [ ] **Step 2:** Implement each search as a scan over the links.
- [ ] **Step 3:** Preserve the existing quirk: the plan search traverses **tasks only** and stops at a goal, while the scope search climbs through goals. Test both.
- [ ] **Step 4:** Resolve time scopes into windows *after* picking, so each is resolved once rather than up to twice as today. Commit.

### Task 3.3: Retire the four walks

**Files:**
- Modify: `src-tauri/src/tasks/scope_rules.rs`

- [ ] **Step 1:** Rewrite `scope_governance`, `nearest_scoped_ancestor_window`, `nearest_scoped_ancestor_time_scope` and `nearest_planned_ancestor_window` as thin callers of the chain plus a pure search.
- [ ] **Step 2:** Apply the settled broken-chain policy at each call site: `derive_all_scope_lifecycles` (`:118`, `:134`) treats a broken chain as unconstrained and keeps rendering; `validate_task_containment` and `validate_goal_containment` reject.
- [ ] **Step 3: Write the test** that pins this down — the same corrupt tree renders fine and rejects a write.
- [ ] **Step 4:** Delete the four loop bodies. Commit.

### Task 3.4: The pure containment check

**Files:**
- Modify: `src-tauri/src/tasks/scope_rules.rs`
- Test: inline

**Interfaces:**
- Produces: a pure check over already-resolved windows. Three rules: plan ⊆ own time scope; own time scope ⊆ nearest scoped ancestor; plan ⊆ nearest planned ancestor.

- [ ] **Step 1: Write the failing tests** over handwritten windows.
- [ ] **Step 2:** Extract the check. `validate_task_containment` becomes: climb once, resolve the windows it needs, call the pure check.
- [ ] **Step 3:** Keep first-violation reporting. Do not collect all violations — that is a deliberate non-goal here.
- [ ] **Step 4:** Note the redundancy this removes: today the function climbs twice and re-resolves the same time scope up to twice more. `validate_goal_containment` is a strict subset — rule 2 only.
- [ ] **Step 5:** Tests pass. Commit.

---

# Phase 4 — `retype_node`

**This phase fixes a live data-loss bug.** Retyping happens entirely in the frontend today (`use-mindmap-data.ts:793`) as up to ten separate backend calls, with two independent failures.

**It isn't atomic.** A failure after the create but before the delete leaves both nodes; a failure mid-loop splits the children between them.

**It silently drops most of the node.** A goal→task retype carries title, parent, mapped status, position and block reasons. It drops the entire Time Scope (4 columns), `on_scope_exit`, `nsfw`, and all tags. Worst: `task_dependencies` stores its target polymorphically with **no foreign key** on the id, so deleting the old node leaves every dependency that pointed at it aimed at an id that no longer exists.

`convert_flow_item` already does this correctly for flow items, in the backend, in one place. This phase brings the task/goal path to the same standard.

### Task 4.1: The transfer plan

**Files:**
- Create: `src-tauri/src/tasks/retype.rs`
- Test: inline

**Interfaces:**
- Produces: a pure function taking the source node, its children and the target kind, returning what would transfer, what children cannot live under the target, and what fields have no counterpart.

- [ ] **Step 1: Write the failing tests.** goal→task, task→goal, and the domain-table pairs. Assert exactly which fields and children survive.
- [ ] **Step 2:** Implement it as pure logic over values — no database.
- [ ] **Step 3:** Enumerate the field mappings explicitly (status mapping both ways; time scope and `on_scope_exit` and `nsfw` carry; a task's plan and `delegate_to` have no goal counterpart).
- [ ] **Step 4:** Tests pass. Commit.

### Task 4.2: The command

**Files:**
- Create: `src-tauri/src/commands/retype.rs`
- Modify: `src-tauri/src/lib.rs` (register), `src-tauri/src/tasks/mod.rs`
- Test: `src-tauri/tests/tasks.rs`

**Interfaces:**
- Consumes: a transactional session (Phase 2), the transfer plan (4.1).
- Produces: `retype_node` — one atomic command. It **refuses** with a `needs_confirmation` error carrying `details` (Phase 1) listing every child and field that would be lost, until the caller passes explicit acknowledgement.

- [ ] **Step 1: Write the failing integration test.** Retype a goal that has a time scope, tags, and two inbound dependencies → assert all three survive on the new task, and no dependency row dangles.
- [ ] **Step 2:** Implement inside one transaction: create the new node with every transferable field, move the tag rows, reparent the compatible children, **repoint every inbound dependency and block reason**, delete the old node.
- [ ] **Step 3:** Implement the uniform consent rule — the command refuses if *anything* would be lost, child or field, until acknowledged. Populate `details` so the frontend can name what is at stake.
- [ ] **Step 4: Write the failing-midway test** asserting a rollback leaves the tree exactly as it was.
- [ ] **Step 5:** Register the command. Commit.

### Task 4.3: Frontend collapse

**Files:**
- Modify: `src/components/MindmapView/use-mindmap-data.ts`, `src/api/tasks.ts`
- Modify: `src/components/MindmapView/use-node-type-manager.ts` (the confirm prompt)
- Test: `src/components/MindmapView/use-node-type-manager.test.tsx`

- [ ] **Step 1: Write the failing test.** A retype that needs confirmation shows the prompt naming what would be lost; confirming retries with acknowledgement.
- [ ] **Step 2:** Replace the ~170-line `retypeNode` body with a single `invoke`.
- [ ] **Step 3:** Extend the existing confirm prompt — it already handles goal-children with reparent-or-delete — to render the `details` payload generally.
- [ ] **Step 4:** Delete the `console.warn("… orphaned")` paths at `:862` and `:878`. Nothing is dropped silently any more; that is now the command's contract.
- [ ] **Step 5:** `npm test` green. **CHANGELOG entry** — this is user-facing. Commit.

---

# Phase 5 — The flow renderer

`start()` (`flows/mod.rs:1600-1753`) is 155 lines doing two jobs interleaved statement by statement: deciding the instance tree's shape, and writing it. Every decision is followed immediately by its write, so **none of the decision logic can be exercised without a live database** — including the fan-in dependency remapping at `:1739`, the subtlest logic in the backend.

`flows/habits.rs` already does exactly the split this phase applies: the impure `habit_slots` feeds the pure `classify_iterations`, which carries 6 unit tests. Follow that precedent.

### Task 5.1: The scope table

**Files:**
- Create: `src-tauri/src/flows/render.rs`
- Test: inline

**Interfaces:**
- Produces: a gather step resolving every scope the flow needs into a lookup table, and a lookup type the renderer reads.

- [ ] **Step 1:** Note two facts before designing this. **It needs two rounds**: `resolve_pair` (`:717`) resolves the cycle scope from the window start, then resolves that pair's plan offsets from the **resolved cycle's** start date — so plan scopes depend on cycle-scope output. Both rounds are fully enumerable from the cycle-pair list.
- [ ] **Step 2:** And `offset_scope` (`:692`) calls `scopes.get_or_create(…)` — **it writes**. The gather step mints scope rows, so it must sit inside the same transaction as the writes. It cannot be hoisted outside the boundary later.
- [ ] **Step 3: Write the failing test** asserting the gather step produces every scope the renderer will ask for, for a flow with nested cycle pairs and a root plan.
- [ ] **Step 4:** Implement round 1 (cycle scopes from the window start) and round 2 (plan scopes from each resolved cycle start). Commit.

### Task 5.2: The pure renderer

**Files:**
- Modify: `src-tauri/src/flows/render.rs`
- Test: inline

**Interfaces:**
- Produces: a **pure** function taking the flow, its template items and cycles, and the scope table, returning a flat plan — nodes addressed by placeholder id, each carrying its parent placeholder and resolved scopes, plus dependency edges stated in placeholder terms.

- [ ] **Step 1: Write the failing tests** with a handwritten scope table and handwritten template items. **No database.** Cover: an item with three cycle pairs spawning three instances; children nesting under the *first* instance; and the fan-in remapping — each dependent instance waits on every blocker instance, skipping non-task dependents.
- [ ] **Step 2:** Define the plan types: a node list with placeholder ids, and an edge list in the same terms.
- [ ] **Step 3:** Port the breadth-first walk from `start()` (`:1689-1737`), replacing each `create` with an entry appended to the node list.
- [ ] **Step 4:** Port the fan-in remapping from `:1739-1750`. This is the logic the phase exists to make testable — test it hardest.
- [ ] **Step 5:** Tests pass; clippy clean. Commit.

### Task 5.3: The writer

**Files:**
- Modify: `src-tauri/src/flows/mod.rs`

**Interfaces:**
- Consumes: the rendered plan, a transactional session.
- Produces: the materialised flow. The writer is a dumb loop — insert each node, record the real id it got, translate the edges through that mapping.

- [ ] **Step 1:** Rewrite `start()` as: resolve scopes → render → write. Target well under 40 lines.
- [ ] **Step 2:** Keep `record_node` and the `flow_instances` insert in the writer; they are bookkeeping, not shape decisions.
- [ ] **Step 3:** Fold the `nsfw` handling in. Today it is a separate `UPDATE … SET nsfw = 1` after every single create, because the create requests carry no nsfw field — roughly two writes per node. Either add the field to the create requests or keep the update, but do it in one place, not two.
- [ ] **Step 4:** `cargo test` — the existing `src-tauri/tests/flows.rs` suite is the regression net. It must pass unchanged.
- [ ] **Step 5:** **CHANGELOG entry** only if behaviour changed. It should not have. Commit.

---

# Phase 6 — `load_mindmap`

The mindmap load is 15 round trips in two dependent waves: 13 in parallel at `use-mindmap-data.ts:605`, then 2 more at `:624` that need the first batch's results. It is written twice — `load` at `:605`/`:624` and `silentLoad` at `:642`/`:661`, near-identical. Every mutation in the file ends with `await silentLoad()`, so the fan-out runs after **every edit**.

**Scope note:** this phase collapses the round trips only. The frontend keeps building the tree — no assembly logic moves to Rust. That was considered and deliberately declined.

### Task 6.1: The command

**Files:**
- Create: `src-tauri/src/commands/mindmap.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/` (new file)

**Interfaces:**
- Produces: `load_mindmap` returning one envelope with all 15 payloads — domains, goals, tasks, infos, flows, flow goals, flow tasks, cycles, flow deps, block reasons, task deps, instance refs, lifecycles, per-flow iterations, per-flow statuses.

- [ ] **Step 1: Write the failing integration test.** A seeded database returns an envelope whose every field matches what the 15 individual commands return.
- [ ] **Step 2:** Implement using a pooled session (read-only — no transaction needed).
- [ ] **Step 3:** Resolve the dependent wave backend-side: the per-flow iterations and statuses are computed after the flow list, in the same call.
- [ ] **Step 4:** Register the command. Leave the 15 existing commands in place — other call sites may use them. Commit.

### Task 6.2: Frontend collapse

**Files:**
- Modify: `src/components/MindmapView/use-mindmap-data.ts`
- Create: `src/api/mindmap.ts`
- Test: `src/components/MindmapView/use-mindmap-data.test.ts`

- [ ] **Step 1:** Add the typed `invoke` wrapper in `src/api/mindmap.ts`.
- [ ] **Step 2:** Replace both fan-outs (`:605`/`:624` and `:642`/`:661`) with one call. `load` and `silentLoad` now differ only in whether they show a spinner — collapse them to one function with a flag.
- [ ] **Step 3:** The tree-assembly code below the fetch is **untouched**. It reads from the envelope instead of from 15 awaited promises. If assembly logic needs changing, the scope note above has been violated — stop.
- [ ] **Step 4:** `npm test` green — the existing assembly tests are the regression net.
- [ ] **Step 5:** **CHANGELOG entry** — responsiveness after every edit is user-facing. Commit.

---

## Sequencing notes

- **Phases 1 and 2 are independent** and could be done in either order or in parallel. Phase 1 first because Phase 4 needs its `details` payload.
- **Phase 3 depends on Phase 2** (the chain climb uses operators) but only lightly; it could be done against the pool and migrated later if Phase 2 stalls.
- **Phases 4 and 5 both depend on Phase 2** for atomicity. Neither is implementable as a single correct operation without it — that is the whole reason sessions come first.
- **Phase 6 depends on nothing** and can be pulled forward if a quick user-visible win is wanted.

## Known risks

- **Phase 2 is the big one.** 153 call sites across 11 modules. The borrow-checker diagnostic for holding two operators at once is among Rust's least readable; expect to meet it in `flows` specifically, where three repositories are bound at once in two places.
- **A forgotten `commit()` rolls back silently** — sqlx rolls back a dropped transaction. This is confined to composite operations and is the sharpest edge of the ADR-0004 design. Every composite operation needs a test that asserts its writes actually landed.
- **Phase 4 changes user-visible behaviour** by design: retypes that used to succeed silently will now prompt. The uniform consent rule means a task→goal retype with a plan always prompts, and plans are common. Watch for prompt fatigue; if it becomes a complaint, the asymmetric rule (consent for children, notification for fields) is the fallback.
- **Phase 5 has no existing test for `convert_to_flow`**, so Phase 2's Task 2.3 regression test is doing real work — do not skip it.
