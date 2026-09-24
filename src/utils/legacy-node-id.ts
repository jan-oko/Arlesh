import type { MindmapNode } from "@/utils/tree-layout";
import { checkOrigin, habitOrigin, waitOrigin } from "@/api/node-id";
import { uuidV5 } from "@/utils/uuid-v5";
import { ARLESH_NODE_NAMESPACE } from "@/utils/node-uuid";

/**
 * The display key a node had before it was a row (ADR 0008), when it had one — read off the
 * `origin` it carries now:
 *
 * - a Habit iteration root was `habit-{flow}-{index}-virtual`, an item's occurrence
 *   `habititem-{item type}-{item}-{cycle}-{index}-virtual`;
 * - a wait's check task, a Task's spawned wait and a delegated Task's wait were UUIDs minted from
 *   `expectation-check/{wait}/{due}` (`spawned-check/{task}/{due}` on a spawned wait),
 *   `spawned-wait/{task}` and `delegation-wait/{task}`.
 *
 * `undefined` for a node that had no other key: a stored row's key never changed.
 */
export function legacyNodeId(node: MindmapNode): string | undefined {
  const habit = habitOrigin(node.origin);
  if (habit !== undefined) {
    const index = habit.iteration_scope.index;
    return habit.item_type === "flow_root"
      ? `habit-${habit.habit_id}-${index}-virtual`
      : `habititem-${habit.item_type}-${habit.item_id}-${habit.cycle_id}-${index}-virtual`;
  }
  const check = checkOrigin(node.origin);
  if (check !== undefined) {
    const kind = check.wait_kind === "stored" ? "expectation-check" : "spawned-check";
    return check.wait_kind === "occurrence" ? undefined : mint(`${kind}/${check.wait_id}/${check.due_at}`);
  }
  const wait = waitOrigin(node.origin);
  if (wait !== undefined) {
    const kind = wait.kind === "spawned_wait" ? "spawned-wait" : "delegation-wait";
    return mint(`${kind}/${wait.task_id}`);
  }
  return undefined;
}

function mint(structuralKey: string): string {
  return uuidV5(structuralKey, ARLESH_NODE_NAMESPACE);
}

/**
 * The node a saved key from before ADR 0008 now names in `tree`, if any — so a tab restored with
 * the old key of a Habit occurrence or a wait's derived node lands on the same node, and one whose
 * node is gone drops back to the root as any stale key does.
 */
export function migratedNodeId(tree: MindmapNode, savedId: string): string | undefined {
  const walk = (node: MindmapNode): string | undefined => {
    if (legacyNodeId(node) === savedId) return node.id;
    for (const child of node.children) {
      const found = walk(child);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return walk(tree);
}
