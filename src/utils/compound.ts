import { habitOrigin, isDerivedId } from "@/api/node-id";
import type { MindmapNode } from "@/utils/tree-layout";

/**
 * Whether a Task node can be switched to Compound: a stored Task, or a Habit's Task occurrence —
 * an item's or an iteration's root — which reads the flag from its template and may say
 * otherwise. A check task's status is the check itself.
 */
export function takesCompound(node: MindmapNode): boolean {
  if (node.rowId === undefined) return false;
  if (!isDerivedId(node.rowId)) return true;
  return habitOrigin(node.origin) !== undefined;
}
