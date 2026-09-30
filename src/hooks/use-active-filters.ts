import { useTranslation } from "react-i18next";
import { useViewStore } from "@/stores/use-view-store";
import type { FilterDimensions } from "@/hooks/use-filter-dimensions";
import type { FilterEntries } from "@/hooks/use-filter-entries";
import type { PillMode } from "@/utils/list-filter";
import type { FilterDimension } from "@/utils/filter-modes";
import { isYesNoDimension } from "@/utils/filter-modes";
import { chipDimensions } from "@/utils/filter-layout";

/** One added filter value, as a chip draws it. */
export interface ActiveFilter {
  dimension: FilterDimension;
  value: string;
  label: string;
  mode: PillMode;
  color: string | null;
  /** The dimension's name ("Under", "Yes / no"), for an accessible name or a prefix. */
  dimensionLabel: string;
}

/** The tab's added filter values in the current view, in chip order — the chips' and Ctrl+F's list. */
export function useActiveFilters(catalogue: FilterDimensions, entries: FilterEntries): ActiveFilter[] {
  const { t } = useTranslation("filter");
  const view = useViewStore((s) => s.view);
  return chipDimensions(view).flatMap((dimension) =>
    entries.entries(dimension).map((entry) => ({
      dimension,
      value: entry.value,
      label: catalogue.valueLabel(dimension, entry.value, entry.mode),
      mode: entry.mode,
      color: catalogue.valueColor(dimension, entry.value),
      dimensionLabel: isYesNoDimension(dimension) ? t("rows.yesNo") : t(`rows.${dimension}`),
    })),
  );
}
