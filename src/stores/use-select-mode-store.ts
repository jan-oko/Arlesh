import { create } from "zustand";

interface SelectModeStore {
  /** While on, a tap adds a node to the selection or takes it out, rather than selecting it alone. */
  active: boolean;
  toggle: () => void;
  stop: () => void;
}

/**
 * The palette's **Select** toggle (`docs/spec/touch.md`): building a multi-selection by tapping,
 * where a keyboard would hold Ctrl. App-wide and ephemeral, like the palette that switches it.
 */
export const useSelectModeStore = create<SelectModeStore>()((set) => ({
  active: false,
  toggle: () => set((state) => ({ active: !state.active })),
  stop: () => set({ active: false }),
}));
