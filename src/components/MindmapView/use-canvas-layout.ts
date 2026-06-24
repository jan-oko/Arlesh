import { useMemo } from "react";
import type { MindmapNode, Position } from "@/utils/tree-layout";
import { computeLayout, computeSubtreeLayout, HORIZONTAL_GAP, VERTICAL_GAP } from "@/utils/tree-layout";
import { findNode } from "@/utils/mindmap-tree";

interface Options {
  displayRoot: MindmapNode;
  tree: MindmapNode;
  collapsedNodeIds: ReadonlySet<string>;
  dragSourceId: string | null;
  dragTargetId: string | null;
}

interface Result {
  effectiveCollapsedIds: ReadonlySet<string>;
  positions: Map<string, Position>;
  subtreeLayout: Map<string, Position> | null;
  placeholderPos: Position | null;
}

export function useCanvasLayout({ displayRoot, tree, collapsedNodeIds, dragSourceId, dragTargetId }: Options): Result {
  const effectiveCollapsedIds = useMemo<ReadonlySet<string>>(() => {
    if (dragSourceId === null) return collapsedNodeIds;
    const s = new Set(collapsedNodeIds);
    s.add(dragSourceId);
    return s;
  }, [collapsedNodeIds, dragSourceId]);

  const positions = useMemo(
    () => computeLayout(displayRoot, effectiveCollapsedIds),
    [displayRoot, effectiveCollapsedIds],
  );

  const subtreeLayout = useMemo(() => {
    if (dragSourceId === null || dragTargetId === null) return null;
    const sourceNode = findNode(tree, dragSourceId);
    if (sourceNode === undefined || sourceNode.children.length === 0) return null;
    const targetPos = positions.get(dragTargetId);
    const direction: 1 | -1 = (targetPos?.x ?? 0) >= 0 ? 1 : -1;
    return computeSubtreeLayout(sourceNode, collapsedNodeIds, direction);
  }, [dragSourceId, dragTargetId, tree, collapsedNodeIds, positions]);

  const placeholderPos = useMemo<Position | null>(() => {
    if (dragTargetId === null || dragSourceId === null) return null;
    const targetPos = positions.get(dragTargetId);
    if (targetPos === undefined) return null;
    const direction: 1 | -1 = targetPos.x >= 0 ? 1 : -1;
    const childX = targetPos.x + direction * HORIZONTAL_GAP;
    const childDepth = targetPos.depth + 1;
    const targetNode = findNode(tree, dragTargetId);
    if (targetNode === undefined) return { x: childX, y: targetPos.y, depth: childDepth };
    const visibleChildren = targetNode.children.filter(
      (c) => !collapsedNodeIds.has(c.id) && c.id !== dragSourceId,
    );
    if (visibleChildren.length === 0) return { x: childX, y: targetPos.y, depth: childDepth };
    const yValues = visibleChildren
      .map((c) => positions.get(c.id)?.y)
      .filter((v): v is number => v !== undefined);
    const bottomY = yValues.length > 0 ? Math.max(...yValues) : targetPos.y;
    let topSpread = 0;
    if (subtreeLayout !== null) {
      for (const p of subtreeLayout.values()) {
        if (p.y < 0) topSpread = Math.max(topSpread, -p.y);
      }
    }
    return { x: childX, y: bottomY + VERTICAL_GAP + topSpread, depth: childDepth };
  }, [dragTargetId, dragSourceId, positions, collapsedNodeIds, subtreeLayout, tree]);

  return { effectiveCollapsedIds, positions, subtreeLayout, placeholderPos };
}
