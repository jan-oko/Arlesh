import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useFilterDisplay } from "@/hooks/use-filter-display";
import type { FilterDisplay } from "@/hooks/use-filter-display";
import type { FilterDimension } from "@/utils/filter-modes";
import { NO_VALUE, YES_VALUE, isYesNoDimension } from "@/utils/filter-modes";
import type { FilterRowId } from "@/utils/filter-layout";
import type { FilterOption } from "@/utils/filter-search";
import type { PillMode } from "@/utils/list-filter";
import {
  TASK_STATUS_FILTER_VALUES, GOAL_STATUS_VALUES, PROJECT_STATUS_VALUES, VERDICT_FILTER_VALUES, SCOPE_STATE_VALUES,
} from "@/utils/list-filter";

/** How every filter dimension reads: its names, its values, and a value's label and color. */
export interface FilterDimensions {
  /** The short label a Filter menu row wears ("Task"). */
  rowLabel: (row: FilterRowId) => string;
  /** The heading a filter search group wears ("Task status"). */
  groupLabel: (row: FilterRowId) => string;
  /** Older names a dimension still answers to in the search. */
  aliases: (row: FilterRowId) => readonly string[];
  /** Every value the dimension can take, in display order. A yes/no dimension has one: "is X". */
  options: (dimension: FilterDimension) => readonly FilterOption[];
  /** An added value's label in its mode: a yes/no value in Not reads "Not blocked". */
  valueLabel: (dimension: FilterDimension, value: string, mode: PillMode) => string;
  valueColor: (dimension: FilterDimension, value: string) => string | null;
}

/** The label a fixed-value dimension gives one of its values. `privateLabel` words the Private
 * pill, which has no display resolver of its own. */
function fixedLabel(
  display: FilterDisplay,
  privateLabel: (value: string) => string,
  dimension: FilterDimension,
  value: string,
): string {
  switch (dimension) {
    case "private": return privateLabel(value);
    case "taskStatus": return display.displayTaskStatus(value);
    case "goalStatus": return display.displayGoalStatus(value);
    case "projectStatus": return display.displayProjectStatus(value);
    case "verdict": return display.displayVerdict(value);
    case "scopeState": return display.displayScopeState(value);
    case "blocked": return display.displayBlocked(value);
    case "agentic": return display.displayAgentic(value);
    case "asynchronous": return display.displayAsynchronous(value);
    case "tag": return display.tagName(Number.parseInt(value, 10));
    case "antecedent":
    case "dependency": return display.nodeLabel(value);
  }
}

function fixedValues(dimension: FilterDimension): readonly string[] {
  switch (dimension) {
    case "taskStatus": return TASK_STATUS_FILTER_VALUES;
    case "goalStatus": return GOAL_STATUS_VALUES;
    case "projectStatus": return PROJECT_STATUS_VALUES;
    case "verdict": return VERDICT_FILTER_VALUES;
    case "scopeState": return SCOPE_STATE_VALUES;
    case "blocked":
    case "agentic":
    case "asynchronous":
    case "private": return [YES_VALUE[dimension]];
    case "tag":
    case "antecedent":
    case "dependency": return [];
  }
}

/** Resolves every filter dimension's names and values, for the Filter menu, the search and the chips. */
export function useFilterDimensions(): FilterDimensions {
  const { t } = useTranslation("filter");
  const display = useFilterDisplay();
  const privateLabel = (value: string) =>
    (value === NO_VALUE.private ? t("privateState.not_private") : t("privateState.private"));
  const label = (dimension: FilterDimension, value: string) => fixedLabel(display, privateLabel, dimension, value);

  const tagOptions = useMemo<FilterOption[]>(
    () => display.tagOptions.map((tag) => ({ value: String(tag.id), label: tag.label, color: tag.color, detail: null })),
    [display.tagOptions],
  );
  const antecedentOptions = useMemo<FilterOption[]>(
    () => display.antecedentPool.map((node) => ({ value: node.id, label: node.label, color: node.color, detail: node.path })),
    [display.antecedentPool],
  );
  const dependencyOptions = useMemo<FilterOption[]>(
    () => display.dependencyPool.map((node) => ({ value: node.id, label: node.label, color: node.color, detail: node.path })),
    [display.dependencyPool],
  );

  function valueColor(dimension: FilterDimension, value: string): string | null {
    if (dimension === "tag") return display.tagColor(Number.parseInt(value, 10));
    if (dimension === "antecedent" || dimension === "dependency") return display.nodeColor(value);
    return null;
  }

  return {
    rowLabel: (row) => t(`rows.${row}`),
    groupLabel: (row) => t(`groups.${row}`),
    aliases: (row) => {
      if (row === "antecedent" || row === "dependency") return [t(`aliases.${row}`)];
      return [];
    },
    options: (dimension) => {
      if (dimension === "tag") return tagOptions;
      if (dimension === "antecedent") return antecedentOptions;
      if (dimension === "dependency") return dependencyOptions;
      return fixedValues(dimension).map((value) => ({ value, label: label(dimension, value), color: null, detail: null }));
    },
    valueLabel: (dimension, value, mode) => {
      if (isYesNoDimension(dimension) && mode === "exclude") return label(dimension, NO_VALUE[dimension]);
      return label(dimension, value);
    },
    valueColor,
  };
}
