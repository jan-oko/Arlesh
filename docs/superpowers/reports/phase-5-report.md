# Phase 5 — The flow renderer: handover report

**Status: no code written. 5.1, 5.2 and 5.3 are all untouched.** The session was stopped during
design, after baseline verification and a full read of `start()`. The working tree is clean apart
from this report; the base is unchanged and green.

This report is therefore a **handover**, not a completion report. Everything below is analysis done
against the live tree, intended to let tomorrow's session skip straight to writing code.

---

## 1. State of each sub-task

| Task | State | Notes |
|---|---|---|
| 5.1 The scope table | **Untouched** | Design settled (§5). No file created. |
| 5.2 The pure renderer | **Untouched** | Design settled (§6). No file created. |
| 5.3 The writer | **Untouched** | Design settled (§7). `start()` is unmodified. |
| Ride-along doc fix | **Untouched** | Correct replacement wording in §9. |

`src-tauri/src/flows/render.rs` **does not exist**. Nothing was created and then reverted — there
was nothing to revert.

---

## 2. Baseline (established before any work, and still the tree's state)

From `/home/atai/Green/CODE/Arlesh/.claude/worktrees/architecture-review/src-tauri`:

```
$ CARGO_INCREMENTAL=0 cargo test
test result: ok. 157 passed; ...   (lib unit tests)
test result: ok. 0 passed;  ...
test result: ok. 8 passed;  ...
test result: ok. 4 passed;  ...
test result: ok. 18 passed; ...
test result: ok. 43 passed; ...    (tests/flows.rs)
test result: ok. 16 passed; ...
test result: ok. 0 passed;  ...
test result: ok. 12 passed; ...
test result: ok. 13 passed; ...
test result: ok. 5 passed;  ...
test result: ok. 13 passed; ...
test result: ok. 52 passed; ...
test result: ok. 14 passed; ...
TOTAL PASSED: 355        exit code 0
```

**355 passing, 0 failing** — matches the brief's stated baseline exactly. `tests/flows.rs`
contributes the 43-test suite. `cargo clippy --all-targets` was **not** re-run this session (the
brief states the baseline is 0 warnings; the build produced no warnings in the `cargo test`
compile). Tomorrow should re-establish clippy at 0 before changing anything — it is cheap now that
the target dir is warm.

Disk at session end: `/dev/nvme0n1p5 299G 275G 8.5G 98%`. No space failures were hit.
`CARGO_INCREMENTAL=0` was used throughout; `cargo fmt` was not run.

---

## 3. Line numbers, re-derived against the current tree

The plan's figures and the preflight scan's figures are **both stale**. These were derived today
against `src-tauri/src/flows/mod.rs` (**2040 lines total**):

| Thing | Plan said | Preflight scan said | **Actual today** |
|---|---|---|---|
| `start()` doc comment | — | 1857–1864 | **1860–1866** |
| `#[tracing::instrument(skip(db))]` on `start` | — | 1864 | **1867** |
| `start()` signature → closing brace | 1600–1753 | 1865–2022 | **1868–2025** |
| Breadth-first walk (comment line) | 1689–1737 | 1959 | **1962** |
| Fan-in remapping (comment line) | 1739 | 2007 | **2010** |
| `Ok(MaterializedFlow { … })` | — | — | **2024** |
| `set_node_private` | — | 2024–2033 | **2027–2040** (doc at 2027) |
| `offset_scope` | 692 | 218–238 | **217–238** |
| `resolve_pair` | 717 | 242–256 | **241–265** |
| `resolve_window` | — | — | **268** |
| `resolve_flow_window` | — | — | **293** |
| `habit_slots` | — | 323 | **322** |
| `FlowOperator` struct | — | — | **397** |
| `record_node` (operator method) | — | — | **968** |

**`start()` is 158 lines** (1868–2025 inclusive), 155 of body excluding signature lines and the
closing brace — the plan's "155 lines" is right even though its location is 268 lines off.

In `src-tauri/tests/flows.rs` (**1578 lines, 43 `#[tokio::test]`**), the `start(&mut db, …)` call
sites are at lines **363, 415, 446, 483, 606, 1033, 1084** — seven tests, as the scan said.

---

## 4. The fan-in remapping — what I learned (the phase's whole point)

**Verdict: it decomposes into a pure function cleanly. There is no obstacle.** I found nothing that
resists the split. Details, because this is the part worth handing over carefully:

The current code (`flows/mod.rs:2010–2022`) is:

```rust
let flow_dependencies = db.flows().list_all_dependencies().await?;
for dep in flow_dependencies.iter().filter(|d| d.flow_id == flow_id.0) {
    let dependents = instances.get(&(dep.dependent_type.clone(), dep.dependent_id)).cloned().unwrap_or_default();
    let blockers  = instances.get(&(dep.depends_on_type.clone(), dep.depends_on_id)).cloned().unwrap_or_default();
    for (dtype, did) in &dependents {
        if dtype != "task" { continue; }              // only tasks can be dependents
        for (btype, bid) in &blockers {
            let dependency = if btype == "goal" { Dependency::Goal { id: *bid } } else { Dependency::Task { id: *bid } };
            add_task_dependency(db, TaskId(*did), dependency).await?;
        }
    }
}
```

