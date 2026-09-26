import type { View } from "@/stores/use-view-store";
import type { FilterDimension } from "@/utils/filter-modes";
import { YES_NO_DIMENSIONS } from "@/utils/filter-modes";

/**
 * One labelled row of the Filter menu: a single dimension, or the **Yes / no** row that carries one
 * pill for each of the yes/no dimensions (Blocked, Agentic, Asynchronous).
 */
export type FilterRowId = FilterDimension | "yesNo";

/** The dimensions a row adds to, in the order its pills are drawn. */
export function rowDimensions(row: FilterRowId): readonly FilterDimension[] {
  if (row === "yesNo") return YES_NO_DIMENSIONS;
  return [row];
}

/** The dimensions whose values are nodes or tags, searched through a box in their row rather than
 * listed as pills: there are too many to list. */
const SEARCHED: ReadonlySet<FilterDimension> = new Set<FilterDimension>(["tag", "antecedent", "dependency"]);

export function isSearchedDimension(dimension: FilterDimension): boolean {
  return SEARCHED.has(dimension);
}

/** The List View's rows, grouped without titles: where a row sits, then what state it is in, then
 * which status it has. */
const LIST_ROWS: readonly (readonly FilterRowId[])[] = [
  ["antecedent", "tag", "dependency"],
  ["scopeState", "yesNo"],
  ["taskStatus", "goalStatus", "projectStatus", "verdict"],
];

/** Every other view filters on tags alone below the switches. */
const TAG_ROWS: readonly (readonly FilterRowId[])[] = [["tag"]];

/**
 * The Filter menu's dimension rows for a view, as groups separated by a thin rule. The List View
 * has its own pill dimensions; the Mindmap, Steps and Plan views filter by tag.
 */
export function filterMenuRows(view: View): readonly (readonly FilterRowId[])[] {
  return view === "list" ? LIST_ROWS : TAG_ROWS;
}

/** The tri-state and on/off filters every view carries in its switch block. */
export type FilterSwitch = "private" | "archived" | "backlog";

/**
 * The switches a view offers. The Plan View leaves out **Backlog**: it answers that question with a
 * switch of its own, which overrides the shared pill, so the pill would be a control that did
 * nothing there.
 */
export function filterSwitchesFor(view: View): readonly FilterSwitch[] {
  if (view === "plan") return ["private", "archived"];
  return ["private", "archived", "backlog"];
}
