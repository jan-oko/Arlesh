import { useTranslation } from "react-i18next";
import { useFilterStore } from "@/stores/use-filter-store";
import type { View } from "@/stores/use-view-store";
import type { FilterDimensions } from "@/hooks/use-filter-dimensions";
import type { FilterEntries } from "@/hooks/use-filter-entries";
import { NO_VALUE, isYesNoDimension } from "@/utils/filter-modes";
import { filterMenuRows, filterSwitchesFor, rowDimensions } from "@/utils/filter-layout";
import type { FilterRowId, FilterSwitch } from "@/utils/filter-layout";
import type { SearchGroup, SearchResult, SwitchResult } from "@/utils/filter-search";
import type { OverrideMode } from "@/utils/filter-tree";

/** Rows whose values are every node, listed only once the user types. */
function isNodeSearch(row: FilterRowId): boolean {
  return row === "antecedent" || row === "dependency";
}

/**
 * The `Ctrl+F` filter search's catalogue for a view: every dimension the view's Filter menu has, in
 * the menu's order, with the values not yet added, then the switches — Private, Archived and
 * Backlog — each one result wearing its current state.
 */
export function useFilterSearchGroups(view: View, catalogue: FilterDimensions, entries: FilterEntries): SearchGroup[] {
  const { t } = useTranslation("filter");
  const filter = useFilterStore((s) => s.filter);

  function valueResults(row: FilterRowId): SearchResult[] {
    return rowDimensions(row).flatMap((dimension) => {
      const added = new Set(entries.entries(dimension).map((entry) => entry.value));
      return catalogue.options(dimension)
        .filter((option) => !added.has(option.value))
        .map((option) => {
          const notLabel = isYesNoDimension(dimension) ? catalogue.valueLabel(dimension, NO_VALUE[dimension], "all") : "";
          return { ...option, kind: "value" as const, dimension, matchText: `${option.label} ${notLabel}` };
        });
    });
  }

  function switchState(target: FilterSwitch): OverrideMode {
    if (target === "private") return filter.privateMode ? "include" : "inactive";
    return target === "archived" ? filter.archivedMode : filter.backlogMode;
  }

  function switchLabel(target: FilterSwitch): string {
    if (target === "private") return t("privateMode");
    return target === "archived" ? t("archivedPill") : t("backlogPill");
  }

  const switches: SwitchResult[] = filterSwitchesFor(view).map((target) => ({
    kind: "switch",
    target,
    label: switchLabel(target),
    state: switchState(target),
    matchText: switchLabel(target),
  }));

  const dimensionGroups: SearchGroup[] = filterMenuRows(view).flat().map((row) => ({
    key: row,
    label: catalogue.groupLabel(row),
    aliases: catalogue.aliases(row),
    searchOnly: isNodeSearch(row),
    results: valueResults(row),
  }));

  return [
    ...dimensionGroups,
    { key: "switches", label: t("groups.switches"), aliases: [], searchOnly: false, results: switches },
  ];
}