Three observations that matter for making it pure:

1. **Its only database input is `list_all_dependencies()`, read once, and it is read *after* every
   write.** But nothing `start()` writes can affect it — `start()` writes `goals`, `tasks`,
   `scopes`, `flow_instances`, `flow_instance_nodes` and `task_dependencies`, and never touches
   `flow_dependencies`. So the read can be **hoisted to the top** with no behaviour change. The same
   argument covers `list_goals` / `list_tasks` / `list_all_cycles`, which today are read *after* the
   root is created (line ~1943 onward). All four reads can move above the first write. I checked
   this specifically because it is the one thing that would have blocked the split, and it holds.

2. **Its other input, `instances`, is already a pure value** — a
   `HashMap<(String, i64), Vec<(String, i64)>>` built during the walk, mapping a template item to
   its materialised nodes in pair order. In the renderer this becomes
   `HashMap<(String, i64), Vec<NodeRef>>` with placeholders instead of real ids. Nothing else about
   the loop changes.

3. **The `Dependency::Goal` / `Dependency::Task` choice is per *blocker instance*, not per template
   item**, and it is the only place the writer needs to reconstruct anything. Since the writer knows
   each written node's kind, the edge can be stated purely as
   `PlannedEdge { dependent: NodeRef, blocker: NodeRef }` and the writer derives the variant. **Do
   not** try to put the `Dependency` enum in the rendered plan — it would drag `TaskId` and real ids
   into a pure type for no gain.

**The asymmetry to test hardest**, and the thing that is easy to get wrong when porting: the
`if dtype != "task" { continue; }` guard applies to **dependents only**. Blockers are *not*
filtered — a goal instance is a perfectly good blocker and yields `Dependency::Goal`. A careless
port that filters both sides, or neither, still passes
`starting_a_flow_materialises_a_subtree_with_fan_in_deps` (which is task-only, 1 × 2 → 2 edges).
**The frozen suite does not cover the goal-dependent or goal-blocker cases at all.** That is exactly
the hole the new unit tests exist to fill, and it is the strongest argument that this phase is worth
doing. Minimum coverage for 5.2:

- 1 dependent instance × 2 blocker instances → 2 edges (the full cross product, both directions).
- 3 dependent × 2 blocker → 6 edges (proves it is a cross product, not a zip — a zip also passes the
  1 × 2 case).
- A **goal** dependent → 0 edges (the `continue`).
- A **goal** blocker with a task dependent → 1 edge, and the writer must pick `Dependency::Goal`.
- A dependency naming an item with **no instances** → 0 edges, no panic (today's
  `.unwrap_or_default()`).
