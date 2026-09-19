import { invoke } from "./gesture";

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

/** Resolves a scope to its datetime window and whether it is currently active. */
export async function resolveScope(id: number): Promise<ResolvedScope> {
  return invoke<ResolvedScope>("resolve_scope", { id });
}
