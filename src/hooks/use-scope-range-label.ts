import { useEffect, useState } from "react";
import { getScope } from "@/api/scopes";
import type { Scope } from "@/api/scopes";
import type { TimeScope } from "@/api/time-scope";
import { useScopeLabels } from "@/hooks/use-scope-labels";
import { formatScopeRange } from "@/utils/scope-format";

// Scopes are immutable once created, so a resolved id can be cached across every node that
// references it — the mindmap has many nodes but few distinct scopes.
const scopeCache = new Map<number, Promise<Scope>>();

function cachedGetScope(id: number): Promise<Scope> {
  const hit = scopeCache.get(id);
  if (hit !== undefined) return hit;
  const pending = getScope(id);
  scopeCache.set(id, pending);
  return pending;
}

/**
 * Resolves a Time Scope / Plan window to its human-readable label. Returns `null` while unset or
 * still loading. A duration-tagged window formats synchronously; a boundaries window fetches its
 * endpoint scopes (cached) and formats them.
 */
export function useScopeRangeLabel(scope: TimeScope | null | undefined): string | null {
  const labels = useScopeLabels();
  // Only the async (boundaries) case needs state; unset and duration windows derive in render.
  const [fetched, setFetched] = useState<string | null>(null);

  useEffect(() => {
    if (scope == null || scope.duration) return;
    let active = true;
    void Promise.all([cachedGetScope(scope.start_id), cachedGetScope(scope.end_id)]).then(
      ([start, end]) => {
        if (active) setFetched(formatScopeRange(start, end, labels));
      },
    );
    return () => {
      active = false;
    };
  }, [scope, labels]);

  if (scope == null) return null;
  if (scope.duration) return labels.duration(scope.duration.n, scope.duration.kind);
  return fetched;
}
