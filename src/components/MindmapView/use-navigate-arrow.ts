import { useCallback } from "react";
import type { MindmapNode, Position } from "@/utils/tree-layout";
import { nearestInDirection, parentAndChildrenIds, siblingIds } from "@/utils/mindmap-tree";

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
      // Left/Right: move among parent and children (whichever lies in that screen direction).
      // Up/Down: move among siblings only.
      const candidates =
        key === "ArrowLeft" || key === "ArrowRight"
          ? parentAndChildrenIds(tree, selectedNodeId)
          : siblingIds(tree, selectedNodeId);
      const target = nearestInDirection(selectedNodeId, positions, key, candidates);
      if (target !== undefined) selectNode(target);
    },
    [selectedNodeId, positions, tree, selectNode],
  );

  return { navigateArrow };
}
