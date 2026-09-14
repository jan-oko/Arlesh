# Phase 3 — The ancestry chain

Branch `phase-3-ancestry`, based on `acaea4e` ("Move five test files off the repository shims").

All four tasks (3.1–3.4) are complete. The four walks were as similar as the plan claimed —
identical in structure, differing only in what they sought, where they started, and what a broken
chain meant — with one wrinkle in the tasks-only plan search that the shared chain shape handles
cleanly rather than fights. See *The tasks-only quirk* below.

---

## The types

`src-tauri/src/tasks/ancestry.rs` (new, private module inside `tasks`; everything `pub(super)`).

```rust
enum NodeKind { Task, Goal }                     // which of the two scoped tables

struct NodeRef { node_type: String, node_id: i64 }   // polymorphic parent_type/parent_id pair

struct AncestryLink {                            // the narrow link record
    kind: NodeKind,
    id: i64,
    parent: NodeRef,
    time_scope: Option<TimeScope>,
    plan: Option<TimeScope>,                     // always None for a goal
    on_scope_exit: Option<OnScopeExit>,
}

enum BreakCause { Missing, Cycle }

enum ChainEnd {
    Root,                                        // climbed off the top into a project/domain
    Broken { kind: NodeKind, id: i64, cause: BreakCause },
}

struct AncestryChain { links: Vec<AncestryLink>, end: ChainEnd }   // links are nearest-first
```

`ChainEnd::Broken` carries a `NodeKind` rather than a `NodeRef` on purpose: a break can only ever
be on a task or goal reference (anything else ends the chain at the root instead), so the write
path's error mapping is total with no unreachable fallback arm to guess at.

### The climb (impure)

```rust
async fn climb<M: SessionMode>(db: &mut Db<M>, start_type: &str, start_id: i64)
    -> Result<AncestryChain, TaskError>
```

Free function over `&mut Db<M>`, generic over the session mode — it reaches two resources, so per
ADR-0004 it cannot be an operator method, and it is read-only, so it serves a pooled read command
and a transactional writer alike. **The starting node is the first link**; the three ancestor
searches get ancestors-only by starting the climb at the parent reference, which is what their
signatures already pass.

A `HashSet<(NodeKind, i64)>` of visited nodes is the cycle guard: a repeat terminates the walk and
reports `ChainEnd::Broken { cause: Cycle }`. A dangling reference (`TaskNotFound`/`GoalNotFound`)
reports `cause: Missing`. Every other database error propagates, as before.

### The narrow query

Two module-private operator methods, `TaskOperator::ancestry_link` and
`GoalOperator::ancestry_link`, in `src-tauri/src/tasks/mod.rs`. They read nine columns for a task
(seven for a goal) with no tag join, against `get`'s `SELECT *` (sixteen columns) plus a second
query for tags. **This query genuinely did not exist before** — every step of every one of the four
walks went through `get`. Both methods are private to the `tasks` module, so the climb (a
descendant module) can call them and nothing outside can, matching the ADR's privacy corollary.

### The pure searches (3.2)

Methods on `AncestryChain`. No database, no `async`.

```rust
fn nearest_scoped(&self)  -> Search<(&TimeScope, OnScopeExit)>
fn nearest_planned(&self) -> Search<&TimeScope>
```

with

```rust
enum Search<T> {
    Found(T),
    Unconstrained,                                            // definitively nothing above
    Undetermined { kind: NodeKind, id: i64, cause: BreakCause },   // the chain broke first
}

impl<T> Search<T> {
    fn or_unconstrained(self) -> Option<T>;                   // read path: log and keep going
    fn or_reject(self) -> Result<Option<T>, TaskError>;       // write path: refuse
}
```

`Search`'s three-way answer is the substance of the phase. The old walks could only say "found" or
"nothing found", and the second folded together *nothing above this is scoped* with *the chain
broke and I cannot tell* — the conflation the plan names as what let the write path skip validation
on a corrupt tree. The policy split is now a single named call at each site rather than a property
of which of four near-identical functions you happened to reach for.

