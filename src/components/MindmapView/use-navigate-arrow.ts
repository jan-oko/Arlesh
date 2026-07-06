import { useCallback, useEffect, useRef } from "react";
import type { MindmapNode, Position } from "@/utils/tree-layout";
import { nearestInDirection, parentAndChildrenIds, siblingIds, computeShiftSelectRange } from "@/utils/mindmap-tree";

type ArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";
type SiblingArrowKey = "ArrowUp" | "ArrowDown";

interface Options {
  selectedNodeId: string | null;
  selectedNodeIds: ReadonlySet<string>;
  positions: Map<string, Position>;
  tree: MindmapNode;
  selectNode: (id: string | null) => void;
  setSelection: (ids: ReadonlySet<string>, anchorId: string) => void;
}

interface Result {
  navigateArrow: (key: ArrowKey) => void;
  /** Shift+Up/Down: extends or shrinks a sibling selection range from a fixed anchor, like shift-click. */
  extendSelection: (key: SiblingArrowKey) => void;
}

export function useNavigateArrow({ selectedNodeId, selectedNodeIds, positions, tree, selectNode, setSelection }: Options): Result {
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

  // The moving end of a shift-arrow selection sequence; the anchor (selectedNodeId) stays fixed.
  // Reset once the selection collapses back to a single node — a fresh anchor for the next sequence.
  const extendFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedNodeIds.size <= 1) extendFocusRef.current = null;
  }, [selectedNodeIds]);

  const extendSelection = useCallback(
    (key: SiblingArrowKey) => {
      if (selectedNodeId === null) return;
      const siblings = siblingIds(tree, selectedNodeId);
      const focus = extendFocusRef.current ?? selectedNodeId;
      const target = nearestInDirection(focus, positions, key, siblings);
      if (target === undefined) return;
      const range = computeShiftSelectRange(tree, selectedNodeId, target);
      if (range === null) return;
      extendFocusRef.current = target;
      setSelection(new Set(range), selectedNodeId);
    },
    [selectedNodeId, tree, positions, setSelection],
  );

  return { navigateArrow, extendSelection };
}
