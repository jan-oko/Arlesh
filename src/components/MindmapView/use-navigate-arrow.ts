import { useCallback } from "react";
import type { MindmapNode, Position } from "@/utils/tree-layout";
import { nearestInDirection, connectedNodeIds } from "@/utils/mindmap-tree";

type ArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

interface Options {
  selectedNodeId: string | null;
  positions: Map<string, Position>;
  tree: MindmapNode;
  selectNode: (id: string | null) => void;
}

interface Result {
  navigateArrow: (key: ArrowKey) => void;
}

export function useNavigateArrow({ selectedNodeId, positions, tree, selectNode }: Options): Result {
  const navigateArrow = useCallback(
    (key: ArrowKey) => {
      if (selectedNodeId === null) return;
      const candidates = connectedNodeIds(tree, selectedNodeId);
      const target = nearestInDirection(selectedNodeId, positions, key, candidates);
      if (target !== undefined) selectNode(target);
    },
    [selectedNodeId, positions, tree, selectNode],
  );

  return { navigateArrow };
}
