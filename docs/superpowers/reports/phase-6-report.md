# Phase 6 — `load_mindmap`

Collapses the mindmap's load fan-out into one backend command, and converts a pre-existing silent
drop into a user-visible notice on the way.

Base: `acaea4e` ("Move five test files off the repository shims"). Branch: `phase-6-load-mindmap`.

---

## 1. The envelope

Rust: `src-tauri/src/mindmap/model.rs`. TypeScript mirror: `src/api/mindmap.ts`.

### `MindmapLoad`

Thirteen resource-wide lists, each field byte-for-byte what the command it replaces returns, plus
one per-flow field. Field names serialise as written (the models carry no `rename_all`), so the
TypeScript interface is snake_case and matches every other payload in `src/api/`.

| Field | Type | Stands in for |
|---|---|---|
| `domains` | `Vec<Domain>` | `list_domains(None)` |
| `goals` | `Vec<Goal>` | `list_goals` |
| `tasks` | `Vec<Task>` | `list_tasks` |
| `infos` | `Vec<Info>` | `list_infos` |
| `flows` | `Vec<Flow>` | `list_flows` |
| `flow_goals` | `Vec<FlowGoal>` | `list_all_flow_goals` |
| `flow_tasks` | `Vec<FlowTask>` | `list_all_flow_tasks` |
| `flow_cycles` | `Vec<FlowItemCycle>` | `list_all_flow_cycles` |
| `flow_dependencies` | `Vec<FlowDependency>` | `list_all_flow_dependencies` |
| `block_reasons` | `Vec<BlockReason>` | `list_all_block_reasons` |
| `task_dependencies` | `Vec<TaskDependencyEdge>` | `list_all_task_dependencies` |
| `flow_instance_nodes` | `Vec<TargetRef>` | `list_flow_instance_nodes` |
| `lifecycles` | `Vec<ItemLifecycle>` | `derive_scope_lifecycles(now)` |
| `habits` | `Vec<FlowHabitEntry>` | the per-flow wave — `generate_habit_iterations` + `list_habit_item_statuses`, once per flow |

No field is derived or assembled. The envelope is a bag of what the frontend already fetched.

### How a per-flow failure is represented

```rust
pub struct FlowHabitEntry {
    pub flow_id: i64,
    pub flow_title: String,      // so a notice can name the flow without a second lookup
    pub result: FlowHabitResult,
}

#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum FlowHabitResult {
    Loaded { iterations: Vec<HabitIteration>, statuses: Vec<HabitItemStatus> },
    Failed { message: String },
}
```

On the wire:

```json
{ "flow_id": 7, "flow_title": "Standup",
  "result": { "outcome": "loaded", "iterations": [...], "statuses": [...] } }

{ "flow_id": 8, "flow_title": "Retro",
  "result": { "outcome": "failed", "message": "invalid flow start: a habit requires a scoped flow" } }
```

A tag-discriminated union, so the frontend narrows on `result.outcome` — no `any`, no `as`:

```ts
export type FlowHabitResult =
  | { outcome: "loaded"; iterations: HabitIteration[]; statuses: HabitItemStatus[] }
  | { outcome: "failed"; message: string };
```

Three design points worth stating, because each was a choice:

**The two payloads fail together, not separately.** `iterations` and `statuses` are one variant,
not two independently-failable fields. They are consumed together — iterations are rendered
coloured by the statuses — so there is nothing honest to draw from one without the other. A
finer-grained union would carry a state the renderer has no meaning for.

**Entries are positional *and* keyed.** `habits[i]` corresponds to `flows[i]`, which is what
`injectHabitInstances` needs (it indexes `iterationsByFlow[i]`). `flow_id` is carried anyway so a
consumer can key by it rather than trusting order, and the integration test asserts the two agree.

**"Not a Habit" is `Loaded`, not `Failed`.** `generate_habit_iterations` rejects a flow with no
recurrence — which is nearly every flow. The old frontend swallowed that with `.catch(() => [])`,
conflating it with a real failure. The backend now probes `get_recurrence` first: no recurrence
means no iterations, which is an answer. What remains in the failure path is a flow that *is* a
Habit and could not be derived. Without this distinction the new notice would fire about every
ordinary flow on every load, and would be worse than the silence it replaced.

