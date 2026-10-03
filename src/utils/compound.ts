import type { MindmapNode } from "@/utils/tree-layout";
import { can } from "@/utils/capabilities";

/**
 * Whether a Task node can be switched to Compound: one with a row behind it that the backend lets
 * take the flag (`nodes::rules::capabilities`) — a stored Task, or a Habit's Task occurrence, which
 * reads the flag from its template and may say otherwise. A check task's status is the check itself.
 */
export function takesCompound(node: MindmapNode): boolean {
  return node.rowId !== undefined && can(node, "compound");
}
