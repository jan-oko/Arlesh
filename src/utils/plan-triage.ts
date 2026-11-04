// The Plan View's whole decision: which Tasks are candidates for the scope being filled, which are
// already in it, and which bound a move would break. There is no TypeScript copy of the rule: the
// triage and the refusal are `tasks::rules::plan` compiled to wasm (`src/wasm/rules.ts`), which
// resolves the scope's window itself, so nothing here reaches for the network and the two panes
// re-derive synchronously as the scope is walked. This file reads rows into the rule's shape.

import type { ScopeKey } from "@/api/scopes";
import { scopeKeyText, type ScopeKeyText } from "@/utils/scope-key";
import type { TimeScope } from "@/api/time-scope";
import type { TaskListRow } from "@/utils/list-filter";
import type { ScopeInterval } from "@/utils/scope-interval";

import { isOverdue } from "@/utils/overdue";
import { planRefusal as wasmPlanRefusal, planTriage } from "@/wasm/rules";
import type { PlanRowInput } from "@/wasm/rules";

/** Every scope id resolved to its window, keyed by the key's canonical text. */
export type ScopeWindows = ReadonlyMap<ScopeKeyText, ScopeInterval>;

/** Which containment invariant a move would break. Named, not phrased — the view words it. */
export type PlanRefusal = "ownTimeScope" | "parentPlan";

/**
 * The Time Scope a Task *reads*: its own, or — a null Time Scope meaning "inherit" — the nearest
 * scoped ancestor's. `null` here means the task is genuinely **Unscoped**, which the model defines
 * as always relevant, not as never relevant.
 */
export function effectiveTimeScope(row: TaskListRow): TimeScope | null {
  const own = row.node.timeScope;
  if (own != null) return own;
  for (let i = row.ancestors.length - 1; i >= 0; i--) {
    const ancestor = row.ancestors[i];
    const inherited = ancestor?.timeScope;
    if (inherited != null) return inherited;
  }
  return null;
}

/**
 * The Plan a row reads: its own, else the one it inherits — the backend's rule, served on the node
 * (`docs/spec/time-scopes.md`, *Plan inheritance*). `null` when it reads none.
 */
export function effectivePlan(row: TaskListRow): TimeScope | null {
  return row.node.plan ?? row.node.inheritedPlan ?? null;
}

/** Whether something above the row is planned but that Plan does not meet its window, so it reads
 * no Plan and no Plan of its own could sit inside one. */
function inheritsNothing(row: TaskListRow): boolean {
  return row.node.planConflict === "empty" && row.node.plan == null;
}

/** The row, in the shape the rule reads. A node that draws no row (`virtual`) has nowhere to write a
 * Plan and the rule leaves it out. */
function planRowOf(row: TaskListRow): PlanRowInput {
  const { node } = row;
  return {
    id: node.id,
    virtual: node.virtual === true,
    timeScope: node.timeScope ?? null,
    plan: node.plan ?? null,
    inheritedPlan: node.inheritedPlan ?? null,
    emptyPlan: inheritsNothing(row),
    overdue: isOverdue(node),
    ancestors: row.ancestors.map((ancestor) => ({ timeScope: ancestor.timeScope ?? null })),
  };
}

/**
 * A Time Scope's combined window — the start of its start boundary through the end of its end
 * boundary — or `null` when either endpoint has not been resolved yet.
 *
 * `null` is "not known", never "no constraint": every caller treats an unresolved window as a
 * reason to leave the task out rather than as permission to move it.
 */
export function timeScopeWindow(scope: TimeScope, windows: ScopeWindows): ScopeInterval | null {
  const start = windows.get(scopeKeyText(scope.start_id));
  const end = windows.get(scopeKeyText(scope.end_id));
  if (start === undefined || end === undefined) return null;
  return { start: start.start, end: end.end };
}

/** Every scope id the triage has to resolve before it can answer: each row's own and inherited
 * Time Scope, its Plan, and the Plan it inherits. */
export function referencedScopeIds(rows: readonly TaskListRow[]): ScopeKey[] {
  const ids = new Map<ScopeKeyText, ScopeKey>();
  function add(scope: TimeScope | null | undefined): void {
    if (scope == null) return;
    ids.set(scopeKeyText(scope.start_id), scope.start_id);
    ids.set(scopeKeyText(scope.end_id), scope.end_id);
  }
  for (const row of rows) {
    add(row.node.timeScope);
    add(row.node.plan);
    add(row.node.inheritedPlan);
    for (const ancestor of row.ancestors) add(ancestor.timeScope);
  }
  return [...ids.values()];
}

/** What one triage pass makes of the board, in three heaps. */
export interface PlanPanes {
  /** Unplanned Tasks whose effective Time Scope reaches into the scope being filled. */
  unplanned: TaskListRow[];
  /** Tasks already planned into the scope being filled. */
  planned: TaskListRow[];
  /**
   * Tasks planned to the scope's **parent**: committed at the rung above, and so not yet placed in
   * this one. The work pinned to the month, while you are filling one of its weeks.
   *
   * *To* the parent, not "anywhere coarser", so a plan on the *season* is not offered while you
   * fill a week. A pass places what the pass above it committed, one rung at a time, and reaching
   * two rungs up would be doing the month's pass inside the week's.
   *
   * Empty for a Season, which has no parent (see `parentRefs`). Before the two kebab menus this heap did not exist at
   * all, which is what made a pass over a week open on work it had no opinion about instead of on
   * the month's own backlog of it.
   */
  parentPlanned: TaskListRow[];
}

/**
 * Splits the rows into the heaps for `target`, whose parent scope is `parent` — none for a Season.
 *
 * **Unplanned** is the work that is relevant *now*: a Task that reads no Plan whose effective Time
 * Scope overlaps the scope (an Unscoped task is always relevant). **Planned** is containment, not
 * equality. **Parent-planned** is a Plan that *is* the parent scope, compared by id. A Task planned
 * somewhere else entirely is in none of them. A Habit occurrence is triaged like a Task, by its
 * Plan. See `tasks::rules::plan::triage`, which this asks.
 */
export function partitionForScope(rows: readonly TaskListRow[], target: ScopeKey, parent: ScopeKey | null): PlanPanes {
  const ids = planTriage({ target, parent, rows: rows.map(planRowOf) });
  const byId = new Map(rows.map((row) => [row.node.id, row]));
  const pick = (wanted: readonly string[]): TaskListRow[] =>
    wanted.flatMap((id) => {
      const row = byId.get(id);
      return row === undefined ? [] : [row];
    });
  return { unplanned: pick(ids.unplanned), planned: pick(ids.planned), parentPlanned: pick(ids.parentPlanned) };
}

/**
 * Which bound planning `row` into `target` would break, or `null` when the move is allowed: the
 * write-time rules, in the order the writer reads them, so the view's refusal and the writer's
 * cannot disagree about *which* bound a doomed move breaks (`tasks::rules::plan`).
 */
export function planRefusal(row: TaskListRow, target: ScopeKey): PlanRefusal | null {
  switch (wasmPlanRefusal({ row: planRowOf(row), target })) {
    case "own_time_scope": return "ownTimeScope";
    case "parent_plan": return "parentPlan";
    case null: return null;
  }
}
