import { useMemo } from "react";
import { useFilterStore } from "@/stores/use-filter-store";
import { useDisplayStore } from "@/stores/use-display-store";
import type { FilterState } from "@/utils/filter-tree";

/**
 * The tab's filter as the views apply it: the tab's own state, plus how the Plan preset's scope
 * narrowing matches — an app-wide setting rather than the tab's, so it is filled in here instead of
 * being stored with the tab.
 */
export function useBoardFilter(): FilterState {
  const filter = useFilterStore((s) => s.filter);
  const overlapping = useDisplayStore((s) => s.planScopeOverlapping);
  return useMemo(() => ({ ...filter, scopeMatch: overlapping ? "overlapping" : "contained" }), [filter, overlapping]);
}
