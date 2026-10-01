import { habitOrigin, isDerivedId } from "@/api/node-id";
import type { MindmapNode } from "@/utils/tree-layout";

/**
 * Whether a Task node can be switched to Compound: a stored Task, or a Habit occurrence of a flow
 * Task item, which reads the flag from its item and may say otherwise. An iteration's root has no
 * item to read it from, and a check task's status is the check itself.
 */
export function takesCompound(node: MindmapNode): boolean {
  if (node.rowId === undefined) return false;
  if (!isDerivedId(node.rowId)) return true;
  return habitOrigin(node.origin)?.item_type === "flow_task";
}
