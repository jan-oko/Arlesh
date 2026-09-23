// Splitting the Plan View's *planned* pane into one section per subscope: the weeks of a month, the
// days of a week, the bands of a day. Pure, so the view can re-derive it synchronously as the scope
// is walked, exactly as `plan-triage` does.
//
// **Everything here compares dates, never instants.** A scope row carries `start_date`/`end_date`
// as plain `YYYY-MM-DD`, and a calendar cell carries the same, so "is this plan inside that week"
// is a string comparison. That is deliberate: what instant a day *begins* at is the backend's
// business, and an interval built here from a date would bake in an answer this file has no
// business knowing. Dates are dates under either convention.

import type { Scope, ScopeKind } from "@/api/scopes";
import type { TaskListRow } from "@/utils/list-filter";
import type { ScopeRef } from "@/utils/scope-ref";
import type { ScopeCell, ViewKind } from "@/utils/scope-calendar";
import { cellsForView, descendKind } from "@/utils/scope-calendar";

/** One drawn bucket of the planned pane. */
export interface PlanSection {
  /** Stable across re-derives, so React keeps a section's rows mounted while the pane updates. */
  key: string;
  /** The calendar cell this bucket *is* — what a drop or a hotkey plans into, and what names it. */
  ref: ScopeRef;
  /** The bucket's own dates, drawn when it is `partial` so a week that pokes out says how far. */
  range: { startDate: string; endDate: string };
  /** Whether the bucket reaches outside the scope being filled. */
  partial: boolean;
  rows: TaskListRow[];
}

/** A split pane: its buckets, and what none of them holds. */
export interface PlanSplit {
  sections: PlanSection[];
  /**
   * Rows the triage put in this scope that no bucket holds — planned to the scope *itself*, spread
   * across several buckets, or with a plan not read back yet.
   *
   * They are handed back rather than filed under a catch-all heading in the pane. While you are
   * filling a scope's parts, work pinned to the scope at large is work that still needs placing,
   * which is what the *candidates* side is for; a section here would have shown it among the work
   * that is already placed and offered no way to move it.
   */
  unplaced: TaskListRow[];
}

/** What the split leaves out unless it is asked for, or unless something is planned there. */
export interface PlanSplitOptions {
  /**
   * Whether a Day's **Premorning** (02:00–06:00) is drawn as a bucket of its own.
   *
   * Off by default: the small hours are not a place most work is planned into, and a bucket nobody
   * fills is a seventh of the pane spent saying so. It is drawn anyway when it holds something —
   * the pane never holds fewer tasks than the triage put in it.
   */
  includePremorning: boolean;
}

/** The view a scope kind is drawn in, or `null` for one that has no calendar view of its own. */
function viewKindOfScope(kind: ScopeKind): ViewKind | null {
  return kind === "exact" ? null : kind;
}

/**
 * The days a cell **belongs to**, which is not always the days its window touches.
 *
 * A part of day belongs wholly to the Day it names. The whole ladder turns over at 02:00 (see
 * `DAY_BOUNDARY_HOUR`), so a Day runs 02:00 → 02:00 and contains its own Night, 22:00 → 02:00,
 * entirely — even though Night's *window* ends on the following date, which is what the cell's
 * `endDate` reports for the calendar grid to shade. Reading that end date as containment is what
 * used to mark every Day's Night as straddling its own Day.
 */
function cellDays(cell: ScopeCell): { startDate: string; endDate: string } {
  if (cell.ref.kind === "part_of_day") return { startDate: cell.startDate, endDate: cell.startDate };
  return { startDate: cell.startDate, endDate: cell.endDate };
}

/** Whether two inclusive date ranges share any day. */
function rangesOverlap(a: { startDate: string; endDate: string }, b: { startDate: string; endDate: string }): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

/**
 * Whether `cell` is the subscope that holds a plan running from `start` to `end`.
 *
 * Parts of a day all carry the same date, so date containment cannot tell them apart and the band
 * itself is the test. A plan on the *day* rather than on one of its bands names no band, matches no
 * cell, and falls to {@link PlanSplit.unplaced} — which is right: while you are filling a day, work
 * pinned to the day at large is not yet in any part of it.
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
 * dropped, because a week dropped here would hide whatever is planned into it from the month's view
 * entirely.
 */
export function subscopeCells(target: Scope): ScopeCell[] {
  const view = viewKindOfScope(target.kind);
  if (view === null) return [];
  const child = descendKind(view);
  if (child === null) return [];
  const span = { startDate: target.start_date, endDate: target.end_date };
  return cellsForView(child, target.start_date).filter((cell) => rangesOverlap(cellDays(cell), span));
}

/** A bucket's key: its cell, named so that two passes over the same scope agree. */
function sectionKey(cell: ScopeCell): string {
  return `cell:${cell.startDate}:${cell.ref.kind === "part_of_day" ? cell.ref.part : ""}`;
}

/**
 * The planned pane, split into one section per subscope of `target`, plus what no section holds.
 *
 * Returns `null` when there is nothing to split by — a Part of Day has no kind below it, and an
 * Exact window is not a calendar cell — which the view reads as "draw the pane flat".
 *
 * `scopes` supplies the plan endpoints' own rows; a row whose plan has not been read back yet is
 * `unplaced` rather than dropped, so nothing the triage produced goes missing.
 *
 * **Empty sections are kept.** An empty week is the answer to "what is in this month" just as much
 * as a full one, and it is the only way the pane can show you a bucket you have not filled yet. The
 * one bucket that can be left out is Premorning, and only while it is empty — see
 * {@link PlanSplitOptions}.
 */
export function buildPlanSections(
  planned: readonly TaskListRow[],
  target: Scope,
  scopes: ReadonlyMap<number, Scope>,
  options: PlanSplitOptions,
): PlanSplit | null {
  const cells = subscopeCells(target);
  if (cells.length === 0) return null;

  const sections: PlanSection[] = cells.map((cell) => {
    const days = cellDays(cell);
    return {
      key: sectionKey(cell),
      ref: cell.ref,
      range: { startDate: cell.startDate, endDate: cell.endDate },
      partial: days.startDate < target.start_date || days.endDate > target.end_date,
      rows: [],
    };
  });

  const unplaced: TaskListRow[] = [];
  for (const row of planned) {
    const plan = row.node.plan;
    const start = plan == null ? undefined : scopes.get(plan.start_id);
    const end = plan == null ? undefined : scopes.get(plan.end_id);
    const index = start === undefined || end === undefined
      ? -1
      : cells.findIndex((cell) => cellHoldsPlan(cell, start, end));
    const section = index === -1 ? undefined : sections[index];
    if (section === undefined) unplaced.push(row); else section.rows.push(row);
  }

  return { sections: sections.filter((section) => keepSection(section, options)), unplaced };
}

/** Whether a bucket is drawn: every one of them, except an empty Premorning nobody asked for. */
function keepSection(section: PlanSection, options: PlanSplitOptions): boolean {
  if (options.includePremorning) return true;
  if (section.ref.kind !== "part_of_day" || section.ref.part !== "premorning") return true;
  return section.rows.length > 0;
}
