import { create } from "zustand";

interface FullscreenStore {
  isFullscreen: boolean;
  toggle: () => void;
}

/**
 * Whether the app is showing the board alone, with the tab strip and top bar hidden.
 *
 * App-wide rather than per tab, unlike the vertical-layout switch: it is a way of looking at the
 * app for a while, not a property of the place you are looking at, and hiding the strip in one tab
 * while another kept it would make switching tabs resize the board.
 *
 * Deliberately **not persisted**, unlike the theme. Reopening Arlesh with no chrome and no visible
 * way back is a bad first second, and there is nothing worth restoring — the mode costs one
 * keystroke to re-enter. The OS window is untouched: this hides the app's own chrome, so it works
 * just as well in a window as maximised.
 */
export const useFullscreenStore = create<FullscreenStore>()((set) => ({
  isFullscreen: false,
  toggle: () => set((s) => ({ isFullscreen: !s.isFullscreen })),
}));
