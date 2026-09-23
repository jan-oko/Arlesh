import type { MindmapNode } from "@/utils/tree-layout";
import { findNode } from "@/utils/mindmap-tree";
import { expectationNodeId } from "@/utils/node-uuid";

/**
 * The node whose editor opens when `node` is asked for one.
 *
 * Itself, almost always. A **derived wait** has no row of its own to edit, so the editor of what it
 * is drawn from opens instead: a check task's check-by is its Expectation's, and a delegated Task's
 * wait is the Task's own — rather than an editor key that does nothing. `undefined` when that owner
 * is no longer in the tree.
 */
export function editorOwnerOf(tree: MindmapNode, node: MindmapNode): MindmapNode | undefined {
  if (node.expectationCheck !== undefined) {
    return findNode(tree, expectationNodeId(node.expectationCheck.expectationId));
  }
  if (node.delegationWait !== undefined) return findNode(tree, `task-${node.delegationWait.taskId}`);
  return node;
}