---

## 2. Round trips — measured

Measured empirically, not derived. A throwaway probe test rendered each version of the hook
against a mocked `invoke` with N flows and counted `invoke.mock.calls.length`. (The probe files
were deleted after measuring; the permanent version of the "after" assertion lives in
`use-mindmap-data.test.ts` as *"fetches the whole mindmap in a single round trip"*.)

| Flows (N) | Before | After |
|---|---|---|
| 0 | **13** | **1** |
| 1 | **15** | **1** |
| 3 | **19** | **1** |
| 10 | **33** | **1** |

`13 + 2N → 1`, confirmed at four values of N. Note this is per *load*, and every mutation in the
hook ends with a reload — so a board with ten flows paid 33 IPC round trips after every rename,
move, create and delete.

The two "dependent" calls in the plan's description are each a `Promise.all` **per flow**
(`use-mindmap-data.ts:624-626`, duplicated at `:641`/`:661`), which is where the `2N` comes from —
the plan's flat "15" undercounted every database with more than one flow.

---

## 3. Resolving the dependent wave backend-side

`src-tauri/src/mindmap/mod.rs`, free function `load(db: &mut Db<Transactional>, now)`.

It touches nine resources, so per ADR-0004 it is a **free function over the session**, not an
operator method. Operators are borrowed inline per call and never bound (`db.domains().list(…)`,
`db.flows().list_all_goals()`, …).

The order is what makes the wave collapse: the twelve independent lists and the lifecycle
derivation run first, then `db.flows().list()`, then a loop over that list building one
`FlowHabitEntry` per flow on the same connection. What used to be a second IPC wave that could not
start until the first resolved is now a sequence of statements on one connection.

Per flow, `habit_payload` does: `get_recurrence` → (if a Habit) `flows::generate_habit_iterations`
→ `list_item_statuses`. `habit_entry` wraps that in a `match`, turning an `Err` into
`FlowHabitResult::Failed { message }` and logging it at `warn`. The error is recorded, never
discarded — this is the only place in the load that catches, and it hands the reason onward.

### The transaction ruling, and its cost

`load_mindmap` opens `factory.begin()` and commits.

`generate_habit_iterations` is not a read: materialising each iteration window mints the canonical
scope rows it lands on. The plan's "pooled session, read-only, no transaction needed" was wrong
about the payload. Mode follows the operation's consistency requirement, so the whole load runs
transactional.

**This holds a write transaction open across the entire load** — thirteen list queries, a
lifecycle derivation over every task and goal, and the per-flow loop. On SQLite that is a single
`BEGIN`/`COMMIT` spanning the whole render's worth of reads, and it serialises against any
concurrent writer for that window. In a single-user desktop app with one frontend this is
acceptable and is strictly better than the fan-out it replaces (which took and released thirteen
pooled connections plus 2N more, each `generate_habit_iterations` its own transaction). It is
noted here because it is a real property of the design, not an oversight.

A second consequence: if flow A's derivation fails part-way after minting some scopes, those
inserts are inside the load's transaction and are committed with everything else. Scope rows are
idempotent get-or-create canonical rows, so an extra one is inert. Isolating each flow behind a
`SAVEPOINT` would be the strict fix, but the session API exposes no nested transaction and
extending it is outside this phase. Flagged under Concerns.

---

## 4. The command-level test, and the commit removal

`src-tauri/tests/mindmap_commands.rs`, five tests, reached through `helpers::command_host(&pool)`
+ `app.state()` so the real command function runs with a real `State<SessionFactory>`.

