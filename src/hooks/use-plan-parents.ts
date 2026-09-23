import { useEffect, useMemo, useState } from "react";
import { getOrCreateForRef } from "@/api/scopes";
import type { Scope } from "@/api/scopes";
import { parentRefs } from "@/utils/plan-scope";

/** The parent scope(s) of the scope a Plan pass is filling. */
export interface PlanParents {
  /**
   * Whether the scope has a rung above it at all. Known from its kind alone, before anything is
   * materialized — `false` exactly for a Season.
   */
  exists: boolean;
  /** The parents' ids, once materialized; empty until then, and always empty for a Season. */
  ids: ReadonlySet<number>;
}

const NONE: ReadonlySet<number> = new Set();

/**
 * Materializes the parent scope(s) of `scope` — the cells one rung above it (see `parentRefs`).
 *
 * Get-or-create rather than a lookup, because nothing guarantees a month has a row yet merely
 * because one of its weeks does, and the same door the cursor itself goes through.
 *
 * A failure leaves the ids empty: the candidates pane then shows no parent-planned work, which
 * under-reports rather than misplaces, and the scope itself — the thing the pass is about — is
 * unaffected.
 */
export function usePlanParents(scope: Scope | null): PlanParents {
  const refs = useMemo(() => (scope === null ? [] : parentRefs(scope)), [scope]);
  const [answer, setAnswer] = useState<{ scope: Scope; ids: ReadonlySet<number> } | null>(null);

  useEffect(() => {
    if (scope === null || refs.length === 0) return;
    let active = true;
    void Promise.all(refs.map((ref) => getOrCreateForRef(ref))).then(
      (parents) => {
        if (active) setAnswer({ scope, ids: new Set(parents.map((parent) => parent.id)) });
      },
      () => {
        if (active) setAnswer({ scope, ids: NONE });
      },
    );
    return () => {
      active = false;
    };
  }, [scope, refs]);

  const ids = answer !== null && answer.scope === scope ? answer.ids : NONE;
  return { exists: refs.length > 0, ids };
}
