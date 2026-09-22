import type { StoreApi } from "zustand";
import type { FilterState } from "@/utils/filter-tree";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import type { ListFilterState } from "@/utils/list-filter";
import { DEFAULT_LIST_FILTER } from "@/utils/list-filter";
import { createViewStore, DEFAULT_VIEW_STATE, type ViewState, type ViewStore } from "@/stores/use-view-store";
import { createFilterStore, type FilterStore } from "@/stores/use-filter-store";
import { createListFilterStore, type ListFilterStore } from "@/stores/use-list-filter-store";
import { createMindmapStore, type MindmapStore } from "@/stores/use-mindmap-store";
import { createPanZoomStore, type PanZoomStore } from "@/stores/use-pan-zoom-store";

/**
 * One tab's own instances of every per-tab store. Two tabs hold two of these and share none of
 * them, which is the whole of the isolation guarantee: a filter set in one cannot reach the other.
 */
export interface TabStores {
  view: StoreApi<ViewStore>;
  filter: StoreApi<FilterStore>;
  listFilter: StoreApi<ListFilterStore>;
  mindmap: StoreApi<MindmapStore>;
  panZoom: StoreApi<PanZoomStore>;
}

/**
 * The part of a tab worth restoring: where it is rooted, how it is displayed, both its filter sets,
 * and the folded Habit histories it has opened. Selection, collapsed nodes and pan/zoom are
 * excluded on purpose — they are working state, and coming back to a stale selection is worse than
 * coming back to none.
 *
 * An opened Habit history is not working state in that sense, which is why it is here and an
 * ordinary collapsed node is not: collapsing a node hides something the app was showing you, and
 * forgetting it merely shows it again, while a run of passed iterations is folded on *every* load —
 * forgetting an expansion would silently undo the only thing that gets it open.
 */
export interface TabState {
  subtreeRootId: string | null;
  view: ViewState;
  filter: FilterState;
  listFilter: ListFilterState;
  expandedHabitGroupIds: string[];
}

export const DEFAULT_TAB_STATE: TabState = {
  subtreeRootId: null,
  view: DEFAULT_VIEW_STATE,
  filter: DEFAULT_FILTER,
  listFilter: DEFAULT_LIST_FILTER,
  expandedHabitGroupIds: [],
};

/** Fresh stores for a tab, seeded from restored (or default) state. */
export function createTabStores(state: TabState = DEFAULT_TAB_STATE): TabStores {
  return {
    view: createViewStore(state.view),
    filter: createFilterStore(state.filter),
    listFilter: createListFilterStore(state.listFilter),
    mindmap: createMindmapStore(state.subtreeRootId, new Set(state.expandedHabitGroupIds)),
    panZoom: createPanZoomStore(),
  };
}

/** What to write down for a tab, read straight off its live stores. */
export function readTabState(stores: TabStores): TabState {
  const { view, mindmapOrientation, planScopeKind } = stores.view.getState();
  return {
    subtreeRootId: stores.mindmap.getState().subtreeRootId,
    view: { view, mindmapOrientation, planScopeKind },
    filter: stores.filter.getState().filter,
    listFilter: stores.listFilter.getState().filter,
    expandedHabitGroupIds: [...stores.mindmap.getState().expandedHabitGroupIds],
  };
}
