import { useMemo } from "react";
import type { MindmapNode, Orientation, Position } from "@/utils/tree-layout";
import { computeLayout, computeSubtreeLayout, HORIZONTAL_GAP, VERTICAL_GAP } from "@/utils/tree-layout";
import { findNode } from "@/utils/mindmap-tree";
import { measureMindmapNode } from "@/utils/node-extent";

/**
 * The two layout axes named by their role rather than by screen direction: `branch` runs from a
 * parent to its children, `cross` is the one siblings spread along. The orientation decides which
 * of x/y plays each role, letting the drop-placeholder maths be written once.
 */
interface Axes {
  branchOf: (position: Position) => number;
  crossOf: (position: Position) => number;
  branchGap: number;
  crossGap: number;
  positionAt: (branch: number, cross: number, depth: number) => Position;
}

function axesFor(orientation: Orientation): Axes {
  if (orientation === "vertical") {
    return {
      branchOf: (p) => p.y,
      crossOf: (p) => p.x,
      branchGap: VERTICAL_GAP,
      crossGap: HORIZONTAL_GAP,
      positionAt: (branch, cross, depth) => ({ x: cross, y: branch, depth }),
    };
  }
  return {
    branchOf: (p) => p.x,
    crossOf: (p) => p.y,
    branchGap: HORIZONTAL_GAP,
    crossGap: VERTICAL_GAP,
    positionAt: (branch, cross, depth) => ({ x: branch, y: cross, depth }),
  };
}

interface Options {
  displayRoot: MindmapNode;
  tree: MindmapNode;
  collapsedNodeIds: ReadonlySet<string>;
  dragSourceId: string | null;
  dragTargetId: string | null;
  orientation: Orientation;
}

interface Result {
  effectiveCollapsedIds: ReadonlySet<string>;
  positions: Map<string, Position>;
  subtreeLayout: Map<string, Position> | null;
  placeholderPos: Position | null;
}

export function useCanvasLayout({ displayRoot, tree, collapsedNodeIds, dragSourceId, dragTargetId, orientation }: Options): Result {
  const axes = useMemo(() => axesFor(orientation), [orientation]);

  const effectiveCollapsedIds = useMemo<ReadonlySet<string>>(() => {
    if (dragSourceId === null) return collapsedNodeIds;
    const s = new Set(collapsedNodeIds);
    s.add(dragSourceId);
    return s;
  }, [collapsedNodeIds, dragSourceId]);

  const positions = useMemo(
    () => computeLayout(displayRoot, effectiveCollapsedIds, orientation, measureMindmapNode),
    [displayRoot, effectiveCollapsedIds, orientation],
  );

  const subtreeLayout = useMemo(() => {
    if (dragSourceId === null || dragTargetId === null) return null;
    const sourceNode = findNode(tree, dragSourceId);
    if (sourceNode === undefined || sourceNode.children.length === 0) return null;
    const targetPos = positions.get(dragTargetId);
    const direction: 1 | -1 = (targetPos === undefined ? 0 : axes.branchOf(targetPos)) >= 0 ? 1 : -1;
    return computeSubtreeLayout(sourceNode, collapsedNodeIds, direction, orientation, measureMindmapNode);
  }, [dragSourceId, dragTargetId, tree, collapsedNodeIds, positions, orientation, axes]);

  // The placeholder sits one level out from the target, past its last visible child on the cross
  // axis, with room for however far the dragged subtree spreads back towards that child.
  const placeholderPos = useMemo<Position | null>(() => {
    if (dragTargetId === null || dragSourceId === null) return null;
    const targetPos = positions.get(dragTargetId);
    if (targetPos === undefined) return null;
    const direction: 1 | -1 = axes.branchOf(targetPos) >= 0 ? 1 : -1;
    const childBranch = axes.branchOf(targetPos) + direction * axes.branchGap;
    const childDepth = targetPos.depth + 1;
    const alignedWithTarget = axes.positionAt(childBranch, axes.crossOf(targetPos), childDepth);

    const targetNode = findNode(tree, dragTargetId);
    if (targetNode === undefined) return alignedWithTarget;
    const visibleChildren = targetNode.children.filter(
      (c) => !collapsedNodeIds.has(c.id) && c.id !== dragSourceId,
    );
    if (visibleChildren.length === 0) return alignedWithTarget;

    const childCrossValues = visibleChildren
      .map((c) => {
        const p = positions.get(c.id);
        return p === undefined ? undefined : axes.crossOf(p);
      })
      .filter((v): v is number => v !== undefined);
    const lastChildCross = childCrossValues.length > 0 ? Math.max(...childCrossValues) : axes.crossOf(targetPos);

    let backSpread = 0;
    if (subtreeLayout !== null) {
      for (const p of subtreeLayout.values()) {
        const cross = axes.crossOf(p);
        if (cross < 0) backSpread = Math.max(backSpread, -cross);
      }
    }
    return axes.positionAt(childBranch, lastChildCross + axes.crossGap + backSpread, childDepth);
  }, [dragTargetId, dragSourceId, positions, collapsedNodeIds, subtreeLayout, tree, axes]);

  return { effectiveCollapsedIds, positions, subtreeLayout, placeholderPos };
}
