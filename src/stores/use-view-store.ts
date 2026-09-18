import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Orientation } from "@/utils/tree-layout";

export type View = "mindmap" | "list";

interface ViewStore {
  view: View;
  /** Axis the mindmap's branches grow along. */
  mindmapOrientation: Orientation;
  /** Whether a List View path header opens with its nearest ancestor's kind glyph. Default on. */
  pathHeaderIcons: boolean;
  setView: (view: View) => void;
  toggleView: () => void;
  toggleMindmapOrientation: () => void;
  togglePathHeaderIcons: () => void;
}

/**
 * How the app is displayed — which top-level view (Mindmap or List), and the per-view display
 * preferences the settings popover offers for it: the mindmap's branch axis, and the List View's
 * path-header glyphs. Persisted so the app reopens the way you left it.
 *
 * Every preference here is a **top-level** field, which is what keeps this store clear of the
 * rehydration trap `mergePersistedFilterSlice` exists for: zustand's default merge shallow-spreads
 * `{ ...currentState, ...persistedState }` at exactly this level, so a field added after a user
 * already has stored state is simply absent from their blob and keeps its default. The filter
 * stores need the helper because they partialize to a nested `{ filter: ... }` slice, which that
 * same spread replaces wholesale.
 */
export const useViewStore = create<ViewStore>()(
  persist(
    (set) => ({
      view: "mindmap",
      mindmapOrientation: "horizontal",
      pathHeaderIcons: true,
      setView: (view) => set({ view }),
      toggleView: () => set((s) => ({ view: s.view === "mindmap" ? "list" : "mindmap" })),
      toggleMindmapOrientation: () =>
        set((s) => ({ mindmapOrientation: s.mindmapOrientation === "horizontal" ? "vertical" : "horizontal" })),
      togglePathHeaderIcons: () => set((s) => ({ pathHeaderIcons: !s.pathHeaderIcons })),
    }),
    { name: "arlesh-view" },
  ),
);
