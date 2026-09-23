import type { ScopeKey } from "@/api/scopes";
import { addScopePeriods } from "@/utils/scope-calendar";

/**
 * A distinct, valid scope key per integer — a Day `n` days after 2000-01-01 — for tests that only
 * need scope ids as opaque tokens, which is what a numeric scope id used to be. Keys sort in the
 * order of their integers.
 */
export function testKey(n: number): ScopeKey {
  return `day:${addScopePeriods("day", "2000-01-01", n)}`;
}
