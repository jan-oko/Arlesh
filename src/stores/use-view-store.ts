import { createStore, type StoreApi } from "zustand";
import { tabStoreHook } from "@/stores/tab-stores-context";
import type { Orientation } from "@/utils/tree-layout";
import type { ViewKind } from "@/utils/scope-calendar";
import type { StepsZoom } from "@/utils/steps-grid";
import { DEFAULT_STEPS_ZOOM } from "@/utils/steps-grid";

/**
 * Which of the board's surfaces a tab is showing.
 *
 * Adding one is a union member plus a chord — deliberately, because the alternative considered was
 * an ordered cycle, and a cycle makes every view's shortcut depend on how many other views exist.
 */
export type View = "mindmap" | "list" | "plan" | "steps";

/** Every view, in the order the top bar draws them and the cheat-sheet lists them. */
export const ALL_VIEWS: readonly View[] = ["mindmap", "list", "plan", "steps"];

/** Type guard for a stored or selected view. */
export function isView(value: string): value is View {
  return ALL_VIEWS.some((view) => view === value);
}

/** The persisted half: which view a tab shows, how its mindmap branches grow, and which scope kind
 * its Plan pass fills. */
export interface ViewState {
  view: View;
  /** Axis the mindmap's branches grow along. */
  mindmapOrientation: Orientation;
  /**
   * The scope kind the Plan View fills. The *kind* is remembered and the place in the calendar is
   * not: a pass reopens on the current scope of the kind you last filled, because "the week I last
   * filled" is a stale week by the next morning.
   */
  planScopeKind: ViewKind;
  /**
   * How big a Steps card is drawn, and therefore how many fit on one Step's page.
   *
   * Per tab, like the Mindmap's branch axis and for the same reason: one tab walking a wide branch
   * wants small cards while another reads a Task's fields at full size. The *page* is not stored
   * beside it — it is derived from this and the viewport, so the two can never contradict each
   * other across a window resize.
   */
  stepsZoom: StepsZoom;
}

export interface ViewStore extends ViewState {
  setView: (view: View) => void;
  toggleMindmapOrientation: () => void;
  setPlanScopeKind: (kind: ViewKind) => void;
  setStepsZoom: (zoom: StepsZoom) => void;
}

export const DEFAULT_VIEW_STATE: ViewState = {
  view: "mindmap",
  mindmapOrientation: "horizontal",
  planScopeKind: "week",
  stepsZoom: DEFAULT_STEPS_ZOOM,
};

/**
 * How **one tab** is displayed — which view, the mindmap's branch axis, and the Plan View's scope
 * kind. Per tab, so a list you are working through stays a list while another tab holds a wide
 * subtree turned vertical.
 *
 * `ViewState` is deliberately **flat**, which is what keeps it clear of the rehydration trap
 * `mergePersistedFilterSlice` exists for: a field added after a user already has stored state is
 * simply absent from their blob, and `readPersistedViewState` backfills it from the defaults
 * field-by-field rather than letting a stored object replace the defaults wholesale.
 *
 * App-wide display preferences do **not** live here — see `use-display-store` for those.
 */
export function createViewStore(seed: ViewState = DEFAULT_VIEW_STATE): StoreApi<ViewStore> {
  return createStore<ViewStore>()((set) => ({
    ...seed,
    setView: (view) => set({ view }),
    toggleMindmapOrientation: () =>
      set((s) => ({ mindmapOrientation: s.mindmapOrientation === "horizontal" ? "vertical" : "horizontal" })),
    setPlanScopeKind: (planScopeKind) => set({ planScopeKind }),
    setStepsZoom: (stepsZoom) => set({ stepsZoom }),
  }));
}

export const useViewStore = tabStoreHook<ViewStore>((stores) => stores.view);
