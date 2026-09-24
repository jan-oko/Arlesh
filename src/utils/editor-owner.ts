import type { MindmapNode } from "@/utils/tree-layout";
import { findNode } from "@/utils/mindmap-tree";
import { waitOrigin } from "@/api/node-id";

/**
 * The node whose editor opens when `node` is asked for one.
 *
 * Itself, almost always — a wait's check task included, which is a Task row of its own. A
 * **derived wait** is drawn from its Task, so the Task's editor opens instead: a spawned wait's
 * title, tags and window are its Task's Expectation template, and a delegated Task's wait is its
 * delegate. `undefined` when that owner is no longer in the tree.
 */
export function editorOwnerOf(tree: MindmapNode, node: MindmapNode): MindmapNode | undefined {
  const wait = waitOrigin(node.origin);
  if (wait !== undefined) return findNode(tree, `task-${wait.task_id}`);
  return node;
}