`or_unconstrained` emits a `tracing::warn!` with structured fields when it swallows a break. The
settled decision was "reported, never swallowed"; the old `scope_governance` swallowed silently.

### The pure containment check (3.4)

`src-tauri/src/tasks/scope_rules.rs`:

```rust
struct ContainmentWindows {          // all four already resolved, all optional
    own_scope: Option<Bounds>,
    plan: Option<Bounds>,
    ancestor_scope: Option<Bounds>,
    ancestor_plan: Option<Bounds>,
}

fn check_containment(windows: ContainmentWindows) -> Result<(), TaskError>
```

Three rules in the order the old function checked them, **first violation only** — an explicit
non-goal to collect more, and keeping the order means a given bad write still produces the message
it did. Every rule is conditional on both its windows being present, which is what makes
`validate_goal_containment` a *structural* subset rather than a copy: a goal has no Plan, so `plan`
and `ancestor_plan` are absent and rules one and three cannot fire, leaving rule two alone.

---

## TDD evidence

### 3.1 — the chain climb

RED. `climb` stubbed to return an empty rooted chain.

```
$ CARGO_INCREMENTAL=0 cargo test --lib tasks::ancestry
running 4 tests
test tasks::ancestry::tests::a_three_deep_chain_climbs_to_the_root ... FAILED
test tasks::ancestry::tests::a_start_that_is_not_a_scoped_node_yields_an_empty_rooted_chain ... ok
test tasks::ancestry::tests::a_cyclic_parent_chain_terminates_as_broken ... FAILED
test tasks::ancestry::tests::a_chain_whose_middle_parent_is_missing_ends_as_broken ... FAILED

---- tasks::ancestry::tests::a_three_deep_chain_climbs_to_the_root stdout ----
assertion `left == right` failed: the chain must include the starting node and climb through the goal
  left: []
 right: [(Task, 3), (Task, 2), (Goal, 1)]
---- tasks::ancestry::tests::a_cyclic_parent_chain_terminates_as_broken stdout ----
assertion `left == right` failed
  left: []
 right: [(Task, 4), (Task, 5)]
---- tasks::ancestry::tests::a_chain_whose_middle_parent_is_missing_ends_as_broken stdout ----
assertion `left == right` failed
  left: []
 right: [(Task, 3)]

test result: FAILED. 1 passed; 3 failed; 0 ignored; 0 measured; 133 filtered out; finished in 0.38s
```

GREEN, after implementing the climb and the two narrow queries.

```
$ CARGO_INCREMENTAL=0 cargo test --lib tasks::ancestry
running 4 tests
test tasks::ancestry::tests::a_start_that_is_not_a_scoped_node_yields_an_empty_rooted_chain ... ok
test tasks::ancestry::tests::a_three_deep_chain_climbs_to_the_root ... ok
test tasks::ancestry::tests::a_cyclic_parent_chain_terminates_as_broken ... ok
test tasks::ancestry::tests::a_chain_whose_middle_parent_is_missing_ends_as_broken ... ok

test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 133 filtered out; finished in 2.90s
```

### 3.2 — the pure searches

RED. Both searches stubbed to `Search::Unconstrained`. Thirteen new tests, all over handwritten
chains — **none of them opens a database**, which is the property the split exists to buy.

```
$ CARGO_INCREMENTAL=0 cargo test --lib tasks::ancestry
failures:
    tasks::ancestry::tests::both_policies_pass_a_found_answer_and_an_unconstrained_one_straight_through
    tasks::ancestry::tests::nearest_planned_ignores_a_break_beyond_the_goal_that_already_stopped_it
    tasks::ancestry::tests::nearest_planned_on_a_chain_broken_at_a_task_is_undetermined
    tasks::ancestry::tests::nearest_planned_takes_the_nearest_task_plan
    tasks::ancestry::tests::nearest_scoped_defaults_a_missing_on_exit_to_keep_and_otherwise_reports_the_stored_one
    tasks::ancestry::tests::nearest_scoped_on_a_broken_chain_with_nothing_scoped_is_undetermined
    tasks::ancestry::tests::nearest_scoped_prefers_a_scope_found_before_the_chain_broke
    tasks::ancestry::tests::nearest_scoped_takes_the_first_scoped_link_climbing_through_goals
    tasks::ancestry::tests::the_write_policy_rejects_an_undetermined_search_with_the_reference_it_could_not_follow

test result: FAILED. 8 passed; 9 failed; 0 ignored; 0 measured; 133 filtered out; finished in 0.75s
```

