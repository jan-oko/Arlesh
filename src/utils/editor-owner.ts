import type { MindmapNode } from "@/utils/tree-layout";
import { findNode } from "@/utils/mindmap-tree";

/**
 * The node whose editor opens when `node` is asked for one.
 *
 * Itself, almost always — a wait's check task included, which is a Task row of its own, and a
 * Task's **spawned wait**, which is an Expectation row whose status and archive the Expectation
 * editor writes into its overlay. The one exception is a **delegated Task's wait**: nothing about
 * it can be written (only the Task being done releases it) and what it waits on is the Task's
 * delegate, so the Task's editor opens instead. `undefined` when that Task is no longer in the tree.
 */
export function editorOwnerOf(tree: MindmapNode, node: MindmapNode): MindmapNode | undefined {
  if (node.origin?.kind === "delegation_wait") return findNode(tree, `task-${node.origin.task_id}`);
  return node;
}
