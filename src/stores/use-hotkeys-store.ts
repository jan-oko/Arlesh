import { create } from "zustand";

interface HotkeysStore {
  isOpen: boolean;
  toggle: () => void;
  close: () => void;
}

/**
 * Whether the keyboard cheat-sheet overlay is showing. Lives in a store rather than component state
 * because both the Ctrl+Alt+/ binding and the settings-popover entry drive it. Ephemeral — there
 * is nothing worth restoring across reloads.
 */
export const useHotkeysStore = create<HotkeysStore>()((set) => ({
  isOpen: false,
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  close: () => set({ isOpen: false }),
}));
