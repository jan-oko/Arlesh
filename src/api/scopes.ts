import { invoke } from "./gesture";
import type { ScopeRef } from "@/utils/scope-ref";

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

/** A scope row, mirrored from the Rust `scopes::model::Scope`. */
export interface Scope {
  id: number;
  kind: ScopeKind;
  label: string;
  start_date: string;
  end_date: string;
  week_id: number | null;
  month_id: number | null;
  season_id: number | null;
  day_id: number | null;
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

/** Fetches a scope by id. */
export async function getScope(id: number): Promise<Scope> {
  return invoke<Scope>("get_scope", { id });
}

/** Gets or creates a canonical (Season/Month/Week/Day) scope for a date (`YYYY-MM-DD`). */
export async function getOrCreateScope(kind: ScopeKind, date: string): Promise<Scope> {
  return invoke<Scope>("get_or_create_scope", { kind, date });
}

/** Gets or creates the Part-of-Day scope for a date (`YYYY-MM-DD`) and band. */
export async function getOrCreatePartScope(date: string, part: PartOfDay): Promise<Scope> {
  return invoke<Scope>("get_or_create_part_scope", { date, part });
}

/**
 * Gets or creates the Exact scope for an arbitrary `[start, end)` window.
 * Datetimes are ISO 8601 minute-precision `YYYY-MM-DDTHH:MM:SS`.
 */
export async function getOrCreateExactScope(start: string, end: string): Promise<Scope> {
  return invoke<Scope>("get_or_create_exact_scope", { start, end });
}

/**
 * Materializes the calendar cell a {@link ScopeRef} names, creating the row if it does not exist.
 *
 * One door for every caller that turns a *place on the calendar* into a scope with an id: the Plan
 * View's cursor when a pass steps to the next scope, and its subscope buckets when a row is dropped
 * or keyed into one. Two spellings of get-or-create would eventually disagree about which cell a
 * ref names, which is the one thing a plan must not be wrong about.
 *
 * An Exact window is rejected rather than created: it is not a cell, and nothing that calls this is
 * asking for one.
 */
export async function getOrCreateForRef(ref: ScopeRef): Promise<Scope> {
  if (ref.kind === "part_of_day") return getOrCreatePartScope(ref.date, ref.part);
  if (ref.kind === "exact") throw new Error("an exact window is not a calendar cell");
  return getOrCreateScope(ref.kind, ref.date);
}

/** Resolves a scope to its datetime window and whether it is currently active. */
export async function resolveScope(id: number): Promise<ResolvedScope> {
  return invoke<ResolvedScope>("resolve_scope", { id });
}
