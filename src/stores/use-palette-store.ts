import { create } from "zustand";

interface PaletteStore {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

/**
 * Whether the command palette is showing. A store because the action bar's More, the ☰ menu and a
 * long-press on a node all open it. Ephemeral — nothing to restore across a reload.
 */
export const usePaletteStore = create<PaletteStore>()((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
