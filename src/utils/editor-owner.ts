import type { MindmapNode } from "@/utils/tree-layout";
import { findNode } from "@/utils/mindmap-tree";

/**
 * The node whose editor opens when `node` is asked for one.
 *
 * Itself, almost always. A **derived wait** has no row of its own to edit, so the editor of what it
 * is drawn from opens instead: a spawned wait and a delegated Task's wait open the Task, whose
 * template and delegate they come from. `undefined` when that owner is no longer in the tree.
 *
 * A wait's **check task** is not routed here: `E` on one should edit that check, which today's
 * model cannot do — see [`isUneditableCheck`].
 */
export function editorOwnerOf(tree: MindmapNode, node: MindmapNode): MindmapNode | undefined {
  // A spawned wait's editable part is its Task's template.
  if (node.spawnedBy !== undefined) return findNode(tree, `task-${node.spawnedBy.taskId}`);
  if (node.delegationWait !== undefined) return findNode(tree, `task-${node.delegationWait.taskId}`);
  return node;
}

/**
 * Whether `node` is a wait's check task, which `E` refuses out loud. The user wants `E` to edit
 * the check itself, not its wait; a check task is derived from its wait's schedule and has no row
 * to edit until checks become rows of their own with Arlesh-pnn's virtual node tables, so for now
 * the key says so rather than opening something else.
 */
export function isUneditableCheck(node: MindmapNode): boolean {
  return node.expectationCheck !== undefined;
}
