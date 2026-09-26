import { useMemo } from "react";
import { useFilterStore } from "@/stores/use-filter-store";
import { useDisplayStore } from "@/stores/use-display-store";
import type { FilterState } from "@/utils/filter-tree";

/**
 * The tab's filter as the views apply it: the tab's own state, plus two app-wide settings rather
 * than the tab's — how the Plan preset's scope narrowing matches, and whether Start hides a wait
 * that has checks — so they are filled in here instead of being stored with the tab.
 */
export function useBoardFilter(): FilterState {
  const filter = useFilterStore((s) => s.filter);
  const overlapping = useDisplayStore((s) => s.planScopeOverlapping);
  const hidesCheckedWaits = useDisplayStore((s) => s.startHidesCheckedWaits);
  return useMemo(
    () => ({
      ...filter,
      scopeMatch: overlapping ? "overlapping" : "contained",
      startHidesCheckedWaits: hidesCheckedWaits,
    }),
    [filter, overlapping, hidesCheckedWaits],
  );
}
