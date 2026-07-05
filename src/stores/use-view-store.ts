import { create } from "zustand";
import { persist } from "zustand/middleware";

export type View = "mindmap" | "list";

interface ViewStore {
  view: View;
  setView: (view: View) => void;
  toggleView: () => void;
}

/** Which top-level view (Mindmap or List) is displayed; persisted so the app reopens where you left it. */
export const useViewStore = create<ViewStore>()(
  persist(
    (set) => ({
      view: "mindmap",
      setView: (view) => set({ view }),
      toggleView: () => set((s) => ({ view: s.view === "mindmap" ? "list" : "mindmap" })),
    }),
    { name: "arlesh-view" },
  ),
);
