import type { MindmapNode } from "@/utils/tree-layout";

/**
 * A wait drawn from its owner rather than stored: a wait's check task, a delegated Task's wait, or
 * the wait an Asynchronous Task spawned when it was done. None is a row of its own, so none can be
 * deleted, copied or pasted — each is changed through the thing it is drawn from.
 */
export function isDerivedWait(node: MindmapNode): boolean {
  return node.expectationCheck !== undefined || node.delegationWait !== undefined || node.spawnedBy !== undefined;
}
