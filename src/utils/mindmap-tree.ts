import type { MindmapNode, NodeKind, Position } from "@/utils/tree-layout";

export function findNode(root: MindmapNode, id: string): MindmapNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function findParent(root: MindmapNode, id: string): MindmapNode | null {
  for (const child of root.children) {
    if (child.id === id) return root;
    const found = findParent(child, id);
    if (found !== null) return found;
  }
  return null;
}

export function nearestInDirection(
  fromId: string,
  positions: Map<string, Position>,
  direction: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
): string | undefined {
  const from = positions.get(fromId);
  if (from === undefined) return undefined;

  let bestId: string | undefined;
  let bestScore = Infinity;

  for (const [id, pos] of positions) {
    if (id === fromId) continue;
    const dx = pos.x - from.x;
    const dy = pos.y - from.y;
    let primary: number;
    let secondary: number;
    switch (direction) {
      case "ArrowRight": if (dx <= 0) continue; primary = dx;  secondary = Math.abs(dy); break;
      case "ArrowLeft":  if (dx >= 0) continue; primary = -dx; secondary = Math.abs(dy); break;
      case "ArrowDown":  if (dy <= 0) continue; primary = dy;  secondary = Math.abs(dx); break;
      case "ArrowUp":    if (dy >= 0) continue; primary = -dy; secondary = Math.abs(dx); break;
    }
    const score = primary + 2 * secondary;
    if (score < bestScore) { bestScore = score; bestId = id; }
  }
  return bestId;
}

export function gatherSubtreeItems(
  node: MindmapNode,
  layout: Map<string, Position>,
  collapsedIds: ReadonlySet<string>,
  ox: number,
  oy: number,
  depthOffset: number,
  isRoot: boolean,
  nodes: Array<{ id: string; x: number; y: number; depthAbs: number }>,
  edges: Array<{ key: string; fx: number; fy: number; fdepth: number; tx: number; ty: number; tdepth: number }>,
): void {
  const relPos = layout.get(node.id);
  if (relPos === undefined) return;
  const absX = ox + relPos.x;
  const absY = oy + relPos.y;
  const depthAbs = depthOffset + relPos.depth;
  if (!isRoot) nodes.push({ id: node.id, x: absX, y: absY, depthAbs });
  if (collapsedIds.has(node.id)) return;
  for (const child of node.children) {
    const childRel = layout.get(child.id);
    if (childRel === undefined) continue;
    const cx = ox + childRel.x;
    const cy = oy + childRel.y;
    const cd = depthOffset + childRel.depth;
    edges.push({ key: `${node.id}-${child.id}`, fx: absX, fy: absY, fdepth: depthAbs, tx: cx, ty: cy, tdepth: cd });
    gatherSubtreeItems(child, layout, collapsedIds, ox, oy, depthOffset, false, nodes, edges);
  }
}

export function collectTasksAndGoals(node: MindmapNode, acc: MindmapNode[]): void {
  if (node.kind === "task" || node.kind === "goal") acc.push(node);
  for (const child of node.children) collectTasksAndGoals(child, acc);
}

export function collectSubtreePostOrder(node: MindmapNode): Array<{ id: string; kind: NodeKind }> {
  const result: Array<{ id: string; kind: NodeKind }> = [];
  function visit(n: MindmapNode): void {
    for (const child of n.children) visit(child);
    result.push({ id: n.id, kind: n.kind });
  }
  visit(node);
  return result;
}
