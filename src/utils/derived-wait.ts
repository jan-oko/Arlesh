import type { MindmapNode } from "@/utils/tree-layout";
import { checkOrigin, waitOrigin } from "@/api/node-id";

/**
 * A wait drawn from its owner rather than stored: a wait's check task, a delegated Task's wait, or
 * the wait an Asynchronous Task spawned when it was done. Each is a row (ADR 0008), but none can be
 * deleted, copied or pasted — each goes with the thing it is drawn from.
 */
export function isDerivedWait(node: MindmapNode): boolean {
  return checkOrigin(node.origin) !== undefined || waitOrigin(node.origin) !== undefined;
}

/** Whether `node` is a delegated Task's wait, which only the Task being done releases. */
export function isDelegationWait(node: MindmapNode): boolean {
  return node.origin?.kind === "delegation_wait";
}
