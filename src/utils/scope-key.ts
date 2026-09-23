// A scope's value key, built and read on the client. Scopes are derived, not stored (ADR 0009):
// the key *is* the scope, so turning a calendar cell into an id, or an id back into a cell, is a
// string operation rather than a round trip. The spelling is the Rust `scopes::key::ScopeKey`'s,
// and `conformance/scope-keys.json` holds both sides to it.

import type { PartOfDay, ScopeKey } from "@/api/scopes";
import { weekStart } from "@/utils/scope-calendar";
import type { CanonicalKind, ScopeRef } from "@/utils/scope-ref";

const PARTS: readonly PartOfDay[] = ["premorning", "morning", "noon", "afternoon", "evening", "night"];
const CANONICAL: readonly CanonicalKind[] = ["season", "month", "week", "day"];

function isPart(value: string): value is PartOfDay {
  return PARTS.some((part) => part === value);
}

function isCanonical(value: string): value is CanonicalKind {
  return CANONICAL.some((kind) => kind === value);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/** The first day of the canonical scope of `kind` that holds `date` (`YYYY-MM-DD`). */
export function canonicalStart(kind: CanonicalKind, date: string): string {
  switch (kind) {
    case "day":
      return date;
    case "week":
      return weekStart(date);
    case "month":
      return `${date.slice(0, 7)}-01`;
    case "season": {
      // Seasons start in December, March, June and September; January and February belong to
      // the Winter that began the December before.
      const year = Number(date.slice(0, 4));
      const month = Number(date.slice(5, 7));
      if (month === 12) return `${year}-12-01`;
      if (month <= 2) return `${year - 1}-12-01`;
      const first = month - ((month - 3) % 3);
      return `${year}-${String(first).padStart(2, "0")}-01`;
    }
  }
}

/** The key of the scope a calendar cell names. A canonical cell snaps to its scope's start. */
export function keyForRef(ref: ScopeRef): ScopeKey {
  if (ref.kind === "part_of_day") return `part_of_day:${ref.date}:${ref.part}`;
  if (ref.kind === "exact") return `exact:${ref.start}/${ref.end}`;
  return `${ref.kind}:${canonicalStart(ref.kind, ref.date)}`;
}

/** The key of the canonical scope of `kind` holding `date`. */
export function keyContaining(kind: CanonicalKind, date: string): ScopeKey {
  return keyForRef({ kind, date });
}

/**
 * The calendar cell a key names, or `null` for a string that is not a key. The inverse of
 * {@link keyForRef} on every key it can produce.
 */
export function refForKey(key: ScopeKey): ScopeRef | null {
  const colon = key.indexOf(":");
  if (colon < 0) return null;
  const kind = key.slice(0, colon);
  const rest = key.slice(colon + 1);
  if (kind === "part_of_day") {
    const [date, part] = rest.split(":");
    if (date === undefined || part === undefined || !ISO_DATE.test(date) || !isPart(part)) return null;
    return { kind: "part_of_day", date, part };
  }
  if (kind === "exact") {
    const [start, end] = rest.split("/");
    if (start === undefined || end === undefined) return null;
    if (!ISO_DATETIME.test(start) || !ISO_DATETIME.test(end)) return null;
    return { kind: "exact", start, end };
  }
  if (!isCanonical(kind) || !ISO_DATE.test(rest)) return null;
  return { kind, date: rest };
}

/**
 * The first day a key names, `YYYY-MM-DD` — what a stored boundary reads as in a date field — or
 * `null` for a string that is not a key.
 */
export function keyStartDate(key: ScopeKey): string | null {
  const ref = refForKey(key);
  if (ref === null) return null;
  return ref.kind === "exact" ? ref.start.slice(0, 10) : ref.date;
}