- A dependency belonging to **another flow** → ignored (today's `.filter(|d| d.flow_id == …)`).

---

## 5. The two-round scope gather — does it decompose as the plan describes?

**Yes, and it is already decomposed.** The two rounds live *inside* `resolve_pair`
(`flows/mod.rs:241–265`) and are a genuine data dependency:

- **Round 1** (line 249): `offset_scope(scopes, base, index, kind)` resolves the cycle scope from
  the window start.
- The bridge (250–251): `cycle_start` is parsed out of **that scope row's own `start_date`**.
- **Round 2** (256–257): `offset_scope(scopes, cycle_start, ps, pk)` and `(…, pe, pk)` resolve the
  plan window from `cycle_start`, not from the window start.

The design I settled on — recommended, but unimplemented:

```rust
// src-tauri/src/flows/render.rs
pub(crate) struct ResolvedPair { time_scope: Option<TimeScope>, plan: Option<TimeScope> }

pub(crate) struct ScopeTable {
    window:    Option<TimeScope>,          // the flow window, if the flow is scoped
    root_plan: Option<TimeScope>,          // the root's Cycle Plan under that window
    pairs:     HashMap<i64, ResolvedPair>, // keyed by FlowItemCycle.id
}

pub(crate) async fn resolve_scopes(
    scopes: &mut ScopeOperator<'_>,
    flow: &Flow,
    anchor: NaiveDate,
    cycles: &[FlowItemCycle],   // already filtered to this flow
) -> Result<ScopeTable, FlowError>
```

Key points, each of which cost some thought:

- **Take `&mut ScopeOperator<'_>`, not `&mut Db<Transactional>`.** The gather needs exactly one
  resource. This matches the module doc at `flows/mod.rs:11–13` ("the scope helpers … take a single
  `ScopeOperator`, not the session: they need exactly one resource and ADR-0004 keeps that
  precision") and mirrors `habit_slots`. The caller passes `&mut db.scopes()`, so it is still inside
  the caller's transaction — which is required, because `offset_scope` → `get_or_create` **writes**.
- **Key the table by `FlowItemCycle.id`**, not by `(item_type, item_id, position)`. It is unique,
  it is already on the row, and it makes the table trivially enumerable from the cycle list alone —
  which is the plan's "both rounds are fully enumerable from the cycle-pair list", made concrete.
- **Items with no cycle rows need no entry.** They resolve to `(None, None)` today; the renderer
  should use a default rather than a lookup, so absence is not an error.
- **Reuse `resolve_pair` per pair rather than restructuring into two global passes.** Each call is
  round 1 then round 2. This keeps the scope-minting *order* byte-identical to today and avoids
  duplicating `offset_scope`'s offset arithmetic. Two global passes would also work and would mint
  the same *set* of scopes, but would reorder scope row ids for no benefit.
- `render.rs` is a **child** of `flows`, so it can call the private `super::resolve_pair`,
  `super::offset_scope` and `super::resolve_flow_window` without widening their visibility. Verified
  against Rust's privacy rule (descendants see ancestors' private items); not compiled.

### One behaviour drift this introduces — flagged, unresolved

Today, `resolve_pair` runs only for items **reached by the traversal**. A template item that is
orphaned (its `parent_type`/`parent_id` does not chain back to `"flow"`) is never visited, so its
cycle pairs are never resolved and its scopes are never minted. A gather step that enumerates *all*
of the flow's cycles **will** mint scope rows for those orphans.

Assessment: harmless but real. `scopes` is a shared canonical calendar keyed by unique indexes, so
the extra rows are inert and deduped, and no test counts scope rows. But it **is** a difference, and
tomorrow should decide deliberately rather than discover it. The alternative (gather only reachable
items) requires the traversal to run before the gather, which means splitting the renderer into
shape-then-attach — more machinery than the drift is worth, in my judgement.

---

## 6. The renderer — design settled, not written

```rust
/// Placeholder identity for a node in a rendered plan: an index into `RenderedPlan::nodes`.
pub(crate) struct NodeRef(pub usize);

/// The template row a planned node materialises (drives `record_node`'s bookkeeping).
pub(crate) enum PlannedSource { Root, Item(FlowItemType, i64) }

pub(crate) struct PlannedNode {
    parent:     Option<NodeRef>,   // None = the root; its parent is the start target
    kind:       InstanceType,      // Goal | Task — reuse model::InstanceType, it has as_str()
    title:      String,
    time_scope: Option<TimeScope>,
    plan:       Option<TimeScope>, // used only when kind == Task, as today
    is_private: bool,
    source:     PlannedSource,
}

pub(crate) struct PlannedEdge { dependent: NodeRef, blocker: NodeRef }

pub(crate) struct RenderedPlan { nodes: Vec<PlannedNode>, edges: Vec<PlannedEdge> }

/// Today's local `MItem`, promoted out of `start()`.
pub(crate) struct TemplateItem {
    kind: FlowItemType, id: i64, title: String,
    parent_type: String, parent_id: i64, position: i64, is_private: bool,
}

/// The template as the renderer reads it. Its constructor does the `flow_id` filtering that
/// `start()` currently does inline in two separate loops.
pub(crate) struct FlowTemplate {
    items: Vec<TemplateItem>, cycles: Vec<FlowItemCycle>, dependencies: Vec<FlowDependency>,
}

/// Pure. Total — no `Result`. No database, no clock, no ids.
pub(crate) fn render(
    flow: &Flow,
    root_title: &str,
    template: &FlowTemplate,
    scopes: &ScopeTable,
) -> RenderedPlan
```

`render` is infallible: once the scope table exists, nothing in the walk can fail — every fallible
step in today's loop is a `create_*` call, and those all move to the writer. Keeping it total (no
`Result`) is worth insisting on; it is the clearest possible statement that the decision half has no
failure modes of its own.

### Traversal-order invariants that MUST be ported verbatim

These decide the order rows are created in, hence real row ids. Getting any of them wrong is silent.

1. **`items` is goals-then-tasks**: all of `list_goals(flow_id)` in order, then all of
   `list_tasks(flow_id)` in order. Do not merge-sort them.
2. **The "queue" is a `Vec` used as a stack** (`push` / `pop` from the end) — despite the comment
   calling it breadth-first. All of one parent's children are created before any descent, but
   sibling *subtrees* are descended in **reverse** sibling order. Port it as a `Vec` + `pop()`. Do
   not "fix" it to a `VecDeque`; that reorders every multi-level flow.
3. **`children.sort_by_key(position)` is a stable sort**, so ties fall back to the goals-then-tasks
   order of (1).
4. **Children nest under the *first* instance** of a multi-pair parent (`child_nodes.first()`).
5. **An item with no cycle rows still yields exactly one instance** — `pair_opts` is
   `vec![None]` when `pairs` is empty.

### A latent bug found in the sort key — preserve it, do not fix it here

`flows/mod.rs:1968–1970`:

```rust
children.sort_by_key(|(_, id, _, _)| {
    items.iter().find(|m| m.id == *id).map(|m| m.position).unwrap_or(0)
});
```

The lookup is by **`id` alone**, ignoring the item's kind. `flow_goals` and `flow_tasks` are
separate tables with independent autoincrement, so a goal and a task sharing a numeric id are
routine — and `items` puts goals first, so **a task child can be sorted by an unrelated goal's
position**. Any flow containing both goals and tasks can hit this.

No test in the frozen suite covers it (the mixed-kind start tests do not assert sibling order), so
either behaviour passes. My recommendation, and the assumption the §6 design is written against:
**port it verbatim, comment it as deliberately preserved, and fix it in a separate change.** The
`TemplateItem` carries its own `position`, so the fix is a one-word change (`m.position` from the
child record instead of a lookup) — which is exactly why it must not be slipped in silently: it
reorders materialised siblings, and that is a behaviour change, which this phase's contract forbids.
Do not write a renderer unit test that pins the buggy ordering; test position-ordering within a
single kind, which is correct either way.

---

## 7. The writer — design settled, not written

```rust
#[tracing::instrument(skip(db))]
pub async fn start(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    request: StartFlowRequest,
) -> Result<MaterializedFlow, FlowError> {
    let flow = db.flows().get(flow_id).await?;
    let template = FlowTemplate::load(db, flow_id).await?;   // goals, tasks, cycles, deps
    let table = resolve_scopes(&mut db.scopes(), &flow, request.anchor_date, &template.cycles).await?;
    let plan = render(&flow, &request.title, &template, &table);
    write_plan(db, flow_id, &request, &plan).await
}
```

Roughly **7 lines of body** — comfortably under the 40-line target. `write_plan` is the dumb loop
(~30 lines), holding `record_node`, `open_instance` and the privacy write as the brief requires.

Sketch of `write_plan`, with the two subtleties spelled out:

```rust
let mut written: Vec<(String, i64)> = Vec::with_capacity(plan.nodes.len());
let mut instance: Option<i64> = None;
for node in &plan.nodes {
    // Subtlety 1: the root's parent differs between the two writes. `create_*` takes the
    // KIND-MAPPED parent type (target_parent_type(&request.target_type)); `record_node` takes the
    // RAW request.target_type. For every non-root node both are the parent node's own type.
    let (create_type, record_type, parent_id) = match node.parent { … };

    let (node_type, node_id) = /* create_goal | create_task */;

    // Subtlety 2: node 0 is the root, and it is what opens the instance every node is recorded
    // against. open_instance must sit between the root's create and the root's record_node.
    let instance_id = match instance { Some(id) => id, None => { … open_instance … } };

    db.flows().record_node(instance_id, (&node_type, node_id), source_ref, (&record_type, parent_id)).await?;
    if node.is_private { set_node_private(db, &node_type, node_id).await?; }
    written.push((node_type, node_id));
}
for edge in &plan.edges { /* look up both ends in `written`, pick Goal|Task, add_task_dependency */ }
```

Index into `written` with `.get(i).ok_or_else(|| FlowError::Invalid(…))?`, not `[i]` — `.unwrap()`
is banned and a bare index is the same hazard wearing a different hat.

---

## 8. The private / nsfw double-write

**Renamed, and still present — but it is not what the plan describes.**

- Migration `0021_nsfw.sql` added `nsfw` columns; migration `0022_private.sql` renamed every one of
  them to `is_private`. The field is `is_private` throughout the Rust code
  (`Flow.is_private`, `FlowGoal.is_private`, `FlowTask.is_private`). **The identifier `nsfw` no
  longer exists in the code.** Anything in the plan naming `nsfw` should be read as `is_private`.
- `CreateGoalRequest` / `CreateTaskRequest` still carry **no** `is_private` field, so the flag is
  still a second statement: `set_node_private` (`flows/mod.rs:2027–2040`) issuing
  `UPDATE goals|tasks SET is_private = ? WHERE id = ?`.