| Test | Asserts |
|---|---|
| `the_envelope_carries_what_the_individual_commands_return` | every field equals the command it replaces, compared as `serde_json::to_value` (most models derive no `PartialEq`, and the wire form is what the frontend receives). Plus: one habit entry per flow, in flow order, with matching `flow_id`/`flow_title`, and both payloads equal to `generate_habit_iterations` / `list_habit_item_statuses` for that flow. |
| `the_command_commits_the_scopes_its_habit_derivation_materialises` | **row contents**: every derived iteration's `anchor_scope_id` exists in the `scopes` table after the command returns, and the total scope count grew. |
| `one_flow_failing_is_recorded_on_its_entry_and_the_rest_still_loads` | a broken Habit's entry is `Failed` with a non-empty message and its title; the healthy Habit is still `Loaded`; domains/tasks/goals all arrived. |
| `a_flow_with_no_recurrence_loads_as_an_empty_habit_not_a_failure` | an ordinary flow is `Loaded` with empty iterations — the distinction the notice depends on. |
| `an_empty_database_loads_an_empty_envelope` | no flows, no per-flow wave; the seeded aspects still match `list_domains`. |

The seeded fixture covers every field: two domains, a goal, two tasks with a dependency and a block
reason, an info, and two flows — one a Habit with a goal item, a task item, a cycle, an intra-flow
dependency and a recurrence.

The broken-Habit state is reached **through the public API**, not raw SQL: `set_flow_recurrence`
refuses an unscoped flow, so the recurrence goes on a scoped flow first and `update_flow` then
clears `flow_duration_kind` (`Some(None)`), which it permits. That is a state a user can actually
produce, which is why the failure path exists.

The pool has one connection; every pool read happens after the command's session has closed.

### Commit removal — verified

`db.commit().await.map_err(WireError::from_error)?;` deleted from `src/commands/mindmap.rs`. It
compiles (the function still returns `Ok(load)`), and:

```
running 5 tests
test an_empty_database_loads_an_empty_envelope ... ok
test a_flow_with_no_recurrence_loads_as_an_empty_habit_not_a_failure ... ok
test the_envelope_carries_what_the_individual_commands_return ... ok
test one_flow_failing_is_recorded_on_its_entry_and_the_rest_still_loads ... ok
test the_command_commits_the_scopes_its_habit_derivation_materialises ... FAILED

failures:

---- the_command_commits_the_scopes_its_habit_derivation_materialises stdout ----

thread 'the_command_commits_the_scopes_its_habit_derivation_materialises' panicked at
tests/mindmap_commands.rs:361:5:
the canonical scopes each window landed on must be committed, not rolled back

failures:
    the_command_commits_the_scopes_its_habit_derivation_materialises

test result: FAILED. 4 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.89s
```

Note the shape of the failure: the command still returned `Ok` with a fully populated, entirely
correct-looking envelope — three iterations and all. Only the row read off the pool caught it.
Commit restored; all five green again.

(A first attempt substituted `Ok(())?` for the line rather than deleting it, which does *not*
compile — `E0282`/`E0283`, the error type is unconstrained. Deleting the line is the faithful
simulation of a forgotten commit, and that is what was run.)

---

## 5. How per-flow failures reach the user

The ruling was: do not ignore errors — where we ignore them today, toast instead.

Today each per-flow call is `.catch(() => [])`, so a failed derivation renders as a flow with no
repetitions, indistinguishable from a flow that genuinely has none. That silent drop is now gone.

`reportHabitFailures` in `use-mindmap-data.ts` runs after the tree is set:

- filters `data.habits` for `outcome === "failed"`;
- returns immediately when there are none;
- otherwise pushes one `StatusToast` through the existing `useMindmapStore.showToast`.

**Anchor.** The store's toast is positioned on a node id. The chosen anchor is the node the missing
iterations would have hung under — the flow's target node when it has one, else `flow-<id>` — the
same `hostId` `injectHabitInstances` computes. So the notice appears exactly where the absent
children would have been.

**Wording.** Two keys in the `warnings` namespace (`src/i18n/locales/en/warnings.json`), using the
canonical user-facing vocabulary ("Habit", "iterations"):

```json
"habitLoadFailed":     "Habit iterations for \"{{title}}\" could not be loaded",
"habitLoadFailedMore": "Habit iterations for \"{{title}}\" and {{count}} other flows could not be loaded"
```

The store holds one pending toast, so several failures name the first flow and count the rest.

