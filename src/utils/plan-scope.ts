// The Plan View's cursor: which scope is being filled, and how walking to the next one works.
// Pure and synchronous — the cursor is a calendar position, and only materializing it (turning it
// into a scope row with an id and a window) touches the backend.

import type { PartOfDay, Scope } from "@/api/scopes";
import type { ScopeRef } from "@/utils/scope-ref";
import type { ViewKind } from "@/utils/scope-calendar";
import { PART_SEQUENCE, addScopePeriods, previousDay } from "@/utils/scope-calendar";

/**
 * The scope kinds a Plan pass may fill. Exact scopes are deliberately absent: an arbitrary
 * `[start, end)` window is not a place on a calendar you can step to the next of, and "fill the
 * next exact scope" has no meaning.
 */
export const PLAN_SCOPE_KINDS: readonly ViewKind[] = ["season", "month", "week", "day", "part_of_day"];

/** Type guard for a stored or selected scope kind. */
export function isPlanScopeKind(value: string): value is ViewKind {
  return PLAN_SCOPE_KINDS.some((kind) => kind === value);
}

/**
 * Where the Plan View is standing: a kind, the day it is anchored at, and a band.
 *
 * `part` is carried even while the kind is a canonical one, so switching week → part → week and
 * back is lossless. The alternative — dropping the band on every kind change — made the selector
 * destructive in one direction only, which is exactly the kind of asymmetry nobody remembers.
 */
export interface PlanScopeCursor {
  kind: ViewKind;
  /** The day the scope is anchored at, ISO `YYYY-MM-DD`; its containing scope is the one filled. */
  date: string;
  part: PartOfDay;
}

const FIRST_PART: PartOfDay = "premorning";

/** The calendar cell a cursor names — what materializes to the scope row being filled. */
export function cursorRef(cursor: PlanScopeCursor): ScopeRef {
  if (cursor.kind === "part_of_day") {
    return { kind: "part_of_day", date: cursor.date, part: cursor.part };
  }
  return { kind: cursor.kind, date: cursor.date };
}

/** Steps one whole scope later (`1`) or earlier (`-1`), rolling the day over at either end of the
 * part sequence so walking parts never stalls on the last band of a day. */
export function stepCursor(cursor: PlanScopeCursor, direction: 1 | -1): PlanScopeCursor {
  if (cursor.kind !== "part_of_day") {
    return { ...cursor, date: addScopePeriods(cursor.kind, cursor.date, direction) };
  }
  const index = PART_SEQUENCE.indexOf(cursor.part) + direction;
  const part = PART_SEQUENCE[(index + PART_SEQUENCE.length) % PART_SEQUENCE.length] ?? FIRST_PART;
  if (index >= 0 && index < PART_SEQUENCE.length) return { ...cursor, part };
  return { ...cursor, part, date: addScopePeriods("day", cursor.date, direction) };
}

/** The cursor a picked calendar cell lands on, or `null` for a cell no Plan pass can fill. */
export function cursorFromRef(ref: ScopeRef, fallbackPart: PartOfDay): PlanScopeCursor | null {
  if (ref.kind === "exact") return null;
  if (ref.kind === "part_of_day") return { kind: "part_of_day", date: ref.date, part: ref.part };
  return { kind: ref.kind, date: ref.date, part: fallbackPart };
}

/**
 * The band a wall-clock hour falls in, mirroring the backend's bands. Hours 00:00–01:59 belong to
 * the **previous** day's Night, which is why {@link cursorAtNow} moves the date back for them.
 */
export function partOfHour(hour: number): PartOfDay {
  const h = ((hour % 24) + 24) % 24;
  if (h < 2) return "night";
  if (h < 6) return "premorning";
  if (h < 12) return "morning";
  if (h < 15) return "noon";
  if (h < 18) return "afternoon";
  if (h < 22) return "evening";
  return "night";
}

/**
 * Where a pass opens: the scope of `kind` that contains *now*.
 *
 * The bead asks for the current **week** on first use; this is that rule generalised, because the
 * kind is remembered and "the week I last filled" would be a stale week by the next morning. The
 * kind persists, the place in the calendar does not.
 */
export function cursorAtNow(kind: ViewKind, todayIso: string, hour: number): PlanScopeCursor {
  const part = partOfHour(hour);
  const date = hour < 2 ? previousDay(todayIso) : todayIso;
  return { kind, date, part };
}

/**
 * Why Up cannot go anywhere: the scope is at the **top** of the ladder (a Season — or an Exact
 * window, which is not on the ladder at all), or it is still **resolving** and its parent is not
 * known yet.
 */
export type UpRefusal = "top" | "resolving";

/** The `planView` string that says an {@link UpRefusal} — one sentence for the tooltip and the key. */
export function upRefusalKey(refusal: UpRefusal): "upScopeAtTop" | "upScopeResolving" {
  return refusal === "top" ? "upScopeAtTop" : "upScopeResolving";
}

/**
 * The calendar cells one rung **above** `scope` that it sits in — its **parent scope**, as the
 * candidates pane asks "planned to the parent scope".
 *
 * Empty for a **Season**, and that is structural rather than defensive: a Season is the one
 * top-level scope, so for it the question has no answer, and nothing else on the ladder is ever
 * without one. (An Exact window is not on the ladder and is never filled, so it has none either.)
 *
 * Asked of the calendar by date rather than read off the row's containment ids, because a **Week**
 * row carries no month: weeks do not nest in months. A week at a month's edge sits in **two** of
 * them, and both are one rung above it, so both are its parent — asking for the month at its first
 * day and at its last gives one cell or two, and the same rule gives exactly one everywhere else.
 */
export function parentRefs(scope: Pick<Scope, "kind" | "start_date" | "end_date">): ScopeRef[] {
  switch (scope.kind) {
    case "part_of_day": return [{ kind: "day", date: scope.start_date }];
    case "day": return [{ kind: "week", date: scope.start_date }];
    case "month": return [{ kind: "season", date: scope.start_date }];
    case "week": {
      const first: ScopeRef = { kind: "month", date: scope.start_date };
      if (scope.start_date.slice(0, 7) === scope.end_date.slice(0, 7)) return [first];
      return [first, { kind: "month", date: scope.end_date }];
    }
    case "season":
    case "exact":
      return [];
  }
}
