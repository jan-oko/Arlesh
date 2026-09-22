import type { Binding } from "./chord";

/** What the app-level bindings act on. */
export interface GlobalContext {
  onToggleView: () => void;
  onToggleHotkeys: () => void;
  onToggleFullscreen: () => void;
  onQuit: () => void;
}

/** Bindings that apply everywhere, regardless of which view is showing. */
export const GLOBAL_BINDINGS: readonly Binding<GlobalContext>[] = [
  {
    id: "global.toggleView",
    section: "global",
    chord: { code: "KeyL", alt: true },
    labelKey: "toggleView",
    run: (c) => c.onToggleView(),
  },
  {
    // F11 is the key every app uses for this, and it is free here. The board-alone mode is also on
    // bare F when nothing is selected — declared per view, since only a view knows its selection.
    id: "global.toggleFullscreen",
    section: "global",
    chord: { code: "F11" },
    labelKey: "toggleFullscreen",
    run: (c) => c.onToggleFullscreen(),
  },
  {
    // Quitting has to be reachable without the mouse, because with close-to-tray on the close
    // button no longer does it. Ctrl+Q is where every desktop app puts this.
    id: "global.quit",
    section: "global",
    chord: { code: "KeyQ", ctrl: true },
    labelKey: "quitApp",
    allowRepeat: false,
    run: (c) => c.onQuit(),
  },
  {
    // Ctrl+Alt is unused everywhere else, so the sheet is reachable in any state — which is the
    // whole point of a cheat-sheet. It sits beside the Mindmap's Ctrl+Shift+/ recursive expand
    // without colliding with it, and, carrying no guard, it is also what closes the sheet again.
    id: "global.toggleHotkeys",
    section: "global",
    chord: { code: "Slash", ctrl: true, alt: true },
    labelKey: "toggleHotkeys",
    run: (c) => c.onToggleHotkeys(),
  },
];
