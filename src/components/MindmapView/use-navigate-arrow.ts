import { useCallback } from "react";
import type { Position } from "@/utils/tree-layout";
import { nearestInDirection } from "@/utils/mindmap-tree";

type ArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

interface Options {
  selectedNodeId: string | null;
  positions: Map<string, Position>;
  selectNode: (id: string | null) => void;
}

interface Result {
  navigateArrow: (key: ArrowKey) => void;
}

export function useNavigateArrow({ selectedNodeId, positions, selectNode }: Options): Result {
  const navigateArrow = useCallback(
    (key: ArrowKey) => {
      if (selectedNodeId === null) return;
      const target = nearestInDirection(selectedNodeId, positions, key);
      if (target !== undefined) selectNode(target);
    },
    [selectedNodeId, positions, selectNode],
  );

  return { navigateArrow };
}
