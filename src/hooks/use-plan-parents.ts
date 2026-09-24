import { useMemo } from "react";
import type { Scope } from "@/api/scopes";
import { parentRefs } from "@/utils/plan-scope";
import { keyForRef, scopeKeyText, type ScopeKeyText } from "@/utils/scope-key";

/** The parent scope(s) of the scope a Plan pass is filling. */
export interface PlanParents {
  /** Whether the scope has a rung above it at all — `false` exactly for a Season. */
  exists: boolean;
  /** The parents' keys, as canonical text; empty until the scope itself is known, and always
   * empty for a Season. */
  ids: ReadonlySet<ScopeKeyText>;
}

/**
 * The parent scope(s) of `scope` — the cells one rung above it (see `parentRefs`), as keys.
 *
 * Derived on the spot: a scope's key is a pure function of the cell (ADR 0009), so the month a
 * week sits in — or the two months a week at a month's edge sits in — is a string, not a lookup
 * or a row that has to exist first.
 */
export function usePlanParents(scope: Scope | null): PlanParents {
  return useMemo(() => {
    const refs = scope === null ? [] : parentRefs(scope);
    return { exists: refs.length > 0, ids: new Set(refs.map((ref) => scopeKeyText(keyForRef(ref)))) };
  }, [scope]);
}