Representative failure, showing the answer genuinely being asked for:

```
---- tasks::ancestry::tests::nearest_scoped_on_a_broken_chain_with_nothing_scoped_is_undetermined ----
assertion `left == right` failed: the scope walk needed that goal, so the question is unanswered — not answered 'no'
  left: Unconstrained
 right: Undetermined { kind: Goal, id: 2, cause: Missing }
```

GREEN.

```
$ CARGO_INCREMENTAL=0 cargo test --lib tasks::ancestry
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 133 filtered out; finished in 1.66s
```

### 3.4 — the pure containment check

RED. `check_containment` stubbed to `Ok(())`.

```
$ CARGO_INCREMENTAL=0 cargo test --lib tasks::scope_rules
failures:
    tasks::scope_rules::tests::a_goal_shaped_check_reduces_to_the_ancestor_rule_alone
    tasks::scope_rules::tests::a_plan_escaping_its_own_time_scope_is_rejected
    tasks::scope_rules::tests::a_plan_escaping_the_nearest_planned_ancestor_is_rejected
    tasks::scope_rules::tests::a_time_scope_escaping_the_nearest_scoped_ancestor_is_rejected
    tasks::scope_rules::tests::the_first_violation_is_the_only_one_reported

(each: "expected a containment violation, got Ok(())")

test result: FAILED. 2 passed; 5 failed; 0 ignored; 0 measured; 150 filtered out; finished in 0.00s
```

GREEN, after restoring the check and collapsing both validators onto it.

```
$ CARGO_INCREMENTAL=0 cargo test --lib tasks::
test result: ok. 60 passed; 0 failed; 0 ignored; 0 measured; 97 filtered out; finished in 0.21s
```

---

## The tasks-only plan-search quirk

The old `nearest_planned_ancestor_window` matched only `"task"` and returned `Ok(None)` for
everything else, so a goal ended the walk **without the goal ever being read**. The scope walk,
by contrast, climbs *through* goals. Naively feeding both searches off one chain would change
behaviour, because the shared climb reads that goal and can fail on it:

> task *(no plan, no scope)* → goal *(deleted)*
>
> Old: the plan search stops at `"goal"` and answers `None` — no read, no error.
> Naive shared chain: the climb tries to read the goal, breaks, and the plan search reports the
> break — turning an accepted write into a rejected one.

The fix is in the search, not the climb: **a break on a goal reference ends the plan search
definitively**, because that is exactly where the tasks-only walk would have stopped anyway. Only a
break on a *task* reference leaves the plan question unanswered.

```rust
match self.end {
    ChainEnd::Broken { kind: NodeKind::Task, .. } => self.exhausted(),   // Undetermined
    ChainEnd::Broken { .. } | ChainEnd::Root      => Search::Unconstrained,
}
```

The test that pins it asserts **both halves on one chain**, which is the only way to show the two
searches disagree by design rather than by accident:

`nearest_planned_ignores_a_break_beyond_the_goal_that_already_stopped_it`
(`src-tauri/src/tasks/ancestry.rs`) builds `[task 1] + Broken{Goal, 2, Missing}` and asserts

- `chain.nearest_planned() == Search::Unconstrained` — "the tasks-only walk stops at that goal
  without reading it, so the break is moot"
- `chain.nearest_scoped() == Search::Undetermined { kind: Goal, id: 2, cause: Missing }` — "the
  same chain leaves the scope question unanswered — this pair is the quirk"

