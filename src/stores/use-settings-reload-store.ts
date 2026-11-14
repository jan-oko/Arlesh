import { create } from "zustand";

/**
 * A counter that says "something Settings shows was changed behind its back" — an undo or a redo
 * made while the modal is open. A page that reads backend state re-reads when it moves.
 */
interface SettingsReloadStore {
  epoch: number;
  bump: () => void;
}

export const useSettingsReloadStore = create<SettingsReloadStore>()((set) => ({
  epoch: 0,
  bump: () => set((state) => ({ epoch: state.epoch + 1 })),
}));
