// Pure calendar layout for the Scope Picker: enumerates the cells of each view and the
// navigation between views. This is the client-side "grid layout" half of the hybrid decision;
// the backend remains the source of truth for a materialized scope's authoritative bounds.

import { refForScope, type CanonicalKind, type ScopeRef } from "@/utils/scope-ref";
import type { PartOfDay, Scope } from "@/api/scopes";

/** A single selectable calendar cell. `startDate`/`endDate` are inclusive ISO dates for shading. */
export interface ScopeCell {
  ref: ScopeRef;
  label: string;
  startDate: string;
  endDate: string;
}

/** The navigable view kinds, coarsest to finest. */
export type ViewKind = CanonicalKind | "part_of_day";

const VIEW_ORDER: ViewKind[] = ["season", "month", "week", "day", "part_of_day"];

/** The finer view reached by double-clicking a cell, or null at the finest level. */
export function descendKind(kind: ViewKind): ViewKind | null {
  const next = VIEW_ORDER[VIEW_ORDER.indexOf(kind) + 1];
  return next ?? null;
}

/** The coarser view reached by going up, or null at the coarsest level. */
export function ascendKind(kind: ViewKind): ViewKind | null {
  const index = VIEW_ORDER.indexOf(kind);
  return index > 0 ? VIEW_ORDER[index - 1] ?? null : null;
}