A second test, `nearest_planned_stops_at_a_goal_and_ignores_every_plan_above_it`, pins the rule
itself on a chain with a planned task *above* a goal. The schema cannot currently produce that
tree (a goal's `parent_type` is checked against `project`/`goal`/`domain`, never `task`), so the
chain is hand-built deliberately: the test pins the *search's* contract rather than the schema's
accident, and it is the search the four walks disagreed about.

---

## The corrupt-tree test

`src-tauri/tests/tasks.rs`, two tests, each asserting the read and write halves against **one
tree**.

`a_dangling_ancestor_renders_fine_and_rejects_a_write` — a goal deleted with raw SQL that skips
the cascade, leaving a task pointing at nothing:

- `derive_all_scope_lifecycles` renders the orphan as `Timing::Active` (unconstrained).
- `create_task` under that orphan, with a Time Scope, fails with `TaskError::GoalNotFound(goal.id)`
  — naming the reference it could not follow — and leaves no row behind.

`a_cyclic_ancestor_chain_renders_fine_and_rejects_a_write` — tasks 9001 and 9002 inserted raw as
each other's parent:

- `derive_all_scope_lifecycles` **terminates**, renders both cyclic tasks as `Active`, and still
  renders the healthy task beside them. Before the guard this hung the process.
- `create_task` under 9001, with a Time Scope, fails with `TaskError::AncestorCycle { .. }` and
  leaves no row behind.

---

## What a write-side cycle guard would take — scoped, not built

**Closing only the read side leaves the corrupt tree creatable.** Nothing in `update_task`,
`update_goal`, `reparent_conflicts` or the schema stops a node being reparented under its own
descendant. After Phase 3 the app no longer hangs on such a tree and no longer writes scoped rows
beneath it, but the cycle itself is still written and still persists.

### Where it belongs

Only two paths can create one: `update_task` and `update_goal`, in the branch where
`TaskWrite`/`GoalWrite` carries a `reparent`. Creation cannot — a brand-new row has no descendants.

It is a **check-then-write** whose read the write depends on, and **no schema constraint expresses
acyclicity** of the polymorphic parent link (there is no foreign key on it at all). So by
ADR-0004's rule it must live on a `Db<Transactional>` free function, exactly like
`add_task_dependency` — which both `update_task` and `update_goal` already are, so no signature
changes.

### What it costs

The predicate is already available: climb from the *new* parent and look for the node being moved.

```rust
// on AncestryChain — pure, unit-testable with no database
fn contains(&self, kind: NodeKind, id: i64) -> bool {
    self.links.iter().any(|link| link.kind == kind && link.id == id)
}
```

- ~10 lines of production code, plus two call sites guarded on `reparent.is_some()`.
- One climb can serve both the cycle check and `validate_*_containment`, since both start from the
  effective parent — worth threading rather than climbing twice.
- A **new** error variant, not a reuse of `AncestorCycle`. `AncestorCycle` means *the stored tree
  is corrupt* and maps to `WireErrorKind::Internal`; a refused reparent is a bad **request** and
  wants `InvalidRequest`, e.g. `CircularParent { node_id, new_parent_id }`.
- `reparent_conflicts` is the pre-flight the drag-and-drop UI calls before committing a move, so
  it should refuse there too — one more field on `ReparentConflicts` plus the TypeScript side.
  This is the larger half of the work.
- Tests: a pure unit test for the predicate; integration tests for self-parent, parent-under-child,
  and a three-level move.

Rough size: backend half a day, with the frontend pre-flight about a day.

### Two things to decide with it, not after it

1. **Existing corrupt data.** A guard prevents new cycles; it repairs none. Whether to detect and
   reparent-to-root on startup, or leave it, is a separate call.
2. **A cycle can trap the nodes inside it.** A scoped node inside a cycle cannot currently be
   *moved out*, because `update_task` carries the stored Time Scope forward into
   `validate_task_containment`, which climbs and rejects with `AncestorCycle`. An *unscoped* node
   escapes fine (the validator returns early with nothing to check). So the read-side guard, on its
   own, can make a corrupt subtree unrepairable through the UI. That is an argument for doing the
   write-side guard sooner rather than later, and possibly for exempting a pure reparent from the
   ancestry check when the move is provably toward the root.

---

## A separate live hang the ancestor guard does not close

The cycle guard is on the **ancestor** walk. Three **descendant** walks are still unguarded
stack-drains with no visited set, and a cyclic parent link makes each of them loop forever:

- `tasks::delete_task_goal_subtree` (`src-tauri/src/tasks/mod.rs:103`)
- `tasks::delete_infos_under` (`src-tauri/src/tasks/mod.rs:79`)
- `scope_rules::descendants_violating_window` (`src-tauri/src/tasks/scope_rules.rs:331`)

So deleting a subtree containing a cycle, or asking for the descendants a narrowed scope would
orphan, still hangs. Not fixed here — it is outside Phase 3's scope (ancestor walks) and adding a
`HashSet` to three unrelated walks is exactly the kind of ride-along the phase brief asked me not
to do. Each is a two-line fix (`visited.insert` before extending) and they should probably travel
with the write-side guard. Neither of the new tests touches these paths.

---

## Behaviour changes (deliberate, and the ones worth knowing)

Everything the existing suite pins is unchanged. Three things are not pinned by any test and did
change:

1. **A cycle rejects instead of hanging.** New `TaskError::AncestorCycle { node_id }`, mapped to
   `WireErrorKind::Internal` (corrupt persisted data, not a bad request). The variant is the only
   addition to `TaskError`; the exhaustive match in `error::wire` forced it to be classified.

2. **The climb is eager: it reads the whole chain even when the answer is at the first link.** The
   plan's settled decision — "one impure climb returns the chain; every question is a pure search
   over it" — requires this, and making it lazy would put the question back inside the walk. Net
   query cost is roughly a wash: each step drops from two queries (`SELECT *` plus the tag join) to
   one narrow one, so a climb of depth *D* costs *D* queries where the old early-returning walk
   cost 2 × (depth-to-answer). It is worse only for a shallowly-scoped node in a deep tree. One
   consequence worth stating: a genuine (non-not-found) database error on a link *above* the answer
   now propagates where before it was never reached.

3. **On the write path, an unfollowable chain now outranks a containment violation.** If a write
   both breaks rule one *and* sits under a corrupt chain, it now fails with the chain error rather
   than `ScopeContainment`. Both outcomes reject the write; no test covers the ordering; preserving
   it would have meant splitting the pure check in half. First-violation ordering *among the three
   containment rules* is unchanged, which is what the plan meant by behaviour-preserving.

   Relatedly, `validate_task_containment` consults a search only for the rule that needs it
   (guarded on `time_scope.is_some()` / `plan.is_some()`), specifically so that a broken chain
   rejects exactly the writes it rejected before — a write with nothing to validate asks nothing of
   the ancestry and so cannot be refused by it.

---

## Verification

`cargo fmt` was **not** run, per the brief.

### Before (baseline at `acaea4e`, no changes)

```
$ cargo build
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 4.92s

$ cargo clippy --all-targets
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 2m 01s
(zero warnings)

$ cargo test
test result: ok. 133 passed;  (lib)
test result: ok. 0 passed;
test result: ok. 8 passed;
test result: ok. 4 passed;
test result: ok. 18 passed;
test result: ok. 43 passed;
test result: ok. 16 passed;
test result: ok. 0 passed;
test result: ok. 12 passed;
test result: ok. 13 passed;
test result: ok. 13 passed;
test result: ok. 50 passed;   (tests/tasks.rs)
test result: ok. 14 passed;
--- 324 passed, 0 failed ---
```

### After

```
$ cargo build
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 56.03s

$ cargo clippy --all-targets
(zero warnings)

$ cargo test
test result: ok. 157 passed;  (lib — +24: 17 ancestry, 7 scope_rules)
test result: ok. 0 passed;
test result: ok. 8 passed;
test result: ok. 4 passed;
test result: ok. 18 passed;
test result: ok. 43 passed;
test result: ok. 16 passed;
test result: ok. 0 passed;
test result: ok. 12 passed;
test result: ok. 13 passed;
test result: ok. 13 passed;
test result: ok. 52 passed;   (tests/tasks.rs — +2 corrupt-tree tests)
test result: ok. 14 passed;
--- 350 passed, 0 failed ---
```

**324 → 350, +26, none removed, none failing.** `src-tauri/tests/tasks.rs` — the regression net for
containment behaviour — is green throughout, with its 50 pre-existing tests untouched.

`cargo doc --no-deps` reports one warning, pre-existing and unrelated (`derive_all_scope_lifecycles`
links to the private `goal_stored_archival`).

---

## Files changed

| File | Change |
|---|---|
| `src-tauri/src/tasks/ancestry.rs` | **New.** The climb, the link/chain types, `Search` and the two policies, the two pure searches, 17 inline tests. |
| `src-tauri/src/tasks/scope_rules.rs` | Four walks collapsed to thin callers; `nearest_planned_ancestor_window` deleted; `ContainmentWindows` + `check_containment` + `resolve_optional` added; both validators collapsed onto the pure check; 7 inline tests. Net −147 lines of loop body. |
| `src-tauri/src/tasks/mod.rs` | `mod ancestry;`, two narrow row structs, two module-private `ancestry_link` operator methods. Additive only. |
| `src-tauri/src/tasks/error.rs` | `TaskError::AncestorCycle { node_id }`. |
| `src-tauri/src/error/wire.rs` | Classifies it as `WireErrorKind::Internal`. |
| `src-tauri/tests/tasks.rs` | Two corrupt-tree tests plus their helpers. Appended; nothing existing touched. |

No CHANGELOG entry (refactor). No `VERSION.txt` bump.

---

## Self-review findings

- **An early `count_where(&pool, "tasks", "parent_id", orphan.id)` assertion passed for the wrong
  reason and then failed for the right one.** The polymorphic parent link needs *both* halves:
  goal 1 and task 1 are different parents, and matching on `parent_id` alone conflated them.
  Replaced with a `scoped_children_of` helper that binds `parent_type` too. `count_where`'s own doc
  comment warns about a neighbouring footgun in the same helper; this is a second one.
- **`as_db_str` on `NodeKind` was written and then deleted** — once `ChainEnd::Broken` carried a
  `NodeKind` instead of a string, nothing needed it. Removed rather than left for a future caller.
- **`scope_governance`'s doc comment was left mangled** by the first edit (the new paragraph ran
  straight on from the old one). Fixed.
