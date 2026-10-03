import { useCallback } from "react";
import { planContainmentConflicts } from "@/api/tasks";
import type { DescendantPlans, PlanClampTarget } from "@/api/tasks";
import type { RowId } from "@/api/node-id";
import type { TimeScope } from "@/api/time-scope";
import { usePlanClampStore } from "@/stores/use-plan-clamp-store";

/** One Plan about to be written: the Task, and the Plan it is given. */
export interface PlanWrite {
  id: RowId;
  plan: TimeScope | null;
}

/** What the clamp-or-cancel prompt settled: go ahead (settling the Tasks below as `descendants`
 * says, or with nothing to settle), or cancel. */
export type PlanClampAnswer =
  | { proceed: true; descendants: DescendantPlans | null }
  | { proceed: false };

/**
 * Asks before Plans are written whether the Tasks below that hold their own Plans inside them may be
 * clamped or cleared — the clamp-or-cancel prompt Time Scope uses, for Plans
 * (`docs/spec/time-scopes.md`, *Plan inheritance*). A batch is asked once, over every Task it would
 * leave outside. Clearing a Plan leaves nothing outside, so it never asks.
 */
export function usePlanClamp(): (writes: readonly PlanWrite[]) => Promise<PlanClampAnswer> {
  const ask = usePlanClampStore((s) => s.ask);
  return useCallback(async (writes: readonly PlanWrite[]): Promise<PlanClampAnswer> => {
    const conflicts: PlanClampTarget[] = [];
    for (const write of writes) {
      if (write.plan === null) continue;
      conflicts.push(...(await planContainmentConflicts(write.id, write.plan)));
    }
    if (conflicts.length === 0) return { proceed: true, descendants: null };
    const choice = await ask(conflicts);
    return choice === null ? { proceed: false } : { proceed: true, descendants: choice };
  }, [ask]);
}
