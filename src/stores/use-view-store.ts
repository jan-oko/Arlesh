import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Orientation } from "@/utils/tree-layout";

export type View = "mindmap" | "list";

interface ViewStore {
  view: View;
  /** Axis the mindmap's branches grow along. */
  mindmapOrientation: Orientation;
  setView: (view: View) => void;
  toggleView: () => void;
  toggleMindmapOrientation: () => void;
}

/**
 * How the app is displayed — which top-level view (Mindmap or List) and, for the mindmap, which
 * branch axis. Persisted so the app reopens the way you left it.
 */
export const useViewStore = create<ViewStore>()(
  persist(
    (set) => ({
      view: "mindmap",
      mindmapOrientation: "horizontal",
      setView: (view) => set({ view }),
      toggleView: () => set((s) => ({ view: s.view === "mindmap" ? "list" : "mindmap" })),
      toggleMindmapOrientation: () =>
        set((s) => ({ mindmapOrientation: s.mindmapOrientation === "horizontal" ? "vertical" : "horizontal" })),
    }),
    { name: "arlesh-view" },
  ),
);
