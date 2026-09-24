// The Plan View's whole decision, as pure functions: which Tasks are candidates for the scope
// being filled, which are already in it, and which bound a move would break. Nothing here reaches
// for the network — scope windows arrive already resolved (see `use-scope-windows`), so the two
// panes re-derive synchronously as the scope is walked.

import type { ScopeKey } from "@/api/scopes";
import { sameScopeKey, scopeKeyText, type ScopeKeyText } from "@/utils/scope-key";
import type { TimeScope } from "@/api/time-scope";
import type { TaskListRow } from "@/utils/list-filter";
import type { MindmapNode } from "@/utils/tree-layout";
import type { ScopeInterval } from "@/utils/scope-interval";
import { intervalContains, intervalsOverlap } from "@/utils/scope-interval";

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

/** The nearest ancestor that is itself planned, or `null` — the bound `child.Plan ⊆ parent.Plan` reads. */
export function nearestPlannedAncestor(row: TaskListRow): MindmapNode | null {
  for (let i = row.ancestors.length - 1; i >= 0; i--) {
    const ancestor = row.ancestors[i];
    if (ancestor !== undefined && ancestor.plan != null) return ancestor;
  }
  return null;
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
 * Time Scope, its Plan, and its ancestors' Plans. */
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
    for (const ancestor of row.ancestors) {
      add(ancestor.timeScope);
      add(ancestor.plan);
    }
  }
  return [...ids.values()];
}

/**
 * Whether the Plan View triages a row. A Habit **occurrence** is a row (ADR 0008) and is triaged
 * exactly like a Task, by its Plan — the Cycle Plan its Habit (or its item) gives it unless the
 * occurrence was planned on its own. With none it is **unplanned**, and a candidate wherever its
 * window is relevant; its window is not read as a plan.
 *
 * An iteration **root** is triaged too, by the root Cycle Plan unless it was planned on its own. It
 * is an ordinary row, and for a Habit with no items it is the only occurrence there is. A root and
 * its item occurrences each appear, as a Task and its subtasks do — each is one row in one heap.
 *
 * Left out: a node that draws no row, which has nowhere to write a Plan.
 */
function isTriageable(node: MindmapNode): boolean {
  return node.virtual !== true;
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
 * Splits the rows into the heaps for `target`, whose parent scopes are `parentIds` — none for a
 * Season, one everywhere else — for a week at a month's edge, the month holding its first day.
 *
 * **Unplanned** is the work that is relevant *now*: a Task with no Plan at all whose effective Time
 * Scope overlaps the scope. An **Unscoped** task is always relevant and so is always here — the
 * model says an unscoped item is always active, and a planning pass is exactly where unscoped work
 * should be offered.
 *
 * **Planned** is containment, not equality: a Task pinned to Tuesday is part of what this week
 * holds, and a week being filled has to show it or the right-hand pane would under-report the load
 * it exists to report.
 *
 * **Parent-planned** is a Plan that **is** a parent scope — one boundary, and that boundary a parent.
 * Compared by id rather than by window: a week at a month's edge is not contained by either of its
 * months, so "contains the scope" would find nothing there, and the question was never about
 * containment in the first place.
 *
 * A Task planned somewhere else entirely is in **none** of them. It is not unscheduled, it is not
 * in this scope, and it is not at the rung above it.
 */
export function partitionForScope(
  rows: readonly TaskListRow[],
  target: ScopeInterval,
  windows: ScopeWindows,
  parentIds: ReadonlySet<ScopeKeyText>,
): PlanPanes {
  const unplanned: TaskListRow[] = [];
  const planned: TaskListRow[] = [];
  const parentPlanned: TaskListRow[] = [];
  for (const row of rows) {
    if (!isTriageable(row.node)) continue;
    const plan = row.node.plan;
    if (plan != null) {
      if (sameScopeKey(plan.start_id, plan.end_id) && parentIds.has(scopeKeyText(plan.start_id))) {
        parentPlanned.push(row);
        continue;
      }
      const planWindow = timeScopeWindow(plan, windows);
      if (planWindow !== null && intervalContains(target, planWindow)) planned.push(row);
      continue;
    }
    const relevance = effectiveTimeScope(row);
    if (relevance === null) {
      unplanned.push(row);
      continue;
    }
    const window = timeScopeWindow(relevance, windows);
    if (window !== null && intervalsOverlap(window, target)) unplanned.push(row);
  }
  return { unplanned, planned, parentPlanned };
}

/**
 * Which bound planning `row` into `target` would break, or `null` when the move is allowed.
 *
 * The two rules are the write-time ones, read in the order the backend reads them, so the view's
 * refusal and the backend's cannot disagree about *which* bound a doomed move breaks:
 *
 * - `Plan ⊆ TimeScope`, against the task's **own** window only. An inherited window constrains the
 *   window a task may take, not the Plan it may hold — that is the model's rule, and widening the
 *   task's own window on the user's behalf is an editor decision, not a triage one.
 * - `child.Plan ⊆ parent.Plan`, against the nearest planned ancestor.
 *
 * A bound whose window has not resolved refuses nothing here: the backend still checks, and a
 * refusal the view cannot explain is better raised by the writer than guessed at.
 */
export function planRefusal(
  row: TaskListRow,
  target: ScopeInterval,
  windows: ScopeWindows,
): PlanRefusal | null {
  const own = row.node.timeScope;
  if (own != null) {
    const ownWindow = timeScopeWindow(own, windows);
    if (ownWindow !== null && !intervalContains(ownWindow, target)) return "ownTimeScope";
  }
  const ancestor = nearestPlannedAncestor(row);
  const ancestorPlan = ancestor?.plan;
  if (ancestorPlan != null) {
    const ancestorWindow = timeScopeWindow(ancestorPlan, windows);
    if (ancestorWindow !== null && !intervalContains(ancestorWindow, target)) return "parentPlan";
  }
  return null;
}
