import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { MindmapNode } from "@/utils/tree-layout";

vi.mock("@/api/flows", () => ({ scopeValidFlowTargets: vi.fn() }));

import { scopeValidFlowTargets } from "@/api/flows";
import { useValidFlowTargets } from "./use-valid-flow-targets";
import { fixtureRowId } from "@/test/node-fixture";

function node(id: string, kind: MindmapNode["kind"]): MindmapNode {
  return { id, ...fixtureRowId(id), kind, title: id, status: "active", position: 0, tagIds: [], children: [] };
}

// Aspect/project/domain/tag nodes are keyed `domain-<id>` in the tree, though their kind is the subtype.
const CANDIDATES = [node("goal-7", "goal"), node("domain-1", "aspect")];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useValidFlowTargets", () => {
  it("returns null without querying for an unscoped flow", () => {
    const { result } = renderHook(() => useValidFlowTargets(CANDIDATES, false, null, null, null));
    expect(result.current).toBeNull();
    expect(scopeValidFlowTargets).not.toHaveBeenCalled();
  });

  it("queries with mapped refs and returns the valid id set for a scoped flow", async () => {
    vi.mocked(scopeValidFlowTargets).mockResolvedValue([{ node_type: "aspect", node_id: 1 }]);
    const { result } = renderHook(() =>
      useValidFlowTargets(CANDIDATES, true, 2, "week", "2026-07-01"),
    );
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(scopeValidFlowTargets).toHaveBeenCalledWith(2, "week", "2026-07-01", [
      { node_type: "goal", node_id: 7 },
      { node_type: "aspect", node_id: 1 },
    ]);
    // The set is keyed by tree node id, so a domain-table target resolves as `domain-<id>` and the
    // consumers' `validIds.has(node.id)` check matches (the previous `aspect-1` key never did).
    expect(result.current?.has("domain-1")).toBe(true);
    expect(result.current?.has("goal-7")).toBe(false);
  });
});
