# The business rules layer: inventory and plan

The plan behind [ADR 0010](../../adr/0010-business-rules-layer.md), for Task `122` (which absorbed
`197`). It is phase 0: an inventory and an order, with no code moved. The user approved it on
2026-10-02 (wait `921`: "Yes to all. All folding is in 122 for now"), and added phase 2b, which
separates the domain and database models.

Paths: `ts:` is `src/`, `rs:` is `src-tauri/src/`. Measured on `origin/master` at `47356b0c`
(2026-10-02).

**Verdicts** used in the tables:

- **Move.** The frontend stops computing this. Rust computes it in the rules layer and the frontend
  reads the answer (a fact on the load, a query, or the outcome of an intent). The TypeScript is
  deleted. Used for anything needed once per load or once per write.
- **Keep + pin.** Rust gains (or keeps) the authoritative rule in the rules layer. The TypeScript
  copy stays, because the frontend answers it per render, per keystroke or per pointer move, and it
  is pinned by a named corpus that both sides replay. The reason is given in each row.
- **Already pinned.** Both copies exist today, pinned by a corpus. The only work is to move the Rust
  side into a `rules` module.
- **Stays.** Presentation (layout, wording, selection, hotkeys) or a codec of the wire format. It
  is not a business rule, and is listed so that the boundary is explicit.

"Rust today" says whether a Rust definition exists and where. **None** means the rule has no Rust
definition, so the rules layer must gain one whatever the verdict.

## 1. Inventory

### Filters and views

| Rule (what it decides) | TS file and function | Rust today | Verdict | Phase |
| --- | --- | --- | --- | --- |
| Status presets on the tree (which nodes the Mindmap and Steps keep under All, Plan, Start, Do and Backlog) | `ts:utils/filter-tree.ts`: `filterTree`, `pruneTree`, `passesStatus`, `passesStartStatus`, `passesDoStatus`, `passesCommitmentPreset`, `passesExpectationPreset`, `passesTags` | `rs:filters/rules.rs`, `tree.rs` | **Already pinned**: `preset-filters.json`. Kept for speed, since filtering runs per render | 1 |
| Hard-hide and gates (subtrees that drop as a unit: private, archived Exclude, Backlog, shelved Project, unopened occurrence, unopened wait, Flow) | `filter-tree.ts`: `typeHardHidden`, `isHiddenBacklog`, `isShelvedProject`, `isUnopenedOccurrence`, `isUnopenedWait`, `flowHardHidden`, `withArchivedOverride` | `rules.rs` | **Already pinned** | 1 |
| Start's block gate (a blocked node hides its subtree except its child dependencies) | `filter-tree.ts`: `gateBelow`, `startGateBelow`, `isHeldByBlock`, `isAdmittedBy` | `rules.rs`: `gate_below`, `is_held_by_block` | **Already pinned** | 1 |
| Start's windows (Pending, or Lapsed unless Overdue; a Plan ahead; Plan-scope narrowing; delegated reads as archived) | `filter-tree.ts`: `isStartableWindow`, `isPlannedAhead`, `isOutsidePlanScope`, `isDelegated`, `isArchived` | `rules.rs` | **Already pinned** | 1 |
| List preset per row (the presets for a flat row, plus Unblock and Expectations) | `ts:utils/list-filter.ts`: `passesListPreset`, `hasGatingAncestor`, `inheritedPlan`, `inheritedTimeScope`, `unblockSharedFilter` | `rs:filters/list.rs` | **Already pinned** | 1 |
| List pills (Under, Depends on, Task/Goal/Project status, Verdict, Scope, Blocked, Agentic, Asynchronous, Private, row kinds) | `list-filter.ts`: `rowPassesFilters`, `commitmentPassesFilters`, `expectationPassesFilters`, `matchesPillGroup`, `flagPills`, `deriveScopeStateTokens` | **None.** `mcp-server.md` lists them as deliberately absent | **Keep + pin.** Pill toggles are instant. Pin by extending `preset-filters.json` with `list_filter` cases | 4 |
| Pill vocabulary (which values each dimension has) | `list-filter.ts`: `PILL_DIMENSIONS`, `LIST_PRESET_VALUES`, the `is*Value` guards; `ts:utils/filter-modes.ts` | `rs:filters/model.rs` (presets only) | **Keep + pin.** The menu draws from it. Pinned through the pill cases | 4 |
| View-locked presets (Plan View reads Plan, Zen reads Do) | `ts:utils/view-preset.ts`; `filter-tree.ts`: `PLAN_VIEW_STATUS_MODE`, `ZEN_VIEW_STATUS_MODE` | None | **Keep + pin.** These are two constants, pinned by a `views` case in the Zen corpus | 4 |
| Focus exemption (the selected node and its chain stay visible after an edit) | `ts:utils/focus-exemption.ts`; `list-filter.ts`: `keepWithFocus` | None | **Stays.** `filtering-logic.md` defines it as a render-time overlay, not a filter rule | – |
| Row flattening (which nodes become List rows, with their ancestors, dependencies, Goal and Project) | `ts:utils/list-data.ts`: `flattenTaskRows`, `flattenCommitmentRows`, `flattenExpectationRows` | `rs:filters/list.rs`: `flatten` (presets only) | **Keep + pin.** It feeds the per-render filter. Pinned through the pill cases | 4 |
| Path grouping (path headers and indentation) | `list-data.ts`: `groupMixedRowsByPath`, `mergeInTreeOrder` | None | **Stays** (layout of rows) | – |
| List sections (Review, Overdue and Asynchronous, which rows they lift, and when each is drawn) | `ts:utils/list-sections.ts`: `withListSections`, `splitSection`, `showsReviewSection`, `showsOverdueSection` | None | **Keep + pin.** It is re-run per filter change. New corpus `list-sections.json` | 4 |
| Zen contents (the grid is Do with Review first, no delegated work and optional no-compound; the Commitments strip; the Expectations strip is Start without agentic waits) | `ts:utils/zen-contents.ts`: `zenContents` and its helpers | None | **Keep + pin.** It is re-run per filter change. New corpus `zen-contents.json` | 4 |
| Steps child counts ("3 of 12") | `ts:utils/steps-card.ts`: `stepChildCounts` | None | **Stays.** It counts what the filter kept against the raw tree, so it is a reading of two trees, not a rule | – |
| Filter menu layout and search | `ts:utils/filter-layout.ts`, `filter-search.ts`, `filter-menu-keys.ts` | – | **Stays** | – |

