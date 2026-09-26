// A scope's window, derived on the client from its key. Scopes are derived, not stored (ADR 0009),
// so a key's window is a pure function of the key — the Rust `ScopeKey::bounds` — and this is its
// mirror. `conformance/scope-keys.json` holds both sides to the same windows.
//
// It exists for the filter, which runs synchronously on every render and cannot put a round trip
// in front of each node. Anything that can wait for `resolve_scope` should keep asking it.

import type { PartOfDay, ScopeKey } from "@/api/scopes";
import type { TimeScope } from "@/api/time-scope";
import type { ScopeInterval } from "@/utils/scope-interval";
import { addScopePeriods, dayStartInstant } from "@/utils/scope-calendar";
import { canonicalStart } from "@/utils/scope-key";

/** Each band's `[start, end)` wall-clock hours — the Rust `PartOfDay::band`. Night wraps past
 * midnight, and ends on the following date. */
const BANDS: Readonly<Record<PartOfDay, readonly [number, number]>> = {
  premorning: [2, 6],
  morning: [6, 12],
  noon: [12, 15],
  afternoon: [15, 18],
  evening: [18, 22],
  night: [22, 2],
};

function atHour(date: string, hour: number): string {
  return `${date}T${String(hour).padStart(2, "0")}:00:00`;
}

function nextDate(date: string): string {
  return addScopePeriods("day", date, 1);
}

/**
 * The half-open `[start, end)` window the scope `key` names, as local wall-clock datetimes.
 *
 * A Season, Month, Week or Day runs from 02:00 on its first day to 02:00 after its last (the whole
 * ladder turns over at the day boundary); a Part of Day is its band on its date, Night ending at
 * 02:00 the next morning; an Exact scope is its own two datetimes.
 */
export function keyWindow(key: ScopeKey): ScopeInterval {
  switch (key.kind) {
    case "exact":
      return { start: key.start, end: key.end };
    case "part_of_day": {
      const [from, to] = BANDS[key.part];
      return { start: atHour(key.date, from), end: atHour(from < to ? key.date : nextDate(key.date), to) };
    }
    default: {
      const first = canonicalStart(key.kind, key.date);
      return { start: dayStartInstant(first), end: dayStartInstant(addScopePeriods(key.kind, first, 1)) };
    }
  }
}

/** A Time Scope's combined window: the start of its start boundary through the end of its end
 * boundary — the Rust `TimeScope::window`. */
export function timeScopeWindowOf(scope: TimeScope): ScopeInterval {
  return { start: keyWindow(scope.start_id).start, end: keyWindow(scope.end_id).end };
}
