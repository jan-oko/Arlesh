import { useCallback, useState } from "react";
import { setHabitInstancePlan } from "@/api/flows";
import type { PlanOverride } from "@/api/flows";
import type { MindmapNode } from "@/utils/tree-layout";

/** The Habit occurrence whose Plan editor is open. */
export interface OccurrencePlanTarget {
  node: MindmapNode;
  flowId: number;
  itemId: number;
  scopeId: number;
  cycleId: number;
}

/**
 * The occurrence a node is, when it is one that carries a Plan of its own: a flow-task item's
 * occurrence. A flow-goal occurrence has no Plan, and the iteration root is not planned per
 * occurrence (see `docs/spec/habits.md`, *Planning one occurrence*).
 */
export function plannableOccurrence(node: MindmapNode): OccurrencePlanTarget | null {
  const item = node.habitItem;
  if (item === undefined || item.itemType !== "flow_task") return null;
  return { node, flowId: item.flowId, itemId: item.itemId, scopeId: item.scopeId, cycleId: item.cycleId };
}

/** Which of the three states an occurrence's Plan is in now — what its editor opens on. */
export function currentPlanOverride(node: MindmapNode): PlanOverride {
  if (node.planOverridden !== true) return { kind: "inherit" };
  if (node.plan == null) return { kind: "unplanned" };
  return { kind: "planned", plan: node.plan };
}

export interface OccurrencePlanHandles {
  /** The occurrence being edited, or `null` when the editor is shut. */
  target: OccurrencePlanTarget | null;
  /** Opens the editor on `node` if it is a plannable occurrence; reports whether it did. */
  open: (node: MindmapNode) => boolean;
  close: () => void;
  /** Writes the occurrence's Plan and reloads. A refusal rejects, for the editor to show. */
  save: (plan: PlanOverride) => Promise<void>;
}

/**
 * Planning one Habit occurrence on its own. One write, one Gesture: the backend call is its own
 * undo step, like every other edit.
 */
export function useOccurrencePlan(reload: () => Promise<void>): OccurrencePlanHandles {
  const [target, setTarget] = useState<OccurrencePlanTarget | null>(null);

  const open = useCallback((node: MindmapNode): boolean => {
    const occurrence = plannableOccurrence(node);
    if (occurrence === null) return false;
    setTarget(occurrence);
    return true;
  }, []);

  const close = useCallback(() => setTarget(null), []);

  const save = useCallback(
    async (plan: PlanOverride): Promise<void> => {
      if (target === null) return;
      await setHabitInstancePlan(target.flowId, target.itemId, target.scopeId, target.cycleId, plan);
      setTarget(null);
      await reload();
    },
    [target, reload],
  );

  return { target, open, close, save };
}
