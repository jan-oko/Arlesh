// The scope selector's rule: which of an item's two windows a picked scope is compared against,
// and how. Pure and synchronous — windows arrive already resolved (`useScopeWindows`), because the
// backend stays the authority on what a scope *spans* and this is only the comparison.
//
// Its Rust twin is `window_matches` / `passes_scope` in `src-tauri/src/filters/rules.rs`, and the
// two are held together by `conformance/preset-filters.json`. The Plan View's two panes read the
// same core with fixed arguments — `Plan × Within` for what a scope already holds, `Relevance ×
// Overlapping` for what could go into it — so there is one implementation of Within and
// Overlapping in the frontend, not three.

import type { TimeScope } from "@/api/time-scope";
import type { MindmapNode } from "@/utils/tree-layout";
import type { ScopeInterval, ScopeWindows } from "@/utils/scope-interval";
import { intervalContains, intervalsOverlap } from "@/utils/scope-interval";

/** Which of an item's two windows a scope selection compares. */
export type ScopeAxis = "relevance" | "plan";

/** How the item's window has to relate to the picked one. */
export type ScopeMatch = "within" | "overlapping";

export const SCOPE_AXIS_VALUES = ["relevance", "plan"] as const;
export const SCOPE_MATCH_VALUES = ["within", "overlapping"] as const;

export function isScopeAxis(value: string): value is ScopeAxis {
  return (SCOPE_AXIS_VALUES as readonly string[]).includes(value);
}

export function isScopeMatch(value: string): value is ScopeMatch {
  return (SCOPE_MATCH_VALUES as readonly string[]).includes(value);
}

/**
 * One scope selection, as it is persisted with the tab: the picked scope's **boundary ids** — the
 * same pair a Time Scope is written in, with a single scope using one id twice — plus the axis and
 * the match rule.
 *
 * Ids rather than the window they resolve to, deliberately. The scope columns are the invariant
 * and the window is derived from them (`docs/spec/time-scopes.md`); a window written down in
 * November would still say 00:00 today. The control re-resolves on every read instead.
 */
export interface ScopeSelection {
  startId: number;
  endId: number;
  axis: ScopeAxis;
  match: ScopeMatch;
}

/** A stored selection that still has the shape the filter reads. */
export function isScopeSelection(value: unknown): value is ScopeSelection {
  if (typeof value !== "object" || value === null) return false;
  if (!("startId" in value) || typeof value.startId !== "number") return false;
  if (!("endId" in value) || typeof value.endId !== "number") return false;
  if (!("axis" in value) || typeof value.axis !== "string" || !isScopeAxis(value.axis)) return false;
  return "match" in value && typeof value.match === "string" && isScopeMatch(value.match);
}

/**
 * A Time Scope's combined window — the start of its start boundary through the end of its end
 * boundary — or `null` when either endpoint has not been resolved yet.
 *
 * A range is one window by construction, which is the whole of "a range selection behaves as one
 * window": the two endpoints are read as the outer bounds of a single interval, never as two.
 *
 * `null` is "not known", never "no constraint": every caller treats an unresolved window as a
 * reason to leave the item out rather than as permission to keep it.
 */
export function timeScopeWindow(scope: TimeScope, windows: ScopeWindows): ScopeInterval | null {
  const start = windows.get(scope.start_id);
  const end = windows.get(scope.end_id);
  if (start === undefined || end === undefined) return null;
  return { start: start.start, end: end.end };
}

/**
 * A node's **own** Time Scope, resolved — `null` when it has none, and also when the one it has
 * could not be resolved.
 *
 * The two collapse into one answer on purpose, and the backend's twin collapses them the same way.
 * A window that could not be read leaves the item reading its ancestors', and an item with no
 * scoped ancestor at all reads as Unscoped: one corrupt scope row costs the filter precision about
 * one item rather than blanking the board, which is the policy every other scope read here takes.
 */
export function ownWindow(node: MindmapNode, windows: ScopeWindows): ScopeInterval | null {
  const own = node.timeScope;
  return own == null ? null : timeScopeWindow(own, windows);
}