**Crucially, the load still succeeds.** `error` stays `null`, the tree renders. `MindmapView`
replaces the whole canvas when `error !== null`, so routing a per-flow failure there would have
been precisely the regression the ruling exists to prevent.

Covered by three new hook tests: a failure toasts with the singular key on `flow-7`; several
failures use the plural key; a clean load raises no toast.

**One caveat, stated plainly.** `MindmapView` renders the toast only when the anchor node has a
laid-out position (`positions.get(pendingToast.nodeId)`). A failure on a flow hosted under a
collapsed or off-tree node would still show nothing. That is pre-existing behaviour of the toast
mechanism, not something introduced here, and fixing it means new UI beyond this phase's scope.
Flagged under Concerns.

---

## 6. No assembly logic changed

Verified mechanically, not by eye — `buildTree` and `injectHabitInstances` were sliced out of the
base version of the file and out of the new one and compared:

```
injectHabitInstances: IDENTICAL (53 lines)
buildTree:            IDENTICAL (the only diff in the compared region is the two new
                      helper functions appended *after* buildTree's closing brace)
```

The tree is still built in the frontend. `buildTree` now reads `data.domains`, `data.goals`, … in
place of thirteen awaited promises, and `injectHabitInstances` receives
`habitIterations(data.habits)` / `habitStatuses(data.habits)` — two one-line `.map`s in
`src/api/mindmap.ts` that turn the tagged entries back into the positional arrays the function has
always taken. Its signature is unchanged.

### `load` / `silentLoad`

Collapsed to one `load(showSpinner: boolean)`. The two were byte-identical apart from `silentLoad`
omitting `setIsLoading(true)` and the `finally { setIsLoading(false) }`, so the flag guards exactly
those two lines and nothing else:

```ts
if (showSpinner) setIsLoading(true);
…
finally { if (showSpinner) setIsLoading(false); }
```

Every `await silentLoad()` became `await load(false)`; the mount effect and the public `reload`
(`useCallback(() => load(true), [load])`) pass `true`. No behaviour differs beyond the spinner.

---

## 7. Verification — before and after

Baselines were established on the untouched base, with my changes physically set aside (new files
moved out, edited files `git checkout`ed) rather than assumed.

**Important:** the *first* frontend baseline attempt reported 12 failed files / 18 failed tests and
2 vitest worker-startup timeouts. That was CPU contention — another agent's `cargo build` was
running in a sibling worktree at the time. Re-run in isolation, the baseline is clean. The numbers
below are the isolated runs.

### Backend — `src-tauri/`

| Command | Before | After |
|---|---|---|
| `cargo build` | `Finished dev profile … in 2.73s`, 0 warnings | `Finished dev profile … in 26.52s`, 0 warnings |
| `cargo clippy --all-targets` | `Finished` — **0 warnings, 0 errors** | `Finished` — **0 warnings, 0 errors** |
| `cargo test` | **324 passed, 0 failed** (14 binaries) | **329 passed, 0 failed** (15 binaries) |

The +5 is `tests/mindmap_commands.rs`; every pre-existing binary's count is unchanged
(133/0/8/4/18/43/16/0/12/13/13/50/14 before, with `5` inserted for the new binary after).

### Frontend — repo root

| Command | Before | After |
|---|---|---|
| `npm test` | **78 files, 1002 passed, 0 failed** | **78 files, 1006 passed, 0 failed** |
| `npm run build` | `✓ built in 10.31s` | `✓ built in 2.53s` |
| `npm run lint` | clean, no output | clean, no output |
| `npx tsc --noEmit` | — | clean, no output |

The +4 is in `use-mindmap-data.test.ts` (70 → 74): the single-round-trip assertion and the three
toast tests. No test file was added or removed.

---

## 8. Files changed

**Added**

- `src-tauri/src/mindmap/mod.rs` — the free function over the session (`load`, `habit_entry`, `habit_payload`).
- `src-tauri/src/mindmap/model.rs` — `MindmapLoad`, `FlowHabitEntry`, `FlowHabitResult`.
- `src-tauri/src/commands/mindmap.rs` — the thin command.
- `src-tauri/tests/mindmap_commands.rs` — five command-level tests.
- `src/api/mindmap.ts` — typed wrapper, mirrored types, the two positional adapters.

