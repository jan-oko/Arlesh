import { useEffect, useState } from "react";
import type { MindmapNode } from "@/utils/tree-layout";
import { entityNodeId } from "@/utils/tree-layout";
import { scopeValidFlowTargets } from "@/api/flows";

/**
 * Resolves which of `candidates` a scoped flow may target, given its duration and — when starting —
 * a concrete `anchorDate`. Returns a Set of valid tree node ids (via `entityNodeId`, so it matches
 * `MindmapNode.id` — including `domain-<id>` for domain-table targets), or `null` while unrestricted: an Unscoped flow (`scoped` false) or before the first result
 * arrives. Callers treat `null` as "no filter". Re-queries when the duration or anchor changes.
 */
export function useValidFlowTargets(
  candidates: MindmapNode[],
  scoped: boolean,
  durationN: number | null,
  durationKind: string | null,
  anchorDate: string | null,
): Set<string> | null {
  const [fetched, setFetched] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (!scoped) return; // Unscoped flow imposes no filter — handled by the derived return below.
    let cancelled = false;
    const refs = candidates.map((candidate) => ({
      node_type: candidate.kind,
      node_id: parseInt(candidate.id.split("-").pop() ?? "0", 10),
    }));
    void scopeValidFlowTargets(durationN, durationKind, anchorDate, refs).then((valid) => {
      if (!cancelled) setFetched(new Set(valid.map((ref) => entityNodeId(ref.node_type, ref.node_id))));
    });
    return () => {
      cancelled = true;
    };
  }, [candidates, scoped, durationN, durationKind, anchorDate]);

  return scoped ? fetched : null;
}
