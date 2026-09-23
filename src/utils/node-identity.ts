import type { MindmapNode } from "@/utils/tree-layout";
import { findNode } from "@/utils/mindmap-tree";

/**
 * A node that draws no database row was asked for one: a virtual Habit occurrence, a folded
 * Habit run, or the synthetic tree root. Thrown instead of letting a `NaN` reach the backend,
 * where it serialized as `null` and failed as "invalid type: null, expected i64" (Arlesh-aln).
 */
export class NotRowBackedError extends Error {
  constructor(nodeId: string) {
    super(`Node "${nodeId}" is not backed by a database row`);
    this.name = "NotRowBackedError";
  }
}

/** A node id that is not in the tree it was looked up in. */
export class NodeNotFoundError extends Error {
  constructor(nodeId: string) {
    super(`Node "${nodeId}" is not in the tree`);
    this.name = "NodeNotFoundError";
  }
}

/**
 * The database row `node` draws — read off its `rowId` field, never parsed out of its `id`.
 * The id is a display key: unique and comparable, not an address.
 */
export function rowIdOf(node: MindmapNode): number {
  if (node.rowId === undefined) throw new NotRowBackedError(node.id);
  return node.rowId;
}

/** {@link rowIdOf} for a caller that holds only a node id: looks the node up in `tree` first. */
export function rowIdOfNodeId(tree: MindmapNode, nodeId: string): number {
  const node = findNode(tree, nodeId);
  if (node === undefined) throw new NodeNotFoundError(nodeId);
  return rowIdOf(node);
}
