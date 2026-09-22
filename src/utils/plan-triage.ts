// The Plan View's whole decision, as pure functions: which Tasks are candidates for the scope
// being filled, which are already in it, and which bound a move would break. Nothing here reaches
// for the network — scope windows arrive already resolved (see `use-scope-windows`), so the two
// panes re-derive synchronously as the scope is walked.

import type { TimeScope } from "@/api/time-scope";
import type { TaskListRow } from "@/utils/list-filter";
import type { MindmapNode } from "@/utils/tree-layout";
import type { ScopeInterval } from "@/utils/scope-interval";
import { intervalContains, intervalsOverlap } from "@/utils/scope-interval";

/** Every scope id resolved to its window, keyed by id. */
export type ScopeWindows = ReadonlyMap<number, ScopeInterval>;

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
  const start = windows.get(scope.start_id);
  const end = windows.get(scope.end_id);
  if (start === undefined || end === undefined) return null;
  return { start: start.start, end: end.end };
}

/** Every scope id the triage has to resolve before it can answer: each row's own and inherited
 * Time Scope, its Plan, and its ancestors' Plans. */
export function referencedScopeIds(rows: readonly TaskListRow[]): number[] {
  const ids = new Set<number>();
  function add(scope: TimeScope | null | undefined): void {
    if (scope == null) return;
    ids.add(scope.start_id);
    ids.add(scope.end_id);
  }
  for (const row of rows) {
    add(row.node.timeScope);
    add(row.node.plan);
    for (const ancestor of row.ancestors) {
      add(ancestor.timeScope);
      add(ancestor.plan);
    }
  }
  return [...ids];
}

/**
 * A Task the first cut of the Plan View will not triage.
 *
 * Virtual rows — a Habit's occurrences and its iteration roots — have no DB row to carry a Plan,
 * so offering to plan one would be a gesture with nowhere to write. Planning a recurrence is its
 * own question and is deliberately out of scope here.
 */
function isTriageable(node: MindmapNode): boolean {
  return node.virtual !== true && node.habitItem === undefined;
}

/** What one triage pass makes of the board, in three heaps. */
export interface PlanPanes {
  /** Unplanned Tasks whose effective Time Scope reaches into the scope being filled. */
  unplanned: TaskListRow[];
  /** Tasks already planned into the scope being filled. */
  planned: TaskListRow[];
  /**
   * Tasks planned **coarser** than the scope being filled: their Plan contains it without being
   * contained by it — the month, while you are filling one of its weeks.
   *
   * They are committed, but not to anywhere as fine as this pass is placing at, so they are exactly
   * "what still needs placing" and they belong with the candidates. Before the two kebab menus they
   * were in neither pane, which is what made a pass over a week open on work it had no opinion
   * about instead of on the month's own backlog of it.
   */
  coarser: TaskListRow[];
}

/**
 * Splits the rows into the heaps for `target`.
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
 * **Coarser** is the other side of that comparison — containment the other way round, and strictly,
 * so a plan that *is* this scope counts as planned rather than as coarser than itself.
 *
 * A Task planned somewhere else entirely is in **none** of them. It is not unscheduled, it is not
 * in this scope, and it is not above it.
 */
export function partitionForScope(
  rows: readonly TaskListRow[],
  target: ScopeInterval,
  windows: ScopeWindows,
): PlanPanes {
  const unplanned: TaskListRow[] = [];
  const planned: TaskListRow[] = [];
  const coarser: TaskListRow[] = [];
  for (const row of rows) {
    if (!isTriageable(row.node)) continue;
    const plan = row.node.plan;
    if (plan != null) {
      const planWindow = timeScopeWindow(plan, windows);
      if (planWindow === null) continue;
      if (intervalContains(target, planWindow)) planned.push(row);
      else if (intervalContains(planWindow, target)) coarser.push(row);
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
  return { unplanned, planned, coarser };
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
