import { createStore, type StoreApi } from "zustand";
import { tabStoreHook } from "@/stores/tab-stores-context";
import type { Orientation } from "@/utils/tree-layout";

export type View = "mindmap" | "list";

/** The persisted half: which view a tab shows, and how its mindmap branches grow. */
export interface ViewState {
  view: View;
  /** Axis the mindmap's branches grow along. */
  mindmapOrientation: Orientation;
}

export interface ViewStore extends ViewState {
  setView: (view: View) => void;
  toggleView: () => void;
  toggleMindmapOrientation: () => void;
}

export const DEFAULT_VIEW_STATE: ViewState = { view: "mindmap", mindmapOrientation: "horizontal" };

/**
 * How **one tab** is displayed — Mindmap or List, and the mindmap's branch axis. Per tab, so a list
 * you are working through stays a list while another tab holds a wide subtree turned vertical.
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
    toggleView: () => set((s) => ({ view: s.view === "mindmap" ? "list" : "mindmap" })),
    toggleMindmapOrientation: () =>
      set((s) => ({ mindmapOrientation: s.mindmapOrientation === "horizontal" ? "vertical" : "horizontal" })),
  }));
}

export const useViewStore = tabStoreHook<ViewStore>((stores) => stores.view);
