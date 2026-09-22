// Pure selection primitives for the Scope Picker. A ScopeRef identifies a calendar cell by its
// content (not a DB id), so selection logic stays synchronous and testable; the cell is
// materialized to a Scope id only when the selection is resolved.

import type { PartOfDay, Scope } from "@/api/scopes";

/** The four calendar-aligned scope kinds selectable by an anchor date. */
export type CanonicalKind = "season" | "month" | "week" | "day";

/** A materializable reference to a calendar cell. */
export type ScopeRef =
  | { kind: CanonicalKind; date: string }
  | { kind: "part_of_day"; date: string; part: PartOfDay }
  | { kind: "exact"; start: string; end: string };

/** Parts ordered by their start hour within a calendar day (Night starts at 22:00, so last). */
const PART_ORDER: PartOfDay[] = [
  "premorning",
  "morning",
  "noon",
  "afternoon",
  "evening",
  "night",
];

/**
 * The calendar cell a persisted scope occupies, or null for a row that names no cell — a
 * Part-of-Day scope with no band, or an Exact scope with no datetimes. The caller falls back to
 * its own default rather than guessing a cell.
 */
export function refForScope(scope: Scope): ScopeRef | null {
  if (scope.kind === "part_of_day") {
    return scope.part === null ? null : { kind: "part_of_day", date: scope.start_date, part: scope.part };
  }
  if (scope.kind === "exact") {
    const { start_datetime: start, end_datetime: end } = scope;
    return start === null || end === null ? null : { kind: "exact", start, end };
  }
  return { kind: scope.kind, date: scope.start_date };
}

/** Whether two refs identify the same cell. */
export function sameScopeRef(a: ScopeRef, b: ScopeRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "exact" && b.kind === "exact") {
    return a.start === b.start && a.end === b.end;
  }
  if (a.kind === "part_of_day" && b.kind === "part_of_day") {
    return a.date === b.date && a.part === b.part;
  }
  // Both canonical of the same kind.
  return "date" in a && "date" in b && a.date === b.date;
}

/** A chronologically-sortable key for refs of the same kind. */
export function refSortKey(ref: ScopeRef): string {
  if (ref.kind === "exact") return ref.start;
  if (ref.kind === "part_of_day") return `${ref.date}#${PART_ORDER.indexOf(ref.part)}`;
  return ref.date;
}

/** Orders two refs earliest-first. */
export function orderRefs(a: ScopeRef, b: ScopeRef): [ScopeRef, ScopeRef] {
  return refSortKey(a) <= refSortKey(b) ? [a, b] : [b, a];
}

/** A two-endpoint range selection. */
export interface RangeSelection {
  start: ScopeRef | null;
  end: ScopeRef | null;
}

/**
 * Single-mode click: clicking the selected cell deselects it, any other click replaces.
 */
export function nextSingleSelection(
  current: ScopeRef | null,
  clicked: ScopeRef,
): ScopeRef | null {
  return current !== null && sameScopeRef(current, clicked) ? null : clicked;
}

/**
 * Range-mode click: first click (or a third click, when both endpoints are set) starts a new
 * range; the second click sets the end, ordered earliest-first.
 */
export function nextRangeSelection(
  current: RangeSelection,
  clicked: ScopeRef,
): RangeSelection {
  if (current.start === null || current.end !== null) {
    return { start: clicked, end: null };
  }
  const [start, end] = orderRefs(current.start, clicked);
  return { start, end };
}

/** Moves one endpoint of a range (drag adjust), re-ordering so start stays earliest. */
export function adjustRangeEndpoint(
  current: RangeSelection,
  which: "start" | "end",
  ref: ScopeRef,
): RangeSelection {
  const next: RangeSelection =
    which === "start" ? { start: ref, end: current.end } : { start: current.start, end: ref };
  if (next.start !== null && next.end !== null) {
    const [start, end] = orderRefs(next.start, next.end);
    return { start, end };
  }
  return next;
}
