import type { MindmapNode } from "@/utils/tree-layout";
import { findNode } from "@/utils/mindmap-tree";
import { expectationNodeId } from "@/utils/node-uuid";

/**
 * The node whose editor opens when `node` is asked for one.
 *
 * Itself, almost always. A **derived wait** has no row of its own to edit, so the editor of what it
 * is drawn from opens instead: a stored wait's check task opens the wait, and a spawned wait, its
 * check task and a delegated Task's wait open the Task, whose template and delegate they come from — rather than an editor key that does nothing. `undefined` when that owner
 * is no longer in the tree.
 */
export function editorOwnerOf(tree: MindmapNode, node: MindmapNode): MindmapNode | undefined {
  const check = node.expectationCheck;
  if (check !== undefined) {
    return check.kind === "stored"
      ? findNode(tree, expectationNodeId(check.expectationId))
      : findNode(tree, `task-${check.taskId}`);
  }
  // A spawned wait's editable part is its Task's template.
  if (node.spawnedBy !== undefined) return findNode(tree, `task-${node.spawnedBy.taskId}`);
  if (node.delegationWait !== undefined) return findNode(tree, `task-${node.delegationWait.taskId}`);
  return node;
}
