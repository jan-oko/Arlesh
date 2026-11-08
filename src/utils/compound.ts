import type { MindmapNode } from "@/utils/tree-layout";
import { can } from "@/utils/capabilities";

/**
 * Whether a Task node offers the Compound switch: it takes the flag and has sub-items for it to
 * consist of. A Compound Task that has lost its last sub-item still offers it, to switch off — the
 * backend refuses it a status by hand, so without the switch it would be stuck at To Do.
 */
export function offersCompound(node: MindmapNode): boolean {
  if (!takesCompound(node)) return false;
  return node.compound === true || node.children.some((child) => child.kind !== "info");
}

/**
 * Whether a Task node can be switched to Compound: one with a row behind it that the backend lets
 * take the flag (`nodes::rules::capabilities`) — a stored Task, or a Habit's Task occurrence, which
 * reads the flag from its template and may say otherwise. A check task's status is the check itself.
 */
export function takesCompound(node: MindmapNode): boolean {
  return node.rowId !== undefined && can(node, "compound");
}
