import { useFilterStore } from "@/stores/use-filter-store";
import { useViewStore } from "@/stores/use-view-store";
import { useFilterEntries } from "@/hooks/use-filter-entries";
import { hasUndrawnFilters } from "@/utils/filter-layout";
import { delegatedModeOf } from "@/utils/filter-tree";

/** Whether the Filter button wears its dot in the current view: the menu holds a setting that
 * nothing outside it shows (see `hasUndrawnFilters`). */
export function useFilterDot(): boolean {
  const view = useViewStore((s) => s.view);
  const archivedMode = useFilterStore((s) => s.filter.archivedMode);
  const backlogMode = useFilterStore((s) => s.filter.backlogMode);
  const delegatedMode = useFilterStore((s) => delegatedModeOf(s.filter));
  const showOnAgent = useFilterStore((s) => s.filter.showOnAgent === true);
  const showReview = useFilterStore((s) => s.filter.showReview === true);
  const entries = useFilterEntries();
  return hasUndrawnFilters(view, {
    archivedMode,
    backlogMode,
    delegatedMode,
    showOnAgent,
    showReview,
    valueCount: (dimension) => entries.entries(dimension).length,
  });
}