**Modified**

- `src-tauri/src/lib.rs` — `pub mod mindmap;` and one `invoke_handler!` line.
- `src-tauri/src/commands/mod.rs` — `pub mod mindmap;`.
- `src/components/MindmapView/use-mindmap-data.ts` — imports; `habitHostId` + `reportHabitFailures`; `load`/`silentLoad` collapsed; 22 call sites renamed; `reload`.
- `src/components/MindmapView/use-mindmap-data.test.ts` — stubs serve `load_mindmap`; 4 new tests.
- `src/i18n/locales/en/warnings.json` — two keys.
- `CHANGELOG.md` — one `[Unreleased] / Changed` entry.

`VERSION.txt` untouched. `cargo fmt` not run.

The fourteen commands `load_mindmap` replaces are all **left in place**, as instructed.

---

## 9. Self-review findings

**Things I changed after a second look.**

1. *The `Failed` variant initially swallowed non-Habit flows.* First implementation just called
   `generate_habit_iterations` and recorded any `Err`. Every plain flow in the database would have
   produced a `Failed` entry and a notice on every load. Probing `get_recurrence` first is what
   makes the notice mean something.
2. *`Ok(())?` does not compile.* The commit-removal experiment had to delete the line, not
   substitute a no-op expression. Worth recording because the phase brief suggested the
   substitution form.
3. *`failedHabitFlowTitles` was dead on arrival.* Written in `src/api/mindmap.ts` before the toast
   design settled, then never used. Removed rather than left as speculative surface.
4. *`habitHostId` duplicates an expression inside `injectHabitInstances`.* Deliberate: extracting
   it and calling it from `injectHabitInstances` would have modified assembly code, which the scope
   note forbids. Two occurrences is under the rule of three anyway.

**Test-mock change, flagged explicitly.** The regression net in `use-mindmap-data.test.ts` stubs
`invoke` per command. With the fan-out gone those thirteen stubs answer nothing, so `setupInvoke`
had to change. The change is confined to the mock layer: `extras` is still keyed by the command a
test is thinking of (`list_domains: [...]`, `list_flows: [...]`), and a typed `listExtra` helper
folds those into the envelope. **Every test body and every assertion is untouched**, and all 70
original tests pass unmodified. Nine of them failed on the first attempt (the `retypeNode` group,
which supplies `list_domains`/`list_flows`/`list_infos` extras) — which is exactly the check
working: the net caught a fixture that had stopped reaching the hook.

---

## 10. Concerns

1. **A write transaction spans the whole load.** Section 3. Correct per the ruling — mode follows
   the consistency requirement — but it is a long `BEGIN`/`COMMIT` for what reads like a query,
   and worth revisiting if a second writer ever exists.
2. **No per-flow rollback isolation.** A flow that fails part-way through minting scopes leaves
   those rows in the committed transaction. They are idempotent canonical scope rows, so this is
   inert today. Doing it strictly needs `SAVEPOINT` support on `Db`, which this phase did not add.
3. **The toast needs a laid-out anchor.** Section 5. A failure under a collapsed node still shows
   nothing. Pre-existing limitation of `StatusToast`, now load-bearing for a case it wasn't before.
4. **One toast slot.** Several failing flows collapse to "X and N other flows". Adequate, but the
   detail of *which* others is only in the `tracing::warn!` log, not on screen.
5. **The `t()` assertions test keys, not copy.** i18next is not initialised under vitest, so `t`
   echoes the key. The tests assert the singular vs plural key was chosen and the anchor is right;
   they cannot assert the rendered sentence. Consistent with how the rest of the suite works.
6. **`lifecycles` is the expensive field.** `derive_all_scope_lifecycles` walks every task and goal
   climbing scope chains. It was already paid on every load; collapsing the round trips does not
   make it cheaper, and it is now inside the transaction. If load latency is still felt after this
   phase, that is where to look next — not at the IPC count.
