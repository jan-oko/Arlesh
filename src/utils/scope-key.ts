// A scope's value key, built and read on the client. Scopes are derived, not stored (ADR 0009):
// the key *is* the scope, so turning a calendar cell into an id is a snap to the scope's start
// rather than a round trip. A key's **canonical text** — what a column stores and what equality
// compares — is the Rust `ScopeKey::canonical`'s exactly, and `conformance/scope-keys.json` holds
// both sides to it.

import type { PartOfDay, ScopeKey } from "@/api/scopes";
import { weekStart } from "@/utils/scope-calendar";
import type { CanonicalKind, ScopeRef } from "@/utils/scope-ref";

/** A key's canonical text — how a key is compared, and how a map or set is indexed by scope. */
export type ScopeKeyText = string;

const PARTS: readonly PartOfDay[] = ["premorning", "morning", "noon", "afternoon", "evening", "night"];
const CANONICAL: readonly CanonicalKind[] = ["season", "month", "week", "day"];

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
  if (ref.kind === "part_of_day") return { kind: "part_of_day", date: ref.date, part: ref.part };
  if (ref.kind === "exact") return { kind: "exact", start: ref.start, end: ref.end };
  return { kind: ref.kind, date: canonicalStart(ref.kind, ref.date) };
}

/** The key of the canonical scope of `kind` holding `date`. */
export function keyContaining(kind: CanonicalKind, date: string): ScopeKey {
  return keyForRef({ kind, date });
}

/** The calendar cell a key names — the key itself, since it has a cell's shape. */
export function refForKey(key: ScopeKey): ScopeRef {
  return key;
}

/**
 * The key's canonical text: `kind` first, the fields in their fixed order, no whitespace. What a
 * column stores, and the one way two keys are compared or used to index a map.
 */
export function scopeKeyText(key: ScopeKey): ScopeKeyText {
  if (key.kind === "part_of_day") {
    return JSON.stringify({ kind: key.kind, date: key.date, part: key.part });
  }
  if (key.kind === "exact") return JSON.stringify({ kind: key.kind, start: key.start, end: key.end });
  return JSON.stringify({ kind: key.kind, date: key.date });
}

/** Whether two keys name the same scope. */
export function sameScopeKey(a: ScopeKey, b: ScopeKey): boolean {
  return scopeKeyText(a) === scopeKeyText(b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(record: Record<string, unknown>, field: string, pattern: RegExp): string | null {
  const value = record[field];
  return typeof value === "string" && pattern.test(value) ? value : null;
}

/**
 * The key a JSON value spells, or `null` for anything that is not one. Accepts any field order;
 * {@link scopeKeyText} gives the canonical text back.
 */
export function scopeKeyFrom(value: unknown): ScopeKey | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  const kind = value.kind;
  if (kind === "exact") {
    const start = text(value, "start", ISO_DATETIME);
    const end = text(value, "end", ISO_DATETIME);
    return start === null || end === null ? null : { kind, start, end };
  }
  const date = text(value, "date", ISO_DATE);
  if (date === null) return null;
  if (kind === "part_of_day") {
    const part = PARTS.find((candidate) => candidate === value.part);
    return part === undefined ? null : { kind, date, part };
  }
  const canonical = CANONICAL.find((candidate) => candidate === kind);
  return canonical === undefined ? null : { kind: canonical, date };
}

/** The key a canonical (or any JSON) text spells, or `null`. The inverse of {@link scopeKeyText}. */
export function scopeKeyFromText(raw: string): ScopeKey | null {
  try {
    return scopeKeyFrom(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** The first day a key names, `YYYY-MM-DD` — what a stored boundary reads as in a date field. */
export function keyStartDate(key: ScopeKey): string {
  return key.kind === "exact" ? key.start.slice(0, 10) : key.date;
}
