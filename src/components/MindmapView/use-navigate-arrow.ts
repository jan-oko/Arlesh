import { useCallback, useEffect, useRef } from "react";
import type { MindmapNode, Orientation, Position } from "@/utils/tree-layout";
import { nearestInDirection, parentAndChildrenIds, siblingIds, computeShiftSelectRange } from "@/utils/mindmap-tree";

type ArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

/** Whether `key` points along the branch (parent↔child) axis rather than the sibling axis. */
function isBranchAxisKey(key: ArrowKey, orientation: Orientation): boolean {
  return orientation === "vertical"
    ? key === "ArrowUp" || key === "ArrowDown"
    : key === "ArrowLeft" || key === "ArrowRight";
}

interface Options {
  selectedNodeId: string | null;
  selectedNodeIds: ReadonlySet<string>;
  positions: Map<string, Position>;
  /**
   * The tree `positions` was laid out from — **the drawn one**, not the loaded one.
   *
   * Movement is "go to my parent, my child or my sibling", so the candidates have to be read off
   * the same tree the canvas drew, or a node the drawing invented has no relatives and a node it
   * dropped is offered as one. The folded Habit-history nodes are exactly that invention: they
   * exist only in the display tree, so reading candidates from the loaded tree left them
   * unreachable — and left everything inside an opened run unable to get back out.
   */
  displayRoot: MindmapNode;
  orientation: Orientation;
  selectNode: (id: string | null) => void;
  setSelection: (ids: ReadonlySet<string>, anchorId: string) => void;
}

interface Result {
  navigateArrow: (key: ArrowKey) => void;
  /** Shift+arrow along the sibling axis: extends or shrinks a range from a fixed anchor, like shift-click. */
  extendSelection: (key: ArrowKey) => void;
}

export function useNavigateArrow({ selectedNodeId, selectedNodeIds, positions, displayRoot, orientation, selectNode, setSelection }: Options): Result {
  const navigateArrow = useCallback(
    (key: ArrowKey) => {
      if (selectedNodeId === null) return;
      // Along the branch axis: move among parent and children (whichever lies in that screen
      // direction). Along the sibling axis: move among siblings only.
      const candidates = isBranchAxisKey(key, orientation)
        ? parentAndChildrenIds(displayRoot, selectedNodeId)
        : siblingIds(displayRoot, selectedNodeId);
      const target = nearestInDirection(selectedNodeId, positions, key, candidates);
      if (target !== undefined) selectNode(target);
    },
    [selectedNodeId, positions, displayRoot, orientation, selectNode],
  );

  // The moving end of a shift-arrow selection sequence; the anchor (selectedNodeId) stays fixed.
  // Reset once the selection collapses back to a single node — a fresh anchor for the next sequence.
  const extendFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedNodeIds.size <= 1) extendFocusRef.current = null;
  }, [selectedNodeIds]);

  const extendSelection = useCallback(
    (key: ArrowKey) => {
      if (selectedNodeId === null) return;
      const siblings = siblingIds(displayRoot, selectedNodeId);
      const focus = extendFocusRef.current ?? selectedNodeId;
      const target = nearestInDirection(focus, positions, key, siblings);
      if (target === undefined) return;
      const range = computeShiftSelectRange(displayRoot, selectedNodeId, target);
      if (range === null) return;
      extendFocusRef.current = target;
      setSelection(new Set(range), selectedNodeId);
    },
    [selectedNodeId, displayRoot, positions, setSelection],
  );

  return { navigateArrow, extendSelection };
}
