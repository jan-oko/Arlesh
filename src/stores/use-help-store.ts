import { create } from "zustand";

interface HelpStore {
  isOpen: boolean;
  show: () => void;
  toggle: () => void;
  close: () => void;
}

/**
 * Whether the Help view is showing. It lives in a store because several things open it — F1, the
 * Settings modal and the phone's ☰ menu. Help is drawn over the tab, which stays mounted beneath
 * it, so closing it returns to the view exactly as it was. Ephemeral: nothing to restore.
 */
export const useHelpStore = create<HelpStore>()((set) => ({
  isOpen: false,
  show: () => set({ isOpen: true }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  close: () => set({ isOpen: false }),
}));
