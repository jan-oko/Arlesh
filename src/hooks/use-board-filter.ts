import { useMemo } from "react";
import { useFilterStore } from "@/stores/use-filter-store";
import { useDisplayStore } from "@/stores/use-display-store";
import { useAgentCapacityStore } from "@/stores/use-agent-capacity-store";
import type { FilterState } from "@/utils/filter-tree";

/**
 * The tab's filter as the views apply it: the tab's own state, plus app-wide settings rather than
 * the tab's — how the Plan preset's scope narrowing matches, whether Start hides a wait that has
 * checks, whether Start and Do show a Started Task, and whether Start hides Agentic work while the
 * agent capacity lock is on — so they are filled in here instead of being stored with the tab. The Zen View replaces the Do one with its own (`zen-contents`).
 */
export function useBoardFilter(): FilterState {
  const filter = useFilterStore((s) => s.filter);
  const overlapping = useDisplayStore((s) => s.planScopeOverlapping);
  const hidesCheckedWaits = useDisplayStore((s) => s.startHidesCheckedWaits);
  const startShowsStarted = useDisplayStore((s) => s.startShowsStarted);
  const doShowsStarted = useDisplayStore((s) => s.doShowsStarted);
  const atCapacity = useAgentCapacityStore((s) => s.atCapacity);
  const hidesAgenticAtCapacity = useDisplayStore((s) => s.startHidesAgenticAtCapacity);
  const startHidesAgentic = atCapacity && hidesAgenticAtCapacity;
  return useMemo(
    () => ({
      ...filter,
      scopeMatch: overlapping ? "overlapping" : "contained",
      startHidesCheckedWaits: hidesCheckedWaits,
      startShowsStarted,
      doShowsStarted,
      startHidesAgentic,
    }),
    [filter, overlapping, hidesCheckedWaits, startShowsStarted, doShowsStarted, startHidesAgentic],
  );
}
