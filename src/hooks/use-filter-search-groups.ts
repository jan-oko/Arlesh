import { useTranslation } from "react-i18next";
import { useFilterStore } from "@/stores/use-filter-store";
import type { View } from "@/stores/use-view-store";
import type { FilterDimensions } from "@/hooks/use-filter-dimensions";
import type { FilterEntries } from "@/hooks/use-filter-entries";
import { NO_VALUE, isYesNoDimension } from "@/utils/filter-modes";
import { filterMenuRows, filterSwitchesFor, offeredDimensions } from "@/utils/filter-layout";
import { useRowKindToggle } from "@/hooks/use-row-kind-toggle";
import { delegatedModeOf } from "@/utils/filter-tree";
import type { OverrideMode } from "@/utils/filter-tree";
import type { FilterRowId } from "@/utils/filter-layout";
import type { RowKindResult, SearchGroup, SearchResult, SearchSwitch, SwitchResult } from "@/utils/filter-search";

/** Rows whose values are every node: their results are capped. */
function isNodeSearch(row: FilterRowId): boolean {
  return row === "antecedent" || row === "dependency";
}

/** The switches the search offers: Archived, Backlog and Delegated where the view has them. Private Mode is
 * the menu's switch; while it is on, the Private yes/no pill is what the search offers instead. */
function searchSwitches(view: View): SearchSwitch[] {
  return filterSwitchesFor(view).flatMap((target) => (target === "private" ? [] : [target]));
}

/**
 * The `Ctrl+F` filter search's catalogue for a view: every dimension the view's Filter menu has, in
 * the menu's order, with the values not yet added; then the switches — in the List View the three
 * row kinds, then Archived, Backlog and Delegated — each one result wearing its current state.
 */
export function useFilterSearchGroups(view: View, catalogue: FilterDimensions, entries: FilterEntries): SearchGroup[] {
  const { t } = useTranslation(["filter", "listView"]);
  const filter = useFilterStore((s) => s.filter);
  const rowKindToggle = useRowKindToggle();

  function valueResults(row: FilterRowId): SearchResult[] {
    return offeredDimensions(row, filter.privateMode).flatMap((dimension) => {
      const added = new Set(entries.entries(dimension).map((entry) => entry.value));
      return catalogue.options(dimension)
        .filter((option) => !added.has(option.value))
        .map((option) => {
          const notLabel = isYesNoDimension(dimension) ? catalogue.valueLabel(dimension, NO_VALUE[dimension], "all") : "";
          return { ...option, kind: "value" as const, dimension, matchText: `${option.label} ${notLabel}` };
        });
    });
  }

  function switchLabel(target: SearchSwitch): string {
    return t(`${target}Pill`);
  }

  function switchState(target: SearchSwitch): OverrideMode {
    if (target === "archived") return filter.archivedMode;
    if (target === "backlog") return filter.backlogMode;
    return delegatedModeOf(filter);
  }

  // The List View's row kinds, or the Zen View's strips — whatever the view's switch block holds.
  const rowKinds: RowKindResult[] = rowKindToggle.kinds.map((kind) => ({
    kind: "rowKind",
    target: kind,
    label: t(`listView:rowKind.${kind}`),
    shown: rowKindToggle.isShown(kind),
    matchText: t(`listView:rowKind.${kind}`),
  }));

  const switches: SwitchResult[] = searchSwitches(view).map((target) => ({
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
    { key: "switches", label: t("groups.switches"), aliases: [], searchOnly: false, results: [...rowKinds, ...switches] },
  ];
}
