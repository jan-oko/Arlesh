import { useMemo } from "react";
import { useBoardFilter } from "@/hooks/use-board-filter";
import { useHabitCollapseLabels } from "@/hooks/use-habit-collapse-labels";
import { useDisplayStore } from "@/stores/use-display-store";
import { filterTreeWithFocus } from "@/utils/filter-tree";
import { focusExemptPath } from "@/utils/focus-exemption";
import type { FoldReading } from "@/utils/drawn-path";

/**
 * How this tab draws a Habit's host before folding it — the tab's shared filter, the app-wide
 * threshold and the localized labels — for resolving a fold node by its id (`drawn-path.ts`).
 *
 * `focusExemptNodeId` is the view's own focus exemption, when it has one: a view that keeps the
 * selected iteration on screen after an edit must fold it back into the run it is drawn in, or the
 * run it stands on would shrink out from under it.
 */
export function useFoldReading(focusExemptNodeId: string | null = null): FoldReading {
  const filter = useBoardFilter();
  const threshold = useDisplayStore((s) => s.habitCollapseThreshold);
  const labels = useHabitCollapseLabels();
  return useMemo(
    () => ({
      threshold,
      labels,
      drawHost: (host) => filterTreeWithFocus(host, filter, focusExemptPath(host, focusExemptNodeId)).root,
    }),
    [filter, threshold, labels, focusExemptNodeId],
  );
}
