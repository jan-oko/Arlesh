import type { View } from "@/stores/use-view-store";
import type { StatusMode } from "@/utils/filter-tree";
import { PLAN_VIEW_STATUS_MODE, ZEN_VIEW_STATUS_MODE } from "@/utils/filter-tree";

/**
 * The status preset `view` always reads under, or `null` for a view that reads the tab's own.
 *
 * The Plan View is always Plan and the Zen View always Do. Both *read* the board under their preset
 * rather than writing it into the tab's filter, so the tab's own preset is back the moment you
 * leave. One function, so the top bar and the Filter menu cannot disagree about which views lock.
 */
export function lockedStatusMode(view: View): StatusMode | null {
  if (view === "plan") return PLAN_VIEW_STATUS_MODE;
  if (view === "zen") return ZEN_VIEW_STATUS_MODE;
  return null;
}
