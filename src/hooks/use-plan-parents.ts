import { useMemo } from "react";
import type { Scope, ScopeKey } from "@/api/scopes";
import { parentRefs } from "@/utils/plan-scope";
import type { ScopeRef } from "@/utils/scope-ref";
import { keyForRef, scopeKeyText, type ScopeKeyText } from "@/utils/scope-key";

/** The parent scope of the scope a Plan pass is filling. */
export interface PlanParents {
  /** Whether the scope has a rung above it at all — `false` exactly for a Season. */
  exists: boolean;
  /** The parents' keys, as canonical text; empty until the scope itself is known, and always
   * empty for a Season. */
  ids: ReadonlySet<ScopeKeyText>;
  /** The parent as a calendar cell and as a key — what taking work out of an unsplit scope plans
   * it to. `null` for a Season, and until the scope itself is known. */
  parent: { ref: ScopeRef; key: ScopeKey } | null;
}

/**
 * The parent scope of `scope` — the cell one rung above it (see `parentRefs`), as keys.
 *
 * Derived on the spot: a scope's key is a pure function of the cell (ADR 0009), so the month a
 * week sits in — for a week at a month's edge, the month holding its first day — is a string, not
 * a lookup or a row that has to exist first.
 */
export function usePlanParents(scope: Scope | null): PlanParents {
  return useMemo(() => {
    const refs = scope === null ? [] : parentRefs(scope);
    const first = refs[0];
    return {
      exists: refs.length > 0,
      ids: new Set(refs.map((ref) => scopeKeyText(keyForRef(ref)))),
      parent: first === undefined ? null : { ref: first, key: keyForRef(first) },
    };
  }, [scope]);
}
