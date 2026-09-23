import type { MindmapNode, NodeKind, Position } from "@/utils/tree-layout";
import { isDerivedWait } from "@/utils/derived-wait";

export function findNode(root: MindmapNode, id: string): MindmapNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The id of the Flow `id` belongs to: itself when it *is* a flow, otherwise its nearest flow
 * ancestor. `undefined` for a node outside any flow.
 *
 * Two flow items belong to the same template exactly when this agrees on them, which is what
 * copying a flow item is allowed within and refused across.
 */
export function owningFlowId(root: MindmapNode, id: string): string | undefined {
  let node = findNode(root, id);
  while (node !== undefined) {
    if (node.kind === "flow") return node.id;
    const parent = findParent(root, node.id);
    node = parent ?? undefined;
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

/**
 * Every node stepped through to reach `id`, the tree root first and `id` itself last — empty when
 * the id is not in the tree.
 *
 * One walk answers both "is it still there?" and "what is above it", which is what the top bar's
 * breadcrumb needs: repeated `findParent` calls would climb the tree once per level.
 */
export function pathToNode(root: MindmapNode, id: string): readonly MindmapNode[] {
  if (root.id === id) return [root];
  for (const child of root.children) {
    const below = pathToNode(child, id);
    if (below.length > 0) return [root, ...below];
  }
  return [];
}

export function nearestInDirection(
  fromId: string,
  positions: Map<string, Position>,
  direction: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
  candidateIds?: ReadonlySet<string>,
): string | undefined {
  const from = positions.get(fromId);
  if (from === undefined) return undefined;

  let bestId: string | undefined;
  let bestScore = Infinity;

  for (const [id, pos] of positions) {
    if (id === fromId) continue;
    if (candidateIds !== undefined && !candidateIds.has(id)) continue;
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

export function connectedNodeIds(root: MindmapNode, id: string): Set<string> {
  const node = findNode(root, id);
  const connected = new Set<string>();

  if (node !== undefined) {
    for (const child of node.children) connected.add(child.id);
  }

  const parent = findParent(root, id);
  if (parent !== null) connected.add(parent.id);
  if (parent !== null) {
    for (const sibling of parent.children) {
      if (sibling.id !== id) connected.add(sibling.id);
    }
  }

  return connected;
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

/**
 * Every node a Task can depend on — Tasks, Goals and stored Expectations — for the dependency
 * picker and the editors that read it. A derived wait — a check task, a delegated Task's wait, an
 * asynchronous Task's spawned wait — has no row for an edge to name, so none is collected.
 */
export function collectTasksAndGoals(node: MindmapNode, acc: MindmapNode[]): void {
  const derivedWait = isDerivedWait(node);
  if ((node.kind === "task" || node.kind === "goal" || node.kind === "expectation") && !derivedWait) acc.push(node);
  for (const child of node.children) collectTasksAndGoals(child, acc);
}

export function collectSubtreePostOrder(node: MindmapNode): Array<{ id: string; kind: NodeKind }> {
  const result: Array<{ id: string; kind: NodeKind }> = [];
  function visit(n: MindmapNode): void {
    // A derived wait is drawn from its owner's row, not stored: there is nothing to delete, and it
    // goes when the owner does.
    for (const child of n.children) {
      if (!isDerivedWait(child)) visit(child);
    }
    result.push({ id: n.id, kind: n.kind });
  }
  visit(node);
  return result;
}

/**
 * Whether converting `node` to a Flow needs the destructive confirm prompt. Only a node with
 * children loses anything meaningful (descendants are folded into flow items; the Keep-dependencies
 * and Map-scopes toggles only apply to a subtree). A leaf converts straight away.
 */
export function conversionNeedsConfirm(node: MindmapNode): boolean {
  return node.children.length > 0;
}

/** Kinds a Flow may be parented under — mirrors the kinds a Flow may target for conversion. */
const FLOW_PARENT_KINDS = new Set<NodeKind>(["aspect", "domain", "project", "goal"]);

/** A Goal/Task can convert into a Flow only where a Flow may be parented (never under a Task). */
export function canConvertNodeToFlow(nodeKind: NodeKind, parentKind: NodeKind | null): boolean {
  return (nodeKind === "goal" || nodeKind === "task") && parentKind !== null && FLOW_PARENT_KINDS.has(parentKind);
}

/** A flattened node for search: its id, title, kind, and ancestor titles nearest-first (root excluded). */
export interface SearchableNode { id: string; title: string; kind: NodeKind; path: string[] }

/** Flattens the tree (excluding the virtual root) into searchable rows carrying each node's ancestry. */
export function collectSearchableNodes(root: MindmapNode): SearchableNode[] {
  const out: SearchableNode[] = [];
  function visit(n: MindmapNode, isRoot: boolean, ancestors: string[]): void {
    if (!isRoot) out.push({ id: n.id, title: n.title, kind: n.kind, path: ancestors });
    const childAncestors = isRoot ? [] : [n.title, ...ancestors];
    for (const child of n.children) visit(child, false, childAncestors);
  }
  visit(root, true, []);
  return out;
}

/** Every node in the tree keyed by id — including the virtual root — for O(1) lookups (label, color). */
export function flattenNodesById(root: MindmapNode): Map<string, MindmapNode> {
  const map = new Map<string, MindmapNode>();
  function visit(n: MindmapNode): void {
    map.set(n.id, n);
    for (const child of n.children) visit(child);
  }
  visit(root);
  return map;
}

/** Returns all node IDs in the tree in depth-first pre-order. */
export function collectAllNodeIds(root: MindmapNode): string[] {
  const result: string[] = [];
  function visit(n: MindmapNode): void {
    result.push(n.id);
    for (const child of n.children) visit(child);
  }
  visit(root);
  return result;
}

/** Returns a set containing the parent and all direct children of `id` (no siblings). */
export function parentAndChildrenIds(root: MindmapNode, id: string): ReadonlySet<string> {
  const result = new Set<string>();
  const node = findNode(root, id);
  if (node === undefined) return result;
  for (const child of node.children) result.add(child.id);
  const parent = findParent(root, id);
  if (parent !== null) result.add(parent.id);
  return result;
}

/** Returns a set of all sibling IDs for `id` (same parent, excluding self). */
export function siblingIds(root: MindmapNode, id: string): ReadonlySet<string> {
  const result = new Set<string>();
  const parent = findParent(root, id);
  if (parent === null) return result;
  for (const child of parent.children) {
    if (child.id !== id) result.add(child.id);
  }
  return result;
}

/**
 * Returns the set of node IDs to select when shift-clicking `targetId` from `anchorId`.
 *
 * - Same node: [anchorId]
 * - Sibling of anchor: all siblings between anchor and target (inclusive, in sibling order)
 * - Ancestor of anchor: [anchorId, ...ancestors up to target] (path toward root)
 * - Otherwise: null (do nothing)
 */
export function computeShiftSelectRange(
  tree: MindmapNode,
  anchorId: string,
  targetId: string,
): string[] | null {
  if (anchorId === targetId) return [anchorId];

  const anchorParent = findParent(tree, anchorId);
  if (anchorParent === null) return null;

  // Check sibling case: target is a sibling of anchor (same parent)
  const siblings = anchorParent.children;
  const anchorIdx = siblings.findIndex((s) => s.id === anchorId);
  const targetIdx = siblings.findIndex((s) => s.id === targetId);
  if (anchorIdx !== -1 && targetIdx !== -1) {
    const lo = Math.min(anchorIdx, targetIdx);
    const hi = Math.max(anchorIdx, targetIdx);
    return siblings.slice(lo, hi + 1).map((s) => s.id);
  }

  // Check ancestor case: target is on the path from anchor to root
  const ancestorPath: string[] = [];
  let cursor: MindmapNode | null = anchorParent;
  while (cursor !== null) {
    ancestorPath.push(cursor.id);
    if (cursor.id === targetId) {
      return [anchorId, ...ancestorPath];
    }
    cursor = findParent(tree, cursor.id);
  }

  return null;
}