- The first two commits (3.1/3.2) carry transient `dead_code` warnings, because the module exists
  before anything calls it. They clear in the 3.3 commit, and the final state is warning-free. I
  chose that over adding and removing an `#[allow]`.

## Concerns

1. **The unguarded descendant walks** (see above) are the loose end I would close next. A cycle is
   now survivable on the read path and rejected on the write path, but deleting a subtree that
   contains one still hangs, and `descendants_violating_window` — which the clamp-or-cancel prompt
   calls — hangs too.
2. **A cycle can trap scoped nodes inside it**, as described under the write-side guard. This is a
   consequence of doing the read side alone and is worth weighing when scoping the write side.
3. **The eager climb** is a deliberate consequence of the settled ancestry shape, not an oversight,
   but `derive_all_scope_lifecycles` now climbs once per item with no memoisation across siblings —
   the same ancestors are re-read for every child of a node. If the render path ever shows up in a
   profile, a per-derivation cache of `(kind, id) → AncestryLink` is the obvious and contained fix.
4. **Disk exhaustion interrupted the first baseline run** (the volume hit 100%, and rustc failed
   with "No space left on device"). I deleted only this worktree's own
   `target/debug/incremental` and ran the rest with `CARGO_INCREMENTAL=0`. Nothing outside the
   worktree was touched, but the machine is at ~99% and the four Arlesh `target` directories hold
   roughly 17 GB between them.
