// Human display formatting for scopes and scope ranges. Rules:
//  - days render dd/mm/yy;
//  - months/seasons by name, weeks as "W{n}", each with a 4-digit year;
//  - a range of the same kind whose endpoints share a year factors the year out as a suffix
//    (e.g. "June-July 2026", "28/06-01/07 2026", "W45-W49 2026").

import type { Scope } from "@/api/scopes";
import { seasonOf, weekNumber } from "@/utils/scope-calendar";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

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
  const { year } = parseDate(iso);
  return `${ddmm(iso)}/${pad2(year % 100)}`;
}

/** The year-less core and the (4-digit) year of a canonical scope, for the same-year suffix rule. */
function scopeCore(scope: Scope): { core: string; year: number } {
  switch (scope.kind) {
    case "day":
      return { core: ddmm(scope.start_date), year: parseDate(scope.start_date).year };
    case "week":
      return { core: `W${weekNumber(scope.start_date)}`, year: parseDate(scope.start_date).year };
    case "month":
      return { core: MONTHS[parseDate(scope.start_date).month - 1] ?? "", year: parseDate(scope.start_date).year };
    case "season": {
      const season = seasonOf(scope.start_date);
      return { core: season.name, year: season.year };
    }
    default:
      return { core: scope.label, year: 0 };
  }
}

/** Formats a single scope. */
export function formatScope(scope: Scope): string {
  if (scope.kind === "exact") return scope.label;
  if (scope.kind === "part_of_day") return scope.label;
  if (scope.kind === "day") return ddmmyy(scope.start_date);
  const { core, year } = scopeCore(scope);
  return `${core} ${year}`;
}

/** Formats a boundaries range (same-kind endpoints), factoring out a shared year as a suffix. */
export function formatScopeRange(start: Scope, end: Scope): string {
  if (start.id === end.id) return formatScope(start);
  if (start.kind !== end.kind || start.kind === "exact" || start.kind === "part_of_day") {
    return `${formatScope(start)}-${formatScope(end)}`;
  }
  const a = scopeCore(start);
  const b = scopeCore(end);
  if (a.year === b.year) return `${a.core}-${b.core} ${a.year}`;
  if (start.kind === "day") return `${ddmmyy(start.start_date)}-${ddmmyy(end.start_date)}`;
  return `${a.core} ${a.year}-${b.core} ${b.year}`;
}
