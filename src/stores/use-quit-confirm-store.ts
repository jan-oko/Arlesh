import { create } from "zustand";

interface QuitConfirmStore {
  isOpen: boolean;
  show: () => void;
  hide: () => void;
}

/**
 * Whether the "Quit Arlesh?" prompt is up. Android's back at the board's root asks it instead of
 * leaving at once. Not persisted: a prompt left open across a restart would be a trap.
 */
export const useQuitConfirmStore = create<QuitConfirmStore>()((set) => ({
  isOpen: false,
  show: () => set({ isOpen: true }),
  hide: () => set({ isOpen: false }),
}));