/** The coarser of two views. */
function coarserKind(a: ViewKind, b: ViewKind): ViewKind {
  return VIEW_ORDER.indexOf(a) <= VIEW_ORDER.indexOf(b) ? a : b;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const PART_LABELS: Record<PartOfDay, string> = {
  premorning: "Premorning",
  morning: "Morning",
  noon: "Noon",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night",
};

// Parts in chronological order within a calendar day, with their start day-offset handling for
// Night (which ends on the following day).
const PART_SEQUENCE: PartOfDay[] = ["premorning", "morning", "noon", "afternoon", "evening", "night"];

// --- date helpers (UTC to avoid timezone drift) ---

function utc(year: number, month1: number, day: number): Date {
  return new Date(Date.UTC(year, month1 - 1, day));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parse(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function addDays(iso: string, days: number): string {
  const d = parse(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

/** The Sunday that begins the week containing `iso`. */
export function weekStart(iso: string): string {
  const d = parse(iso);
  return addDays(iso, -d.getUTCDay());
}

/** The calendar day before `iso`. */
export function previousDay(iso: string): string {
  return addDays(iso, -1);
}

/** Season name and display year for a date, matching the Rust scope model. */
export function seasonOf(iso: string): { name: string; year: number } {
  const d = parse(iso);
  const m = d.getUTCMonth() + 1;
  const y = d.getUTCFullYear();
  if (m >= 9 && m <= 11) return { name: "Autumn", year: y };
  if (m === 12) return { name: "Winter", year: y };
  if (m <= 2) return { name: "Winter", year: y - 1 };
  if (m <= 5) return { name: "Spring", year: y };
  return { name: "Summer", year: y };
}

/** 1-based Sunday-to-Saturday week number within the year, matching the Rust scope model. */
export function weekNumber(iso: string): number {
  const d = parse(iso);
  const jan1 = utc(d.getUTCFullYear(), 1, 1);
  const jan1Dow = jan1.getUTCDay();
  const ordinal0 = Math.round((d.getTime() - jan1.getTime()) / 86_400_000);
  return Math.floor((ordinal0 + jan1Dow) / 7) + 1;
}

// --- cell enumerators ---

/** The four seasons that begin within `year` (Spring, Summer, Autumn, Winter). */
export function seasonCells(year: number): ScopeCell[] {
  const startMonths = [3, 6, 9, 12];
  return startMonths.map((month) => {
    const startIso = isoDate(utc(year, month, 1));
    const { name } = seasonOf(startIso);
    // Season spans three months; end = last day of the third month.
    const endExclusive = utc(month + 3 > 12 ? year + 1 : year, ((month + 2) % 12) + 1, 1);
    return {
      ref: { kind: "season", date: startIso },
      label: `${name} ${year}`,
      startDate: startIso,
      endDate: isoDate(addDaysDate(endExclusive, -1)),
    };
  });
}

function addDaysDate(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** The twelve months of `year`. */
export function monthCells(year: number): ScopeCell[] {
  return MONTH_NAMES.map((name, index) => {
    const month = index + 1;
    const startIso = isoDate(utc(year, month, 1));
    const endExclusive = utc(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1);
    return {
      ref: { kind: "month", date: startIso },
      label: `${name} ${year}`,
      startDate: startIso,
      endDate: isoDate(addDaysDate(endExclusive, -1)),
    };
  });
}

/** The weeks (Sunday-start) overlapping `year`-`month1`. */
export function weekCells(year: number, month1: number): ScopeCell[] {
  const firstOfMonth = isoDate(utc(year, month1, 1));
  const lastOfMonth = isoDate(addDaysDate(utc(month1 === 12 ? year + 1 : year, month1 === 12 ? 1 : month1 + 1, 1), -1));
  const cells: ScopeCell[] = [];
  let sunday = weekStart(firstOfMonth);
  while (sunday <= lastOfMonth) {
    const saturday = addDays(sunday, 6);
    cells.push({
      ref: { kind: "week", date: sunday },
      label: `Week ${weekNumber(sunday)}`,
      startDate: sunday,
      endDate: saturday,
    });
    sunday = addDays(sunday, 7);
  }
  return cells;
}

/** The seven days of the week containing `iso` (Sunday first). */
export function dayCells(iso: string): ScopeCell[] {
  const sunday = weekStart(iso);
  return Array.from({ length: 7 }, (_unused, offset) => {
    const date = addDays(sunday, offset);
    return {
      ref: { kind: "day", date },
      label: date.slice(8), // day-of-month
      startDate: date,
      endDate: date,
    };
  });
}

/** The six parts of the day `iso`. Night ends on the following day. */
export function partCells(iso: string): ScopeCell[] {
  return PART_SEQUENCE.map((part) => ({
    ref: { kind: "part_of_day", date: iso, part },
    label: PART_LABELS[part],
    startDate: iso,
    endDate: part === "night" ? addDays(iso, 1) : iso,
  }));
}

/** Whether `todayIso` falls within a cell's inclusive date range. */
export function cellContainsDate(cell: ScopeCell, todayIso: string): boolean {
  return cell.startDate <= todayIso && todayIso <= cell.endDate;
}

/**
 * The part of day holding a wall-clock `hour` (0–23), mirroring the Rust `PartOfDay::containing`:
 * Premorning 02–06, Morning 06–12, Noon 12–15, Afternoon 15–18, Evening 18–22, Night 22–02.
 */
export function partContaining(hour: number): PartOfDay {
  if (hour < 2) return "night";
  if (hour < 6) return "premorning";
  if (hour < 12) return "morning";
  if (hour < 15) return "noon";
  if (hour < 18) return "afternoon";
  if (hour < 22) return "evening";
  return "night";
}

/**
 * The part-of-day cell holding the instant `now`. Night runs 22:00–02:00 and belongs to the day it
 * starts on, so between 00:00 and 01:59 the current part is the **previous** date's Night — which
 * is why currency is a property of (instant, date, part), not of the part alone.
 */
export function currentPartRef(now: Date): { date: string; part: PartOfDay } {
  const hour = now.getUTCHours();
  const part = partContaining(hour);
  const date = isoDate(now);
  return hour < 2 ? { date: previousDay(date), part } : { date, part };
}

/**
 * Whether a cell is the period holding `now` — the current-period marker. Every view but
 * part-of-day marks the cell whose dates contain today; a part-of-day cell is current only when it
 * is the one part (on the one date) holding the instant, Night's midnight wrap included.
 */
export function isCellCurrent(cell: ScopeCell, now: Date): boolean {
  if (cell.ref.kind !== "part_of_day") return cellContainsDate(cell, isoDate(now));
  const current = currentPartRef(now);
  return cell.ref.date === current.date && cell.ref.part === current.part;
}

/** Where the picker opens: the view to show, and the date that view is anchored on. */
export interface ScopeOpening {
  kind: ViewKind;
  anchor: string;
}

/**
 * The narrowest view that can display `ref` — the view whose cells are of the ref's own kind —
 * anchored so that the period the ref names is on screen. An Exact window has no view of its own,
 * so it opens on the Day view holding its start.
 */
export function openingForRef(ref: ScopeRef): ScopeOpening {
  if (ref.kind === "exact") return { kind: "day", anchor: ref.start.slice(0, 10) };
  return { kind: ref.kind, anchor: ref.date };
}

/**
 * The narrowest view that can display every ref, anchored on the earliest of them: the endpoints'
 * own view for a same-kind range, the coarser endpoint's view when the kinds differ. Null for an
 * empty list, leaving the caller's default opening in place.
 */
export function openingForRefs(refs: ScopeRef[]): ScopeOpening | null {
  const openings = refs.map(openingForRef);
  if (openings.length === 0) return null;
  return openings.reduce((merged, opening) => ({
    kind: coarserKind(merged.kind, opening.kind),
    anchor: merged.anchor <= opening.anchor ? merged.anchor : opening.anchor,
  }));
}

/**
 * The opening for a persisted window's endpoint scopes (a Time Scope or a Plan). Rows that name no
 * calendar cell are dropped, so a window of only such rows yields null and the caller's default
 * opening stands.
 */
export function openingForScopes(scopes: Scope[]): ScopeOpening | null {
  const refs: ScopeRef[] = [];
  for (const scope of scopes) {
    const ref = refForScope(scope);
    if (ref !== null) refs.push(ref);
  }
  return openingForRefs(refs);
}

/** The cells of a view, given the browsed anchor date. */
export function cellsForView(kind: ViewKind, anchor: string): ScopeCell[] {
  const d = parse(anchor);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  switch (kind) {
    case "season":
      return seasonCells(year);
    case "month":
      return monthCells(year);
    case "week":
      return weekCells(year, month);
    case "day":
      return dayCells(anchor);
    case "part_of_day":
      return partCells(anchor);
  }
}

/** Shifts the browsed anchor one period earlier (`-1`) or later (`1`) for the given view. */
export function browseAnchor(kind: ViewKind, anchor: string, dir: 1 | -1): string {
  const d = parse(anchor);
  switch (kind) {
    case "season":
    case "month":
      d.setUTCFullYear(d.getUTCFullYear() + dir);
      break;
    case "week":
      d.setUTCMonth(d.getUTCMonth() + dir);
      break;
    case "day":
      d.setUTCDate(d.getUTCDate() + 7 * dir);
      break;
    case "part_of_day":
      d.setUTCDate(d.getUTCDate() + dir);
      break;
  }
  return isoDate(d);
}

/**
 * Advances an anchor date by `count` whole scopes of `kind` (a Duration step). Used to snapshot
 * a Duration Time Scope: the end boundary of "N {kind}" from an anchor is `addScopePeriods(kind,
 * anchor, N - 1)`.
 */
export function addScopePeriods(kind: CanonicalKind, iso: string, count: number): string {
  const d = parse(iso);
  switch (kind) {
    case "season":
      d.setUTCMonth(d.getUTCMonth() + 3 * count);
      break;
    case "month":
      d.setUTCMonth(d.getUTCMonth() + count);
      break;
    case "week":
      d.setUTCDate(d.getUTCDate() + 7 * count);
      break;
    case "day":
      d.setUTCDate(d.getUTCDate() + count);
      break;
  }
  return isoDate(d);
}

/** A human label for the currently-browsed period. */
export function viewHeader(kind: ViewKind, anchor: string): string {
  const d = parse(anchor);
  const year = d.getUTCFullYear();
  switch (kind) {
    case "season":
    case "month":
      return String(year);
    case "week":
      return `${MONTH_NAMES[d.getUTCMonth()]} ${year}`;
    case "day":
      return `Week ${weekNumber(weekStart(anchor))}`;
    case "part_of_day":
      return anchor;
  }
}