- **Correction to the plan:** it is *not* "after every single create". It is guarded by
  `if is_private` at **both** call sites — `flows/mod.rs:1938–1940` (root, from `flow.is_private`)
  and `flows/mod.rs:1999–2001` (items, from the item's `is_private`). So the non-private case is one
  write per node, not two; only private nodes cost two.

**Where to fold it:** the §7 `write_plan` loop has exactly one `if node.is_private { … }`, because
the root is simply `plan.nodes[0]` and goes through the same loop as every other node. That
satisfies 5.3 step 3 ("one place, not two") without touching the create DTOs. Adding `is_private` to
the create requests would collapse it to one write, but it changes `tasks`/`goals` create semantics
for every other caller — out of scope here, and it would need its own regression thinking.

---

## 9. Ride-along doc fix — verified, not applied

`flows/mod.rs:1511` claims `set_iteration_done` is "Reached from the UI through the
`set_habit_iteration_done` command". I verified the actual situation, which is subtler than the
brief's framing:

- `grep -rn "set_habit_iteration_done" src/` → **empty**. No TypeScript wrapper, no caller.
- But the command **does** exist and **is** registered: `src-tauri/src/commands/flows.rs:409` defines
  it and `src-tauri/src/lib.rs:151` registers it in the invoke handler.

So it is not that the command is missing — it is that nothing in the frontend invokes it. Suggested
replacement for line 1511's first sentence:

> Exposed as the `set_habit_iteration_done` Tauri command (registered in `lib.rs`); the frontend
> does not call it yet.

Not applied: the coordinator's stop arrived before I would have rebuilt to verify, and an unverified
edit is exactly the dirty tree the wind-down instructions rule out.

---

## 10. Things that did not work / were rejected, so tomorrow does not repeat them

- **Two global gather passes** (all cycle scopes, then all plan scopes) — rejected in favour of
  reusing `resolve_pair` per pair. Both are correct; the per-pair form preserves scope-minting order
  and duplicates no arithmetic. Recorded so the "but the plan said two rounds" question does not get
  relitigated: the two rounds are real and are *inside* `resolve_pair`.
- **Putting `Dependency` (the tasks-domain enum, carrying real ids) in `PlannedEdge`** — rejected;
  it would put real ids in a pure type. The writer derives the variant from the blocker's kind.
- **Gathering only reachable items' scopes** — rejected; needs the traversal before the gather,
  which means splitting the renderer in two. See the drift note in §5.
- **Fixing the sort-key bug as part of this phase** — rejected. See §6.
- Nothing was attempted that failed to compile, because nothing was compiled.

---

## 11. Places behaviour could drift — the watch list for tomorrow

Ranked by how likely they are to slip through the frozen suite unnoticed:

1. **Sibling / traversal order** (§6, invariants 1–5). Not asserted by any test. Changing `Vec`+`pop`
   to a `VecDeque`, or merging the goals-then-tasks item list, silently reorders creation and
   therefore row ids. **Highest risk in the whole phase.**
2. **The dependent-only `"task"` filter** (§4). Filtering blockers too, or neither, still passes the
   one fan-in test. Cover it with the new unit tests before touching `start()`.
3. **The sort-key bug** (§6). Fixing it counts as drift, however tempting.
4. **Orphaned items' scopes** (§5). Extra inert scope rows.
5. **Hoisting the four reads above the first write** (§4 obs. 1). Argued safe — `start()` never
   writes the flow-template tables — but it is the one ordering change the design actually requires,
   so it deserves a second pair of eyes rather than being taken on my word.
6. **`open_instance` placement** (§7 subtlety 2) — must stay between the root's create and the
   root's `record_node`.
7. **The root's two different parent type strings** (§7 subtlety 1) — kind-mapped for `create_*`,
   raw for `record_node`. Easy to collapse to one by accident; `tests/flows.rs` starts flows on an
   `"aspect"` target, where the two differ, so this one *is* covered.

---

## 12. Files changed

Only this file. `src-tauri/` is byte-identical to the session's starting commit (`0941d9b`);
`tests/flows.rs` is **unchanged**, as are `CHANGELOG.md`, `SPEC.md` and `VERSION.txt` (no behaviour
changed, so no entry was due).

---

# Phase 5 — completion report (session 2)

**Status: 5.1, 5.2 and 5.3 are done, plus the ride-along doc fix.** `src-tauri/tests/flows.rs` is
byte-identical to its state at the base commit. Verification at the end of the work: `cargo build`
clean, `cargo clippy --all-targets` **0 warnings**, `cargo test` **374 passed, 0 failed**
(355 baseline + 3 new integration tests + 16 new renderer unit tests).

The handover above was accurate on every point re-checked, with one deliberate departure noted
in §B.

---

## A. The dependents-vs-blockers test, written first

New binary **`src-tauri/tests/flow_fan_in.rs`** (3 tests). It is a *separate* test binary precisely
so that `tests/flows.rs` could stay byte-identical and keep serving as the frozen contract.

`fan_in_filters_dependents_to_tasks_but_never_filters_blockers` asserts, on a **goal-instance**
flow (a goal item cannot hang off a task root — `goals.parent_type` has a CHECK constraint, which
is why the fixture is not a task-instance flow):

* `Build` (task, two cycle pairs) depends on `Approve` (**goal**, one instance) → **two** edges,
  each with `dependency_type = 'goal'` and `dependency_id` = the Approve goal's real id.
* `Design` (**goal**) depends on `Spec` (task) → **zero** edges.
* The assertion is on the exact `(task_id, dependency_type, dependency_id)` row set, not on a
  count. This matters: the fixture is deliberately balanced so that filtering the *wrong* side
  still yields a plausible edge count. Only the per-row comparison separates the two.

The other two: `fan_in_is_a_cross_product_of_dependent_and_blocker_instances` (3 x 2 -> 6 exact
rows, which a zip would fail) and `fan_in_ignores_other_flows_and_items_without_instances`.

**All three were run against the unmodified tree and seen to pass** before `src/flows/mod.rs` was
touched (`cargo test --test flow_fan_in` -> `3 passed; 0 failed`). They were committed on their own
as `f85a4aa`, ahead of any production change.

**Mutation check, to prove the net actually catches something.** With the filter moved to the
blocker side (`if btype != "task" { continue; }` inside the inner loop, the `dtype` guard removed):

* `cargo test --test flows` -> **43 passed, 0 failed** — the frozen suite is completely blind to it.
* `cargo test --test flow_fan_in` -> the asymmetry test **fails**.

That is the concrete justification for the handover's §4 claim. The mutation was reverted
(`git checkout --` on `mod.rs`) before any real work started.

---

## B. The renderer: signature and plan types

`src-tauri/src/flows/render.rs` (750 lines incl. 16 unit tests), a **private** child module of
`flows`, so it reaches `super::resolve_pair` / `offset_scope` / `resolve_flow_window` without
widening anything. Its items are `pub(crate)`.

```rust
pub(crate) struct NodeRef(pub usize);            // index into RenderedPlan::nodes
pub(crate) enum PlannedSource { Root, Item(FlowItemType, i64) }

pub(crate) struct PlannedNode {
    parent: Option<NodeRef>, kind: InstanceType, title: String,
    time_scope: Option<TimeScope>, plan: Option<TimeScope>,
    is_private: bool, source: PlannedSource,
}
pub(crate) struct PlannedEdge  { dependent: NodeRef, blocker: NodeRef }
pub(crate) struct RenderedPlan { nodes: Vec<PlannedNode>, edges: Vec<PlannedEdge> }

pub(crate) struct TemplateItem { kind, id, title, parent_type, parent_id, position, is_private }
pub(crate) struct FlowTemplate { items, cycles, dependencies }   // all filtered to one flow
pub(crate) struct ResolvedPair { time_scope: Option<TimeScope>, plan: Option<TimeScope> }
pub(crate) struct ScopeTable {
    window: Option<TimeScope>, root_plan: Option<TimeScope>,
    pairs: HashMap<i64, ResolvedPair>,           // keyed by FlowItemCycle.id
}

pub(crate) fn render(
    flow: &Flow, root_title: &str, template: &FlowTemplate, scopes: &ScopeTable,
) -> RenderedPlan                                 // pure, total — no Result, no db, no clock
```

All 16 unit tests use handwritten `FlowTemplate` / `ScopeTable` values. **None touches a database.**

### One design change from the handover, and why

The handover proposed that the gather resolve **every** cycle the flow owns, accepting a drift for
orphaned items (§5, "flagged, unresolved"), and rejected gathering only reachable items because it
"requires the traversal to run before the gather". That reasoning does not hold: what the gather
needs is not the full render, only the **walk order**, which is a small pure computation.

So the walk is factored out as `fn visit_order(&FlowTemplate, flow_id) -> Vec<Visit>` and used by
**both** halves — `FlowTemplate::planned_cycles()` flattens it into the pair list the gather
consumes, and `render` allocates nodes along it. One walk, no duplicated ordering rules.

Two things this buys, both of which turned out to matter:

1. **No orphan drift at all.** Not only are no extra scope rows minted; an orphan carrying a
   malformed `scope_kind` still cannot fail a start. Under an all-pairs gather it would — `start()`
   would go from `Ok` to `Err(Invalid("unsupported cycle kind fortnight"))`. That is a
   user-visible behaviour change this phase's contract forbids, and it is now covered by scenario 5
   of the differential check below.
2. **Scope ids are unchanged.** Scope rows are numbered as they are minted, so gathering in table
   order rather than walk order renumbers the shared calendar. No test asserts a start-minted scope
   id, so this would have slipped through silently; gathering in walk order makes the whole
   `scopes` table come out byte-identical, which is what let the differential check in §D be exact.

This is *not* a fix to the pre-existing orphan behaviour — `start()` behaves exactly as it did. It
is a refusal to introduce a new divergence. The three items on the do-not-fix list are untouched
(see §F).

---

## C. How the fan-in came out pure

Cleanly, and the handover's analysis held in full. Three points:

* **The read hoist is safe.** `list_goals` / `list_tasks` / `list_all_cycles` /
  `list_all_dependencies` all moved above the first write, into `load_template()`. `start()` writes
  `goals`, `tasks`, `scopes`, `flow_instances`, `flow_instance_nodes` and `task_dependencies` and
  never a `flow_*` template table, so nothing it does can change what those reads return. This was
  re-derived from the write set rather than taken on trust; §D is the empirical half of the
  argument.
* **`instances` was already a pure value.** It is now
  `HashMap<(String, i64), Vec<(InstanceType, NodeRef)>>` — carrying the kind alongside the
  placeholder means the `"task"` filter needs no lookup back into the node list, so `render` stays
  total with no indexing and no `unwrap`.
* **`Dependency` stayed out of the pure layer**, as advised. `write_plan` derives
  `Dependency::Goal` vs `::Task` from the blocker's *written* type string.

Renderer tests covering the fan-in specifically (7 of the 16):

| Test | Pins |
|---|---|
| `one_dependent_over_two_blockers_fans_in_to_two_edges` | the basic fan-in, exact pairs |
| `three_dependents_over_two_blockers_is_a_cross_product_not_a_zip` | 3 x 2 -> 6, exact pairs |
| `a_goal_dependent_yields_no_edges_at_all` | the `continue` |
| `a_goal_blocker_is_kept_because_only_dependents_are_filtered` | **the asymmetry** |
| `both_sides_of_the_asymmetry_at_once` | both in one flow; asserts *which* edge survives, since the count is symmetric under a wrong-side filter |
| `a_dependency_naming_an_item_with_no_instances_yields_nothing` | `unwrap_or_default()`, three ways |
| `dependencies_are_remapped_in_template_order` | edge order |

Plus the walk: root-only, root attributes, unpaired item, three pairs in position order,
children-under-the-first-instance, sibling position order, stack-not-queue descent order, orphan
exclusion, and `planned_cycles` through a parent chain.

A note on the unit-test fixtures: the first draft gave goal items and task items overlapping
numeric ids and immediately tripped the preserved sort-key defect (a task sorted by a goal's
position). That is an independent confirmation that the port reproduces the defect faithfully, but
per the handover's advice the fixtures were changed to disjoint id ranges rather than left to pin
the buggy ordering.

---

## D. Evidence `start()`'s behaviour is preserved, beyond "the suite passes"

A temporary differential harness (`tests/zz_dump.rs`, written, run, and **deleted** — it is not in
the final tree) ran `start()` over five flow shapes and dumped every table `start()` can touch —
`goals`, `tasks`, `task_dependencies`, `flow_instances`, `flow_instance_nodes` and **`scopes`** —
every column of every row in rowid order, plus the `Result` of each call.

The five scenarios:

1. Empty task-root flow, scoped, with a root Cycle Plan.
2. Empty goal-root flow, same.
3. Mixed goal/task tree, goal root: two top-level goals, a task under each, a task nested two deep,
   an orphan; a three-pair parent with Cycle Plans; a private goal item; and four dependencies
   covering task->goal (kept, goal-typed), goal->task (dropped), task->task (kept), and a blocker
   with no instances.
4. Unscoped and private: every pair resolves to `(None, None)`; privacy fires on the root and on
   one item but not the other.
5. An orphan carrying an unsupported cycle kind — the case that would regress under an all-pairs
   gather.

The harness was run against the refactored tree, then `src/flows/mod.rs` was restored from the
pre-refactor commit (`git checkout f85a4aa -- …`, `render.rs` removed) and run again.

**Result: the two dumps are identical**, 126 lines, once the wall-clock `position` column is
normalised — that is `now_position()`, a millisecond `SystemTime` stamp that differs between any
two runs of anything. Every id, parent, scope id, plan id, privacy flag, dependency row,
`flow_instance_nodes` row and `scopes` row matches exactly, in the same order, including scenario
3's interleaved goal/task/scope id sequence and scenario 5's `Ok`.

That is the claim the test suite alone cannot make: not just "nothing asserted broke" but "the
database is byte-for-byte what it was".

Secondary evidence: `tests/flows.rs` passes **unchanged** (43/43; `git diff` against the base
commit is empty for that file), and `tests/flows_commands.rs` (16) and `tests/mindmap_commands.rs`
(13), which read flow instance nodes back, are also untouched and green.

---

## E. The new `start()`

**12 lines including the signature and closing brace; 6 lines of body.** Target was "well under
40".

```rust
#[tracing::instrument(skip(db))]
pub async fn start(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    request: StartFlowRequest,
) -> Result<MaterializedFlow, FlowError> {
    let flow = db.flows().get(flow_id).await?;
    let template = load_template(db, flow_id).await?;
    let cycles = template.planned_cycles(flow_id.0);
    let scopes = resolve_scopes(&mut db.scopes(), &flow, request.anchor_date, &cycles).await?;
    let plan = render(&flow, &request.title, &template, &scopes);
    write_plan(db, flow_id, &request, &plan).await
}
```

Supporting functions in `flows/mod.rs`, all module-private:

* `load_template<M: SessionMode>(&mut Db<M>, FlowId) -> Result<FlowTemplate, FlowError>` — the four
  hoisted reads. Generic over session mode because it only reads.
* `resolve_scopes(&mut ScopeOperator<'_>, &Flow, NaiveDate, &[FlowItemCycle]) -> Result<ScopeTable, FlowError>`
  — **5.1**. Takes a single `ScopeOperator`, matching the module doc and `habit_slots`; the caller
  passes `&mut db.scopes()`, so it runs inside the caller's transaction, which is mandatory because
  `offset_scope` -> `get_or_create` **writes**. The two rounds stay inside `resolve_pair`, reused
  per pair exactly as the handover recommended.
* `write_plan(&mut Db<Transactional>, FlowId, &StartFlowRequest, &RenderedPlan) -> Result<MaterializedFlow, FlowError>`
  — **5.3**, ~85 lines, all of it mechanical. It keeps `record_node` and the `flow_instances`
  insert, decides nothing, and holds **one** `if node.is_private` covering root and items alike
  (the handover's §8 point: the double-write is conditional, and the root is just `nodes[0]`).
  `open_instance` sits between the root's `create_*` and the root's `record_node`, as before.
  Placeholders are resolved with `written.get(i).ok_or_else(…)?`, never `[i]` and never `unwrap`.

---

## F. The do-not-fix list — all three left alone

1. **`children.sort_by_key` looks items up by id alone, ignoring kind.** Ported verbatim into
   `visit_order`, with a comment saying it is preserved and not endorsed, and a pointer to why
   fixing it here would be a behaviour change. Confirmed reproduced (see §C's fixture note).
2. **The walk is a stack, not a queue.** Ported as `Vec` + `pop()`. There is now an explicit unit
   test, `all_of_a_parents_children_precede_any_descent_and_subtrees_descend_in_reverse`, pinning
   the reverse-subtree order, so a future "fix to a real queue" fails loudly instead of silently
   renumbering rows. The misleading "breadth-first" comment is gone; the doc now says what it is.
3. **Scope-minting drift for orphaned items.** Not introduced — see §B. `start()`'s behaviour here
   is unchanged from the pre-refactor tree, proven by scenario 5 of §D.

## G. Ride-along doc fix

`flows/mod.rs` `set_iteration_done` now reads:

> Exposed as the `set_habit_iteration_done` Tauri command (registered in `lib.rs`); the frontend
> does not call it yet.

## H. Concerns

1. **The sort-key defect is now easier to trip over, not harder.** It is documented in two places
   and reproduced faithfully, but the renderer's unit tests deliberately avoid it, so nothing in
   the suite pins its current (wrong) behaviour. Whoever fixes it should expect `tests/flows.rs` to
   stay green — no test covers mixed-kind sibling order — and should therefore add a failing test
   *before* fixing, the way the fan-in was handled here.
2. **A cyclic in-flow parent chain still hangs.** `A` parented under `B` and `B` under `A` makes
   both `visit_order` and the old walk loop forever. Behaviour is unchanged (the pre-refactor walk
   hung too, while also writing unbounded rows), so it was left alone, but it is now reached one
   step earlier — inside `planned_cycles`, before any write, rather than mid-materialisation. Worth
   a bounded-visit guard as a separate change; not added here because it changes behaviour.
3. **`render` is total by construction, and two `unwrap_or(NodeRef(0))` fallbacks in it are
   unreachable** (a visit index always indexes the list it came from; a parent visit always
   precedes its children). They are commented as such. The alternative would be to make `render`
   fallible, which is worse — the whole point of the split is that the deciding half has no failure
   modes.
4. **`write_plan` is ~85 lines**, longer than the handover's "~30 line" sketch, almost all of it
   the two `CreateGoalRequest` / `CreateTaskRequest` literals. It would shrink if the create DTOs
   gained an `is_private` field, which would also collapse the privacy double-write — but that
   changes create semantics for every other caller and belongs in its own change, as §8 said.
5. **No `CHANGELOG.md` entry**, deliberately: nothing user-visible changed, and §D is the evidence
   for that claim. `VERSION.txt` untouched.

## I. Files changed

* `src-tauri/src/flows/render.rs` — **new** (750 lines, 16 unit tests).
* `src-tauri/src/flows/mod.rs` — `mod render;`, `load_template`, `resolve_scopes`, `write_plan`,
  the rewritten `start`, and the `set_iteration_done` doc fix.
* `src-tauri/tests/flow_fan_in.rs` — **new** (3 integration tests).
* `docs/superpowers/reports/phase-5-report.md` — this section.

`src-tauri/tests/flows.rs`, `CHANGELOG.md`, `SPEC.md`, `README.md` and `VERSION.txt` are
unchanged.

## J. The merge back in

`git merge worktree-architecture-review` at `8e26513` ("Retype a node once, atomically, and say
what it costs first") — **no conflicts**, 8 files, +2445/-1, all of it the concurrent `tasks/`
retype work (`src/tasks/retype.rs`, `src/commands/retype.rs`, `src/error/wire.rs`,
`tests/tasks.rs`). It touches nothing this phase touched; `flows/` did not move.

Textual cleanliness is not evidence, so the full verification was re-run against the merged tree:

* `cargo build` — clean, 0 warnings.
* `cargo clippy --all-targets` — **0 warnings**.
* `cargo test` — **405 passed, 0 failed** (374 here + 31 from the merged retype work: lib unit
  tests 173 -> 200, `tests/tasks.rs` 52 -> 56).
* `tests/flows.rs` still **43/43** and still byte-identical to the base commit.
