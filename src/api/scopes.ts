import { invoke } from "./gesture";
import type { ScopeRef } from "@/utils/scope-ref";

/**
 * A scope's identity: its value key, mirrored from the Rust `scopes::key::ScopeKey`.
 *
 * A JSON object tagged by `kind` that names the scope's own start:
 * `{kind: "week", date: "2026-09-20"}` (its Sunday), `{kind: "part_of_day", date, part}`,
 * `{kind: "exact", start, end}`. It has the shape of a calendar-cell reference in canonical form, so
 * comparing two keys compares their canonical text (`scopeKeyText` in `@/utils/scope-key`), never
 * their object identity. Scopes are derived, not stored (ADR 0009): nothing here writes.
 */
export type ScopeKey =
  | { kind: "season" | "month" | "week" | "day"; date: string }
  | { kind: "part_of_day"; date: string; part: PartOfDay }
  | { kind: "exact"; start: string; end: string };

/** Scope granularity, mirrored from the Rust `ScopeKind` (serde snake_case). */
export type ScopeKind = "season" | "month" | "week" | "day" | "part_of_day" | "exact";

/** Sub-day band, mirrored from the Rust `PartOfDay` (serde lowercase). */
export type PartOfDay =
  | "morning"
  | "noon"
  | "afternoon"
  | "evening"
  | "night"
  | "premorning";

/** A scope with everything derived from its key, mirrored from the Rust `scopes::model::Scope`. */
export interface Scope {
  id: ScopeKey;
  kind: ScopeKind;
  label: string;
  start_date: string;
  end_date: string;
  part: PartOfDay | null;
  start_datetime: string | null;
  end_datetime: string | null;
}

/** A scope resolved to its half-open `[start, end)` datetime window plus current active state. */
export interface ResolvedScope {
  start: string;
  end: string;
  active: boolean;
}

/** The scope a key names, with its label and dates. */
export async function getScope(id: ScopeKey): Promise<Scope> {
  return invoke<Scope>("get_scope", { id });
}

/** The canonical (Season/Month/Week/Day) scope holding a date (`YYYY-MM-DD`). */
export async function scopeContaining(kind: ScopeKind, date: string): Promise<Scope> {
  return invoke<Scope>("scope_containing", { kind, date });
}

/** The Part-of-Day scope for a date (`YYYY-MM-DD`) and band. */
export async function partScope(date: string, part: PartOfDay): Promise<Scope> {
  return invoke<Scope>("part_scope", { date, part });
}

/**
 * The Exact scope for an arbitrary `[start, end)` window. Datetimes are ISO 8601 minute-precision
 * `YYYY-MM-DDTHH:MM:SS`. Nothing is stored until a save references it.
 */
export async function exactScope(start: string, end: string): Promise<Scope> {
  return invoke<Scope>("exact_scope", { start, end });
}

/**
 * The scope a {@link ScopeRef} names, with its label and dates.
 *
 * One door for every caller that turns a *place on the calendar* into a scope: the Plan View's
 * cursor when a pass steps to the next scope, and its subscope buckets when a row is dropped or
 * keyed into one.
 *
 * An Exact window is rejected: it is not a cell, and nothing that calls this is asking for one.
 */
export async function scopeForRef(ref: ScopeRef): Promise<Scope> {
  if (ref.kind === "part_of_day") return partScope(ref.date, ref.part);
  if (ref.kind === "exact") throw new Error("an exact window is not a calendar cell");
  return scopeContaining(ref.kind, ref.date);
}

/** Resolves a scope to its datetime window and whether it is currently active. */
export async function resolveScope(id: ScopeKey): Promise<ResolvedScope> {
  return invoke<ResolvedScope>("resolve_scope", { id });
}
