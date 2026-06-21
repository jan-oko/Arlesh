import { hierarchy, tree } from "d3-hierarchy";

export type NodeKind = "aspect" | "project" | "domain" | "goal" | "task";

export interface MindmapNode {
  id: string;
  kind: NodeKind;
  title: string;
  status?: string;
  color?: string;
  tagIds: number[];
  children: MindmapNode[];
}

export interface Position {
  x: number;
  y: number;
}

const HORIZONTAL_GAP = 180;
const VERTICAL_GAP = 48;

/**
 * Computes pixel positions for every visible node in a left-right balanced mind map.
 *
 * The root sits at (0, 0). The first ⌈n/2⌉ children of root go right (positive x);
 * the remainder go left (negative x). Deeper descendants follow their side.
 */
export function computeLayout(
  root: MindmapNode,
  collapsedIds: ReadonlySet<string>,
): Map<string, Position> {
  const positions = new Map<string, Position>();
  positions.set(root.id, { x: 0, y: 0 });

  const visibleChildren = root.children.filter((child) => child !== undefined);
  if (visibleChildren.length === 0) return positions;

  const splitIndex = Math.ceil(visibleChildren.length / 2);
  const rightChildren = visibleChildren.slice(0, splitIndex);
  const leftChildren = visibleChildren.slice(splitIndex);

  layoutSubtree(rightChildren, collapsedIds, positions, 1);
  layoutSubtree(leftChildren, collapsedIds, positions, -1);

  return positions;
}

function layoutSubtree(
  children: MindmapNode[],
  collapsedIds: ReadonlySet<string>,
  positions: Map<string, Position>,
  direction: 1 | -1,
): void {
  if (children.length === 0) return;

  const virtualRoot: MindmapNode = {
    id: "__virtual__",
    kind: "domain",
    title: "",
    tagIds: [],
    children,
  };

  const pruned = pruneCollapsed(virtualRoot, collapsedIds);
  const rootHierarchy = hierarchy(pruned, (node) => node.children);
  const layout = tree<MindmapNode>().nodeSize([VERTICAL_GAP, HORIZONTAL_GAP]);
  const pointRoot = layout(rootHierarchy);

  pointRoot.each((node) => {
    if (node.data.id === "__virtual__") return;
    // d3.tree uses x for breadth and y for depth; we rotate to horizontal
    positions.set(node.data.id, {
      x: direction * node.y,
      y: node.x,
    });
  });
}

function pruneCollapsed(node: MindmapNode, collapsedIds: ReadonlySet<string>): MindmapNode {
  if (collapsedIds.has(node.id)) {
    return { ...node, children: [] };
  }
  return {
    ...node,
    children: node.children.map((child) => pruneCollapsed(child, collapsedIds)),
  };
}