/** The nearest ancestor's own resolved window — what an item carrying none of its own reads. */
export function inheritedWindow(
  ancestors: readonly MindmapNode[],
  windows: ScopeWindows,
): ScopeInterval | null {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const ancestor = ancestors[i];
    const window = ancestor === undefined ? null : ownWindow(ancestor, windows);
    if (window !== null) return window;
  }
  return null;
}

/**
 * Within and Overlapping, over two resolved windows — the whole of both match rules, in one place.
 *
 * **Within** answers "what belongs to exactly this week"; **Overlapping** answers "what is
 * relevant *during* this week", the season-scoped item that spans it included. Half-open windows
 * are what make two adjacent scopes read as not overlapping, so next week's work is not this
 * week's candidate.
 */
export function windowMatches(
  item: ScopeInterval,
  target: ScopeInterval,
  match: ScopeMatch,
): boolean {
  return match === "within" ? intervalContains(target, item) : intervalsOverlap(item, target);
}

/** A selection resolved against the board's windows — everything the predicate reads. */
export interface ScopeFilter {
  selection: ScopeSelection;
  /** The picked scope, or range of scopes, as one window. */
  target: ScopeInterval;
  windows: ScopeWindows;
}

/**
 * The active selection with its window resolved, or `null` when there is nothing to narrow by.
 *
 * `null` for no selection **and** for a selection whose own scopes have not resolved yet: a filter
 * that cannot say what it means must not empty the board while it waits.
 */
export function resolveScopeFilter(
  selection: ScopeSelection | null,
  windows: ScopeWindows,
): ScopeFilter | null {
  if (selection === null) return null;
  const target = timeScopeWindow(
    { start_id: selection.startId, end_id: selection.endId },
    windows,
  );
  if (target === null) return null;
  return { selection, target, windows };
}

/**
 * Every scope id a subtree names — each node's own Time Scope and its Plan — plus the selection's
 * own two endpoints.
 *
 * What the scope filter has to resolve before it can answer. Gathered from the tree rather than
 * from the load, so a virtual Habit occurrence — which is no row at all, and carries the windows
 * its iteration resolved to — is counted like any other node.
 */
export function referencedScopeIdsInTree(
  root: MindmapNode,
  selection: ScopeSelection | null,
): number[] {
  const ids = new Set<number>();
  if (selection !== null) {
    ids.add(selection.startId);
    ids.add(selection.endId);
  }
  const add = (scope: TimeScope | null | undefined): void => {
    if (scope == null) return;
    ids.add(scope.start_id);
    ids.add(scope.end_id);
  };
  const visit = (node: MindmapNode): void => {
    add(node.timeScope);
    add(node.plan);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return [...ids];
}

/** The kinds that have a window of their own to answer a scope selection with. */
const SCOPED_KINDS = new Set(["task", "goal", "commitment"]);

/**
 * Whether `node` matches the scope selection, given the nearest scoped ancestor's Time Scope.
 *
 * Only the kinds that carry a window are judged. A Domain, a Project or a Flow item has none, so —
 * exactly as `passesTags` treats a tag filter a Domain cannot answer — it passes here and shows,
 * as always, only as the ancestor of a content match.
 */
export function passesScope(
  node: MindmapNode,
  inherited: ScopeInterval | null,
  scope: ScopeFilter | null,
): boolean {
  if (scope === null) return true;
  if (!SCOPED_KINDS.has(node.kind)) return true;
  const { selection, target, windows } = scope;
  if (selection.axis === "plan") {
    // Only a Task is ever planned, and an unplanned item is not in the picked scope. Absence is an
    // answer on this axis rather than an inapplicable question — the same reading the List View's
    // Scope-state dimension already takes, where "unplanned" is one of its two values. A Plan is
    // never inherited either: a subtask of a Task planned into Tuesday is not itself planned.
    const plan = node.plan;
    if (plan == null) return false;
    const planWindow = timeScopeWindow(plan, windows);
    return planWindow !== null && windowMatches(planWindow, target, selection.match);
  }
  // The **effective** window: the item's own, or the nearest scoped ancestor's.
  const window = ownWindow(node, windows) ?? inherited;
  // Unscoped means *always relevant*, which is an unbounded window: it overlaps every scope and
  // lies wholly inside none.
  if (window === null) return selection.match === "overlapping";
  return windowMatches(window, target, selection.match);
}
