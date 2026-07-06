// Human display formatting for scopes and scope ranges. Rules:
//  - days render dd/mm/yy;
//  - months/seasons/weeks by localized label, each with a 4-digit year;
//  - a range of the same kind whose endpoints share a year factors the year out as a suffix
//    (e.g. "June-July 2026", "28/06-01/07 2026", "W45-W49 2026").
//
// Localized words come from `ScopeLabelFns` (see use-scope-labels.ts); this stays pure so it can
// be unit-tested with plain label stubs.

import type { Scope } from "@/api/scopes";
import type { ScopeLabelFns } from "@/hooks/use-scope-labels";
import type { CanonicalKind } from "@/utils/scope-ref";
import { seasonOf, weekNumber } from "@/utils/scope-calendar";

function parseDate(iso: string): { day: number; month: number; year: number } {
  const [year, month, day] = iso.split("-").map(Number);
  return { day: day ?? 1, month: month ?? 1, year: year ?? 0 };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ddmm(iso: string): string {
  const { day, month } = parseDate(iso);
  return `${pad2(day)}/${pad2(month)}`;
}

function ddmmyy(iso: string): string {
  return `${ddmm(iso)}/${pad2(parseDate(iso).year % 100)}`;
}

/** The year-less core and the (4-digit) year of a canonical kind/date pair, for the same-year suffix rule. */
function scopeCore(kind: CanonicalKind, date: string, labels: ScopeLabelFns): { core: string; year: number } {
  switch (kind) {
    case "day":
      return { core: ddmm(date), year: parseDate(date).year };
    case "week":
      return { core: labels.week(weekNumber(date)), year: parseDate(date).year };
    case "month":
      return { core: labels.month(parseDate(date).month), year: parseDate(date).year };
    case "season": {
      const season = seasonOf(date);
      return { core: labels.season(season.name), year: season.year };
    }
  }
}

/** Formats a single scope. */
export function formatScope(scope: Scope, labels: ScopeLabelFns): string {
  if (scope.kind === "exact" || scope.kind === "part_of_day") return scope.label;
  if (scope.kind === "day") return ddmmyy(scope.start_date);
  const { core, year } = scopeCore(scope.kind, scope.start_date, labels);
  return `${core} ${year}`;
}

/**
 * Formats a canonical kind/date pair directly, without a materialized `Scope` row — for a calendar
 * cell picked but not yet persisted (e.g. a Habit's Recurrence anchor).
 */
export function formatScopeAnchor(kind: CanonicalKind, date: string, labels: ScopeLabelFns): string {
  if (kind === "day") return ddmmyy(date);
  const { core, year } = scopeCore(kind, date, labels);
  return `${core} ${year}`;
}

/**
 * The year-less core label of a canonical kind/date pair (e.g. "W22") — for a Habit's compact
 * iteration title, `{flow title} {start scope}` (SPEC: "Exercise W22"), where the year is implied.
 */
export function formatScopeCore(kind: CanonicalKind, date: string, labels: ScopeLabelFns): string {
  if (kind === "day") return ddmm(date);
  return scopeCore(kind, date, labels).core;
}

/** Formats a boundaries range (same-kind endpoints), factoring out a shared year as a suffix. */
export function formatScopeRange(start: Scope, end: Scope, labels: ScopeLabelFns): string {
  if (start.id === end.id) return formatScope(start, labels);
  if (start.kind !== end.kind || start.kind === "exact" || start.kind === "part_of_day") {
    return `${formatScope(start, labels)}-${formatScope(end, labels)}`;
  }
  // `start.kind === end.kind` per the guard above; reuse it so both calls narrow the same way.
  const a = scopeCore(start.kind, start.start_date, labels);
  const b = scopeCore(start.kind, end.start_date, labels);
  if (a.year === b.year) return `${a.core}-${b.core} ${a.year}`;
  if (start.kind === "day") return `${ddmmyy(start.start_date)}-${ddmmyy(end.start_date)}`;
  return `${a.core} ${a.year}-${b.core} ${b.year}`;
}
