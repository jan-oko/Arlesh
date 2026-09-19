import type { Binding } from "./chord";

/** What the app-level bindings act on. */
export interface GlobalContext {
  onToggleView: () => void;
  onToggleHotkeys: () => void;
  onToggleFullscreen: () => void;
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
    id: "global.toggleHotkeys",
    section: "global",
    chord: { code: "Slash", ctrl: true, shift: true },
    labelKey: "toggleHotkeys",
    run: (c) => c.onToggleHotkeys(),
  },
];
