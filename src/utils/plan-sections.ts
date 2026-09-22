// Splitting the Plan View's *planned* pane into one section per subscope: the weeks of a month,
// the days of a week, the bands of a day. Pure, so the view can re-derive it synchronously as the
// scope is walked, exactly as `plan-triage` does.
//
// **Everything here compares dates, never instants.** A scope row carries `start_date`/`end_date`
// as plain `YYYY-MM-DD`, and a calendar cell carries the same, so "is this plan inside that week"
// is a string comparison. That is deliberate: what instant a day *begins* at is the backend's
// business and is moving off midnight, and an interval built here from a date would bake in the
// answer this file has no business knowing. Dates are dates under either convention.

import type { Scope, ScopeKind } from "@/api/scopes";
import type { TaskListRow } from "@/utils/list-filter";
import type { ScopeCell, ViewKind } from "@/utils/scope-calendar";
import { cellsForView, descendKind } from "@/utils/scope-calendar";

/** One drawn bucket of the planned pane. */
export interface PlanSection {
  /** Stable across re-derives, so React keeps a section's rows mounted while the pane updates. */
  key: string;
  /** What the header says: the cell's own name, or the catch-all's. */
  label: string;
  /**
   * The subscope's own dates, drawn when it is `partial` so a week that pokes out of the month
   * says how far. `null` for the catch-all, which names no cell.
   */
  range: { startDate: string; endDate: string } | null;
  /** Whether the subscope reaches outside the scope being filled. */
  partial: boolean;
  /** True for the catch-all — work planned into the scope but into no single subscope of it. */
  unbucketed: boolean;
  rows: TaskListRow[];
}

/** The view a scope kind is drawn in, or `null` for one that has no calendar view of its own. */
function viewKindOfScope(kind: ScopeKind): ViewKind | null {
  return kind === "exact" ? null : kind;
}

/** Whether two inclusive date ranges share any day. */
function rangesOverlap(a: { startDate: string; endDate: string }, b: { startDate: string; endDate: string }): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

/**
 * A section header for a cell. `cellsForView` labels a day with its day-of-month alone — right on a
 * calendar grid, where the column says which weekday it is, and far too thin standing on its own
 * above a list of tasks. Every other kind already names itself.
 */
function labelForCell(cell: ScopeCell): string {
  return cell.ref.kind === "day" ? cell.startDate : cell.label;
}

/**
 * Whether `cell` is the subscope that holds a plan running from `start` to `end`.
 *
 * Parts of a day all carry the same date, so date containment cannot tell them apart and the band
 * itself is the test. A plan on the *day* rather than on one of its bands names no band, matches
 * no cell, and falls to the catch-all — which is right: while you are filling a day, work pinned
 * to the day at large is not in any part of it.
 */
function cellHoldsPlan(cell: ScopeCell, start: Scope, end: Scope): boolean {
  if (cell.ref.kind === "part_of_day") {
    return (
      start.part === cell.ref.part
      && end.part === cell.ref.part
      && start.start_date === cell.ref.date
      && end.start_date === cell.ref.date
    );
  }
  return cell.startDate <= start.start_date && end.end_date <= cell.endDate;
}

/**
 * The subscopes of `target`: the cells of the next view down, kept to those that touch it.
 *
 * `cellsForView` answers for a whole calendar period rather than for one scope — the month view is
 * a year of months, the week view a month of weeks — so the filter is what turns "every month of
 * 2026" into "the three months of this season". It is also what keeps a **straddling** cell: a
 * month's first and last weeks usually poke outside it, and they are kept and marked rather than
 * dropped, because a week dropped here would hide whatever is planned into it from the month's
 * view entirely.
 */
export function subscopeCells(target: Scope): ScopeCell[] {
  const view = viewKindOfScope(target.kind);
  if (view === null) return [];
  const child = descendKind(view);
  if (child === null) return [];
  const span = { startDate: target.start_date, endDate: target.end_date };
  return cellsForView(child, target.start_date).filter((cell) => rangesOverlap(cell, span));
}

/**
 * The planned pane, split into one section per subscope of `target`.
 *
 * Returns `null` when there is nothing to split by — a Part of Day has no kind below it, and an
 * Exact window is not a calendar cell — which the view reads as "draw the pane flat".
 *
 * `scopes` supplies the plan endpoints' own rows; a row whose plan has not been read back yet
 * falls to the catch-all rather than being dropped, so the pane never quietly holds fewer tasks
 * than the triage put in it.
 *
 * **Empty sections are kept.** An empty week is the answer to "what is in this month" just as much
 * as a full one, and it is the only way the pane can show you a bucket you have not filled yet.
 * The catch-all is the exception and is returned only when it has something in it: a section
 * saying "nothing here is planned loosely" reports the absence of an anomaly, which is noise.
 */
export function buildPlanSections(
  planned: readonly TaskListRow[],
  target: Scope,
  scopes: ReadonlyMap<number, Scope>,
): PlanSection[] | null {
  const cells = subscopeCells(target);
  if (cells.length === 0) return null;

  const sections: PlanSection[] = cells.map((cell) => ({
    key: `cell:${cell.startDate}:${cell.ref.kind === "part_of_day" ? cell.ref.part : ""}`,
    label: labelForCell(cell),
    range: { startDate: cell.startDate, endDate: cell.endDate },
    partial: cell.startDate < target.start_date || cell.endDate > target.end_date,
    unbucketed: false,
    rows: [],
  }));

  const loose: TaskListRow[] = [];
  for (const row of planned) {
    const plan = row.node.plan;
    const start = plan == null ? undefined : scopes.get(plan.start_id);
    const end = plan == null ? undefined : scopes.get(plan.end_id);
    const index = start === undefined || end === undefined
      ? -1
      : cells.findIndex((cell) => cellHoldsPlan(cell, start, end));
    const section = index === -1 ? undefined : sections[index];
    if (section === undefined) loose.push(row); else section.rows.push(row);
  }

  if (loose.length === 0) return sections;
  return [{ key: "unbucketed", label: "", range: null, partial: false, unbucketed: true, rows: loose }, ...sections];
}
