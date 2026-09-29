import type { View } from "@/stores/use-view-store";
import type { FilterDimension, YesNoDimension } from "@/utils/filter-modes";
import { YES_NO_DIMENSIONS } from "@/utils/filter-modes";
import { LIST_ROW_KINDS } from "@/utils/list-filter";
import type { ListRowKind } from "@/utils/list-filter";

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

/**
 * The dimensions a row offers right now: the **Private** yes/no pill only while Private Mode is on,
 * since with it off every private row is hidden already (and turning it off removes the pill).
 */
export function offeredDimensions(row: FilterRowId, privateMode: boolean): readonly FilterDimension[] {
  return rowDimensions(row).filter((dimension) => privateMode || dimension !== "private");
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

/** The Zen View filters by tag, and by the one List View pill it reads: Agentic. */
const ZEN_ROWS: readonly (readonly FilterRowId[])[] = [["tag"], ["agentic"]];

/**
 * The Filter menu's dimension rows for a view, as groups separated by a thin rule. The List View
 * has its own pill dimensions; the Zen View tags and Agentic; the Mindmap, Steps and Plan views
 * filter by tag.
 */
export function filterMenuRows(view: View): readonly (readonly FilterRowId[])[] {
  if (view === "list") return LIST_ROWS;
  if (view === "zen") return ZEN_ROWS;
  return TAG_ROWS;
}

/** The Zen View's strips, as the row kinds they draw. Tasks are its grid and always shown. */
const ZEN_ROW_KINDS: readonly ListRowKind[] = ["commitment", "expectation"];

/**
 * The row kinds a view's Filter menu switches at the top of its switch block — the List View's
 * three, and the Zen View's two strips (on the Zen View's own per-tab toggles) — or none.
 */
export function rowKindsFor(view: View): readonly ListRowKind[] {
  if (view === "list") return LIST_ROW_KINDS;
  if (view === "zen") return ZEN_ROW_KINDS;
  return [];
}

/** The yes/no flags a view offers as pills (and as Filter-menu letters): all of them in the List
 * View, Agentic alone in the Zen View, none elsewhere. */
export function flagsFor(view: View): readonly YesNoDimension[] {
  if (view === "list") return YES_NO_DIMENSIONS;
  if (view === "zen") return ["agentic"];
  return [];
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