### Derived facts on the board

| Rule (what it decides) | TS file and function | Rust today | Verdict | Phase |
| --- | --- | --- | --- | --- |
| Blocked by a dependency (which unmet dependencies block a Task, and the ids Start's gate admits) | `ts:components/MindmapView/use-mindmap-data.ts`: `buildTree` (the virtual-blocker loop) | `rs:filters/facts.rs`: `index_blocked`; `rs:tasks/mod.rs`: `get_task_with_blockers_as` | **Move.** It is computed once per load, so send `blocked` and `blocking_dependencies` | 3 |
| "Blocked by …" text | `ts:utils/blocked-by.ts`: `blockedByText`; `TaskEditorModal.tsx` | `rs:tasks/mod.rs`: `dependency_name` and the `format!` calls; `rs:mcp/access.rs` | **Move** the reason, sent as a structured `dependency` reason. The wording **stays** in the frontend for i18n | 3 |
| Is it blocked (a Task, Goal or Commitment with any reason) | `ts:utils/tree-layout.ts`: `isNodeBlocked` | `rs:filters/rules.rs`: `is_blocked` | **Move** (the `blocked` fact). The per-render filter reads the fact, not the reasons | 3 |
| Agentic inheritance (own flag, else the nearest flagged ancestor's, Tasks only) | `ts:utils/agentic.ts`: `isAgentic`, `propagateAgentic` | `rs:tasks/agentic.rs`; `rs:capacity/blocks.rs`: `reads_agentic` | **Move** (`agentic_effective`). It is computed once per load | 3 |
| Time Scope inheritance (the window a node inherits) | `ts:utils/inherited-scope.ts`: `propagateInheritedScope` | `rs:tasks/scope_rules.rs`: `nearest_scoped_ancestor_window` | **Move** (`inherited_time_scope`) | 3 |
| Review question (which wait makes a Task read Review) | `ts:utils/open-question.ts`: `openQuestion` | `rs:tasks/review.rs`: `is_open_question`, `derive` | **Move** (`open_question_id`) | 3 |
| MCP visibility (which nodes an agent sees, and through which root; a derived node takes its stored ancestor's answer) | `ts:utils/mcp-visibility.ts`: `applyMcpVisibility`, `storedKeyOf` | `rs:access/` (`AccessMap`) | **Move** (`mcp_visible_via`) | 3 |
| Commitment Expired (unresolved past its Verdict Window) | `ts:utils/commitment-glyph.ts`: `commitmentGlyphState` (unresolved + archived reads as expired) | `rs:tasks/lifecycle.rs`: `derive_commitment_state` | **Move** the reading (an `expired` fact). The glyph mapping **stays** | 3 |
| Agent activity (the top bar's Review, waits and On Agent counts) | `ts:utils/agent-activity.ts`: `agentActivityOf` | None | **Move** (`agent_activity` on the load). It is computed once per load | 3 |
| Unrenderable commitment Habit (a commitment Habit holding Goal items) | `use-mindmap-data.ts`: `holdsUnrenderableGoalItems` | `rs:flows/occurrences.rs` (skips it) | **Move** (report it in `habits`) | 3 |
| Tree assembly (hang rows on their parents, in position order) | `use-mindmap-data.ts`: `buildTree`, the `kindTo*ParentType` helpers | `rs:filters/facts.rs`: `forest` (a second tree, for the MCP) | **Keep + pin.** The tree is assembled once per load, but building it in TS keeps the payload flat. Pinned implicitly, since every preset case builds its board through both. Revisit if the payload is restructured | – |
| Lifecycle stamping (copies Timing, Resolution, Overdue, Verdict and Archival onto nodes) | `use-mindmap-data.ts`: `applyLifecycles`, `lifecycleMap` | `rs:tasks/lifecycle.rs` (the derivation) | **Stays** (a join of the backend's answer onto nodes, not a rule) | – |
| Overdue | `ts:utils/overdue.ts`: `isOverdue` | `rs:tasks/lifecycle.rs`: `derive_overdue` | Already moved. The file only reads the flag | – |
| Short ids | `use-mindmap-data.ts` reads `load.short_ids` | `rs:mcp/ids.rs`: `board_short_ids` | Already moved. `ids.rs` moves into `nodes::rules` | 2 |
| Cooldown and compound reason wording | `use-mindmap-data.ts`: `cooldownFields`; `ts:utils/cooldown-until.ts` | `rs:flows/occurrences.rs`, `rs:tasks/compound/blocked.rs`, which already send `derived` and `until` | **Stays** (wording) | – |
| Status badges (which badges a node shows) | `ts:utils/node-status-indicators.ts`: `deriveStatusIndicators` | Reads facts | **Stays.** It reads the phase 3 facts | – |

### Status and gestures

| Rule (what it decides) | TS file and function | Rust today | Verdict | Phase |
| --- | --- | --- | --- | --- |
| Status cycle (what a click, `Enter` and `Alt+Enter` write, in either model, and when they are refused) | `ts:utils/task-status-cycle.ts`: `nextTaskStatus`, `altEnterStep`; `ts:hooks/use-status-cycle.ts` | None. Rust validates only the written status | **Move** (an intent). It is followed by a write and a reload anyway, and there is no optimistic UI | 5 |
| Backlog cleared by a start | `task-status-cycle.ts`: `cameOutOfBacklog`, `backlogClearedMessage` | `rs:tasks/mod.rs` (the Backlog invariant) | **Move.** The intent reports it | 5 |
| Status models (agentic↔ordinary conversion; Review stored as On Agent) | `ts:utils/status-mapping.ts`: `convertedStatus`, `storedStatus` | `rs:tasks/model.rs`: `Status::converted` | **Keep + pin** `convertedStatus`. The editor previews it as the flag is flipped. New corpus `task-status.json`. **Move** `storedStatus`, which the intent makes unnecessary | 5 |
| Status predicates | `status-mapping.ts`: `isDone`, `isBegun`, `isReview`, `isOnAgent`, `todoOf`, `taskStatusOf` | `Status::is_done` and the typed status | **Stays** (reads of the typed status). The spellings are pinned by `task-status.json` | – |
| Agentic toggle (what one press of the Agentic key writes) | `ts:utils/agentic.ts`: `toggledAgenticState`, `storedAgenticState` | None | **Move** (an intent) | 5 |
| Verdict cycle (Unresolved → Kept → Broken → Unresolved, and toggle-to-clear) | `ts:hooks/use-commitment-verdict.ts` | None | **Move** (an intent) | 5 |
| Compound eligibility (which Tasks may switch to Compound) | `ts:utils/compound.ts`: `takesCompound` | `rs:tasks/compound.rs` refuses at write | **Move** (a capability on the node) | 5 |
| Derived-node limits (what cannot be deleted, copied or pasted) | `ts:utils/derived-wait.ts`; `ts:utils/node-identity.ts`: `isOccurrence`; `ts:utils/steps-card.ts`: `canDescendInto` | `rs:nodes/origin.rs`, and refusals in the writers | **Move** (capabilities) | 5 |
| Parenting table (which kinds may hold which, for drag, drop, paste and chord-create) | `ts:utils/node-meta.ts`: `isValidDropTarget`, `validParentKinds`, `typedChildStoredKind`, `isCommitmentFlow`, `isFlowKind` | Partial: SQL `CHECK (parent_type IN …)` per table, `rs:domains/mod.rs`: `validate_parent`, `rs:flows/mod.rs`. There is no single rule | **Keep + pin.** Drop targets are highlighted per pointer move. Rust gains `nodes::rules::may_parent`, which every writer calls. New corpus `parenting.json` (the full kind × kind matrix) | 5 |
| Paste refusals (why each node was skipped by a paste) | `ts:utils/paste-refusal.ts`: `pasteRefusal`, `flowsLeftBehind` | `rs:duplicate/` refuses some cases | **Move** (the paste intent returns the refusals). The wording stays | 5 |
| Flow conversion (where a node may become a Flow, and when to confirm) | `ts:utils/mindmap-tree.ts`: `canConvertNodeToFlow`, `conversionNeedsConfirm` | `rs:flows/mod.rs` (`convert_to_flow`) | **Move** (a capability) | 5 |
| Dependency candidates (what a Task may depend on, excluding cycles) | `ts:utils/dependency-candidates.ts`: `canHoldDependencies`, `dependencyOn`, `dependencyCandidates` | `rs:tasks/mod.rs`: the cycle refusal in `add_task_dependency` | **Move** (a `dependency_candidates(task)` query when the picker opens). Matching on the typed title **stays** | 5 |
| MCP root candidates | `ts:utils/mcp-roots.ts`: `rootCandidates` | `rs:access/` validates roots | **Move** (a query) | 5 |
| Async template | `ts:utils/async-template.ts`: `asyncTemplateToSave` | Stored by `rs:tasks/` | **Stays** (form logic) | – |

### Habits and Flows

| Rule (what it decides) | TS file and function | Rust today | Verdict | Phase |
| --- | --- | --- | --- | --- |
| Iteration readings (`passed`, `done`, and `owed` on an iteration root) | `use-mindmap-data.ts`: `decorateIterationRoots` | `rs:flows/occurrences.rs`: `resolutions`; the `origin` carries `missed_from` and `owed` | **Move** `passed` and `done` (facts on the origin). The `{title} {scope}` label **stays** (wording) | 3 |
| The Habit fold (runs of passed iterations collapse into Year, Season, Month, Week and Day groups past a threshold) | `ts:utils/habit-collapse.ts`: `foldHabitRuns`, `levelsForRun`, `unitKey`; `ts:utils/drawn-path.ts` | None | **Keep + pin.** It runs per render, after the filter. Rust gains `flows::rules::fold`. New corpus `habit-fold.json`. The collapsed-set bookkeeping and fold ids stay | 6 |
| Recurrence form (which cooldowns the editor offers) | `ts:components/FlowEditorModal/recurrence-ui.ts`: `cooldownKinds`, `maxCooldown`, `takesCooldown` | `rs:flows/mod.rs`: `check_cooldown`, `takes_cooldown`; `rs:flows/cooldown.rs`: `fits` | **Keep + pin.** The editor bounds the field as you type. New corpus `cooldown.json` | 6 |
| Flow cycle navigator (the editor's relative cycle picker) | `ts:utils/flow-cycle.ts`: `cycleLevels`, `pathToIndex`, `subdivisionsBetween` | The backend resolves the flat index | **Keep + pin.** It is editor navigation. Pin `subdivisionsBetween` in `cooldown.json`'s sibling, `flow-cycles.json` | 6 |
| Flow targets (which nodes a Flow may target) | `ts:utils/flow-target.ts`: `flowTargetNodes` | `rs:flows/mod.rs`: `valid_targets` (scoped Flows only) | **Move.** Extend `valid_targets` to unscoped Flows | 6 |

### Time and planning

| Rule (what it decides) | TS file and function | Rust today | Verdict | Phase |
| --- | --- | --- | --- | --- |
| Scope windows (a key's `[start, end)`) | `ts:utils/scope-window.ts`: `keyWindow`, `timeScopeWindowOf` | `rs:scopes/derive.rs` | **Already pinned**: `scope-keys.json`. The per-render filter needs them | 1 |
| Scope key codec (the canonical text of a key) | `ts:utils/scope-key.ts` | serde over `ScopeKey` | **Already pinned**: `scope-keys.json` | – |
| Interval arithmetic (containment and overlap) | `ts:utils/scope-interval.ts` | `rs:scopes/resolve.rs`: `interval_contains`; `rules.rs`: `intervals_overlap` | **Keep + pin.** Pin through `scope-keys.json` window cases | 7 |
| Calendar rules (the 02:00 day, Sunday weeks, seasons, week numbers and bands) | `ts:utils/scope-calendar.ts`: `dayStartInstant`, `dayScopeDate`, `seasonOf`, `weekNumber`; `ts:utils/plan-scope.ts`: `partOfHour` | `rs:scopes/` | **Keep + pin.** The scope picker navigates per keystroke. Extend `scope-keys.json` with labels and "which scope holds this instant" | 7 |
| Plan triage (the Plan View's three heaps) | `ts:utils/plan-triage.ts`: `partitionForScope`, `effectiveTimeScope`, `nearestPlannedAncestor` | None | **Keep + pin.** It is re-run per step through the calendar. New corpus `plan-triage.json` | 7 |
| Plan refusal (which containment bound a plan move breaks) | `plan-triage.ts`: `planRefusal`; `ts:hooks/use-quick-plan.ts` (the Overdue bound) | `rs:tasks/scope_rules.rs` (write-time) | **Keep + pin.** It is previewed during a drag. Pin in `plan-triage.json`, and have Rust's writer and the corpus call one rule | 7 |
| Plan sections and take-out (subscope buckets, and where taken-out work lands) | `ts:utils/plan-sections.ts`, `ts:utils/plan-take-out.ts`, `ts:hooks/use-plan-parents.ts`: `parentRefs` | None | **Keep + pin** in `plan-triage.json` | 7 |
| Done-date input | `ts:utils/done-date.ts` | – | **Stays** | – |

### Not business rules, and staying

`tree-layout.ts` (but not `isNodeBlocked`), `node-visuals.ts`, `edge-path.ts`, `zen-grid.ts`,
`steps-grid.ts`, `crumb-fold.ts`, `subtree-toggle.ts`, `neighbour-after-delete.ts`,
`plan-selection.ts`, `plan-drag.ts`, `plan-subscope-keys.ts`, `plan-pane-model.ts`, `scope-ref.ts`,
`scope-format.ts`, `gesture-label.ts`, `tab-label.ts`, `pill-color.ts`, `search-disambiguation.ts`,
`toast-timing.ts`, `text-direction.ts`, `node-uuid.ts`, `uuid-v5.ts` and `legacy-node-id.ts` (node
display keys and saved-tab migration), every hotkey module, and the stores.

### Rust rules that are not yet pure

These are the rules layer's own extraction work, which `122`'s spec describes.

| Module | Today | Work |
| --- | --- | --- |
| `rs:filters/` | Pure | Becomes `filters::rules` (or stays as is, as a whole-module rules layer) |
| `rs:tasks/lifecycle.rs`, `review.rs`; `rs:flows/habits.rs`, `cooldown.rs`; `rs:capacity/blocks.rs` | Pure | Move under their domain's `rules` |
| `rs:tasks/scope_rules.rs` | Takes `Db` (`scope_governance_with`, `derive_all_scope_lifecycles`) | Split the gathering from the rules |
| `rs:tasks/compound.rs` | Takes `Db` (`settle`, `governance_of`) | Split |
| `rs:flows/occurrences.rs`, `rs:flows/compound_readings.rs`, `rs:nodes/table.rs` | Take `Db` (`derive_habits`, `added_edges`) | Split |
| `rs:tasks/agentic.rs` | Mixed (the briefs operator, and inheritance) | Split |
| `rs:mindmap/mod.rs` (`load_within`) | Interleaves reads with derivation | Becomes gather-then-`derive_board` |
| `rs:tasks/mod.rs` (1,793 lines), `rs:flows/mod.rs` (4,014 lines) | Rules inline with SQL | Extract |
| `rs:mcp/ids.rs` | Pure (short ids) | Moves under `nodes::rules` |
| `rs:scopes/key.rs` | Pure rules, but `ScopeKey` implements `sqlx`'s `Encode`, `Decode` and `Type` beside its definition | Phase 2b. The impls move to a `DbScopeKey(ScopeKey)` newtype in persistence |
| Domain models with `sqlx` derives (`FromRow`, `sqlx::Type`, and hand-written `Encode`/`Decode`) | Found in `access/mod.rs`, `block_reasons/mod.rs`, `domains/model.rs`, `flows/model.rs`, `flows/mod.rs`, `flows/template.rs`, `infos/mod.rs`, `knowledge_base/model.rs`, `nodes/overlay.rs`, `nodes/relations.rs`, `nodes/wait_overlay.rs`, `scopes/key.rs`, `tasks/agentic.rs`, `tasks/commitments.rs`, `tasks/compound/instants.rs`, `tasks/expectations.rs`, `tasks/mod.rs`, `tasks/waits.rs` and `undo/mod.rs` (49 derives) | Phase 2b. Persistence row structs and conversions. `undo/` rows are persistence already and keep their derives |

## 2. `122`'s spec against today's code

### Prerequisites

| Prerequisite | Status on master |
| --- | --- |
| Arlesh-32r, List presets to Rust | **Done.** #50, `73867109` (2026-09-22). It ported the presets and Unblock, not the List View's own pills |
| Arlesh-9o1, derived scopes | **Done.** #83, `ca5d98dc` (2026-09-24), ADR 0009 |
| Arlesh-pnn, virtual node tables | **Done.** #85, `87a6903b` (2026-09-24), ADR 0008 |
| Task #162 (Arlesh-bwc), SPEC audit | **Done.** #73, `e384bf00` |

`122` is unblocked. (`a77` refers to `122` by its bead id, Arlesh-tgf. `a354913c` names it as Task
#163.)

### Stale claims to amend in the brief

- **Retype.** `tasks/retype.rs`, and retyping a node, were removed in #102 (`745bed49`). The brief's
  "retype.rs's planning half" and its "type-cycling validity" port (`validTypesForCycling` no longer
  exists) have no subject. The same holds for `a77`'s "composite operations such as retype" and
  for `2bd`'s retype endpoint and retype confirmation flow. `needs_confirmation` survives for
  setting a planned Task aside.
- **"Goal↔Task status mapping (`status-mapping.ts`)".** That file now maps the ordinary and Agentic
  status models, and its conversion already has a Rust counterpart, `Status::converted`.
- **File sizes.** `tasks/mod.rs` is 1,793 lines (the brief says 1,493). `flows/mod.rs` is 4,014 (the
  brief says 2,124).
- **"These are functions over values with no database".** That is no longer true of
  `tasks/scope_rules.rs` or of `tasks/compound.rs`. Both take a `Db` session now (see the table
  above).
- **"Inline `#[cfg(test)] mod tests`".** Unit tests moved to sibling `tests.rs` files on 2026-09-19,
  and CI refuses inline modules. A moved module carries its `foo/tests.rs` with it.
- **Scope of the frontend ports.** The brief names three rules (status mapping, type cycling, drop
  targets). The inventory above finds many more with no Rust definition. Most of them were built
  after the brief was written (2026-09-17): the pills, sections, Zen contents, agent activity, the
  status cycle, the Habit fold and Plan triage.

### For `a77`, later

- **"Grep for tauri outside `commands/` matches `lib.rs` alone"** is false today: `rs:icon.rs`
  imports `tauri::image::Image`, so `icon.rs` stays in the app crate. `board.rs`, `capacity.rs` and
  `mcp/mod.rs` mention `AppHandle` only in comments, and take closures instead. `ksni` and `gtk`
  are imported only from `commands/`.
- `2bd`'s "the MCP server is read-only bar one field" is stale: the MCP now creates and updates
  Agentic Tasks, raises and releases waits, and archives occurrences.

## 3. Phases

Each phase is one or more PRs. Each PR is mergeable on its own and changes no behaviour.

| # | Phase | Rust | TypeScript | Tests and pins | Expected overlap |
| --- | --- | --- | --- | --- | --- |
| 0 | This inventory and plan | – | – | – | `docs/` only |
| 1 | **The convention and the check** | `rules` modules for the already-pure code: `filters/`, `lifecycle.rs`, `review.rs`, `habits.rs`, `cooldown.rs`, `capacity/blocks.rs`, `scopes/derive.rs`, `mcp/ids.rs`. A CI purity check. The convention goes in `.claude/rules/rust.md` | None | The existing suite passes unmodified. The existing corpora (`preset-filters.json`, `scope-keys.json`) stay green | Each moved file, one module per PR. Low, since these files change rarely |
| 2 | **Extract the rules from persistence** | Split `scope_rules.rs`, `compound.rs`, `occurrences.rs`, `compound_readings.rs`, `nodes/table.rs` and `agentic.rs` into gather and rules. Extract the inline rules from `tasks/mod.rs` and `flows/mod.rs` | None | The existing suite passes unmodified. A test that had to change means the move was not a move | **High.** `tasks/mod.rs` and `flows/mod.rs` are in most Rust PRs. Run module by module, on a quiet board |
| 2b | **Separate domain and database models** (ADR 0010, decision 8) | Domain types lose every `sqlx` derive and impl. Persistence gains row structs (`FromRow`), conversions to and from the domain types (a malformed row fails there, as a typed error), and zero-cost newtypes for directly stored value types (`DbScopeKey(ScopeKey)`, the status and kind enums). The purity check extends to "the domain types and rules do not depend on `sqlx`". One domain per PR | None | The existing suite passes unmodified. A conversion test per row struct, covering a round trip and a malformed value | **High.** Every file that reads or writes a row. Runs after phase 2 and before `a77`'s crate split. No meaningful runtime cost: newtypes share their inner layout, and a conversion moves fields that were already decoded |
| 3 | **A pure board derivation, and the facts it sends** | `mindmap::load_within` becomes gather + `rules::derive_board(rows, now, capacity)`. The load gains `blocked`, structured `block_reasons`, `agentic_effective`, `inherited_time_scope`, `open_question_id`, `mcp_visible_via`, `expired`, the iteration readings and `agent_activity`. `filters/facts.rs` reads these facts instead of re-deriving `index_blocked` | **Move**: `blocked-by.ts`, the virtual-blocker loop, `holdsUnrenderableGoalItems`, `propagateAgentic`, `propagateInheritedScope`, `openQuestion`, `applyMcpVisibility`, `agent-activity.ts`, the Expired half of `commitment-glyph.ts`, and the `passed` and `done` half of `decorateIterationRoots` | Rust tests of `derive_board` from plain rows. The TS tests of the deleted readers become fixture checks that the node carries the fact | `use-mindmap-data.ts`, `api/mindmap.ts`, `tree-layout.ts` (`MindmapNode`), `rs:mindmap/`, `rs:wire.rs`. Any PR adding a node field collides |
| 4 | **The List and Zen rules in Rust, pinned** | `filters::rules` gains the pills, scope-state tokens, row flattening, list sections and Zen contents. The MCP `filter` gains the pills | **Keep + pin**: `list-filter.ts` (pills), `list-data.ts` (flattening), `list-sections.ts`, `zen-contents.ts`, `view-preset.ts` | `preset-filters.json` gains `list_filter` cases, plus new `list-sections.json` and `zen-contents.json`. Port the TS tests to Rust as their spec. `mcp-server.md` drops the pills from *deliberately absent*, and `filtering-logic.md` names the new corpora | `rs:filters/`, `rs:mcp/`, the two specs. The TS files change only to add the vitest replay |
| 5 | **Gestures and capabilities** | Intents for `advance_status`, `alt_step`, `toggle_agentic`, `cycle_verdict` and `paste`. `nodes::rules::may_parent`, called by every writer. `capabilities` on each node. Queries for `dependency_candidates` and root candidates | **Move**: `task-status-cycle.ts`, `storedStatus`, `toggledAgenticState`, the verdict cycle, `takesCompound`, `derived-wait.ts`, `canDescendInto`, the node half of `paste-refusal.ts`, `canConvertNodeToFlow`, `dependency-candidates.ts`, `rootCandidates`. **Keep + pin**: `isValidDropTarget` and `validParentKinds`, `convertedStatus` | New `parenting.json` and `task-status.json`. Port each moved TS test to Rust first, then switch the hook. Hook tests mock the command | `use-status-cycle.ts`, `use-node-actions.ts`, `use-node-editor.ts`, the hotkey modules, `node-meta.ts`. Any status or paste feature collides |
| 6 | **Habits and Flows** | `flows::rules::fold`, cooldown options, cycle subdivisions, `valid_targets` for unscoped Flows | **Keep + pin**: `habit-collapse.ts`, `recurrence-ui.ts` (the cooldown rules), `flow-cycle.ts`. **Move**: `flow-target.ts` | New `habit-fold.json`, `cooldown.json` and `flow-cycles.json` | `MindmapView/`, `StepsView/`, `FlowEditorModal/` |
| 7 | **Time and planning** | `tasks::rules::plan_triage`, plan refusal (one rule shared with the writer), plan sections and take-out | **Keep + pin**: `plan-triage.ts`, `plan-sections.ts`, `plan-take-out.ts`, `scope-interval.ts`, and the calendar rules in `scope-calendar.ts` and `plan-scope.ts` | New `plan-triage.json`. `scope-keys.json` gains labels, intervals and "which scope holds this instant" | `PlanView/`, `ScopePicker/` |

**After `122`:** once phase 2b has landed, `a77` splits the workspace (with the core crate holding the rules layer and the
persistence around it) and binds it to Python. Then `2bd` serves the bindings. `a77` must not start
its crate split while phase 2 or 2b is in flight, or the tree is moved twice under the same PRs.

**Ordering.** Phase 1 sets the convention and its check on code that is already pure, so it is the
safest place to start. Phase 2 is the risky Rust move and comes before any port, so that ports land
in their final modules, as `122` decides ("reorganise first, then port into the structure that
exists"). Phase 2b follows phase 2, because the extracted rules are what it frees from `sqlx`. Phase 3 needs
phase 2's pure derivation, and can run beside 2b if the two touch different domains. Phases 4 to 7 are independent of each other once
phase 3 has landed, and are ordered by value: phase 4 makes the List View's rules reachable by the
MCP, and phase 5 removes the most unpinned duplication.

## 4. Corpora

| Corpus | Pins | Exists | Phase |
| --- | --- | --- | --- |
| `conformance/preset-filters.json` | Presets on the tree and on list rows; gains the pills and flattening | Yes | 4 |
| `conformance/scope-keys.json` | Key text and windows; gains labels, intervals and the instant → scope rule | Yes | 7 |
| `conformance/list-sections.json` | Review, Overdue and Asynchronous sections | New | 4 |
| `conformance/zen-contents.json` | The grid, the strips and the locked presets | New | 4 |
| `conformance/parenting.json` | The kind × kind parenting matrix | New | 5 |
| `conformance/task-status.json` | The two status models, spellings and conversion | New | 5 |
| `conformance/habit-fold.json` | The fold's levels and grouping | New | 6 |
| `conformance/cooldown.json`, `conformance/flow-cycles.json` | The cooldown options and cycle subdivisions | New | 6 |
| `conformance/plan-triage.json` | Triage, refusals, sections and take-out | New | 7 |

Each corpus is written from the spec and generated by neither side, as `preset-filters.json` is,
and each is replayed by one Rust test and one vitest.

## 5. Follow-up Tasks

None. The user decided that phases 1 to 7 and 2b all stay inside `122` ("All folding is in 122 for
now").

## 6. `122`'s brief, amended

This text replaces the Problem, Solution and Out of Scope sections of `122`'s brief. It absorbs
`197`'s inventory. The amendment is proposed here: the brief on the board changes only when the
user or the orchestrator writes it.

> **Problem.** Business rules are spread across Rust persistence code and TypeScript. Some Rust
> rules are pure (`filters/`, `tasks/lifecycle.rs`, `tasks/review.rs`, `flows/habits.rs`,
> `flows/cooldown.rs`). Others take a `Db` session (`tasks/scope_rules.rs`, `tasks/compound.rs`,
> `flows/occurrences.rs`, `nodes/table.rs`), and many are inline in `tasks/mod.rs` (1,793 lines) and
> `flows/mod.rs` (4,014 lines). Domain models carry `sqlx` derives. Some rules exist only in
> TypeScript: the List View's pills, flattening and sections, Zen contents, agent activity, the
> status cycle, the Habit fold, Plan triage and the parenting table. Others exist in both languages
> without a pin: dependency blocks and their text, Agentic and Time Scope inheritance, the Review
> question and MCP visibility.
>
> **Solution.** ADR 0010. Every business rule lives in a pure `rules` module per domain, which
> imports no session, `sqlx`, `tauri`, `tokio` or I/O, checked in CI. The board is derived by a pure
> `derive_board(rows, now, capacity)`. Domain and database models are separate: row structs and
> conversions live in persistence. The frontend keeps a copy of a rule only for UX or speed, pinned
> by a shared corpus. Otherwise it reads the backend's answer, or sends an intent. The phases,
> inventory and corpora are in `docs/superpowers/plans/2026-10-02-business-rules-layer.md`.
>
> **Out of scope.** The crate split and Python bindings (`a77`), FastAPI (`2bd`), and any behaviour
> change. Retype no longer exists (#102), so its planning half and type-cycling validity are gone.
