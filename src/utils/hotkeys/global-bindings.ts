import type { Binding } from "./chord";
import type { View } from "@/stores/use-view-store";

/** What the app-level bindings act on. */
export interface GlobalContext {
  onSetView: (view: View) => void;
  onToggleHotkeys: () => void;
  onToggleFullscreen: () => void;
  onQuit: () => void;
}

/**
 * Bindings that apply everywhere, regardless of which view is showing.
 *
 * **One chord per view, not a cycle.** `Alt+L` used to toggle Mindmap ↔ List; with a third view it
 * would have had to become "next view", quietly turning an existing reflex into something else, and
 * a fourth view would have made the cycle order one more thing to learn. Each view is instead one
 * press from any other, and `Alt+L` still means List — which is what it has always meant.
 *
 * The Plan View has **no chord yet**: `Alt+P` is the Plan status preset and `Alt+S` the Start one,
 * in both view tables, so the chords the switcher was specified with are already spoken for. Moving
 * a preset off its letter is a decision about an existing reflex, and this is not the change that
 * gets to make it — see `docs/spec/plan-view.md`.
 */
export const GLOBAL_BINDINGS: readonly Binding<GlobalContext>[] = [
  {
    id: "global.viewMindmap",
    section: "global",
    chord: { code: "KeyM", alt: true },
    labelKey: "viewMindmap",
    run: (c) => c.onSetView("mindmap"),
  },
  {
    id: "global.viewList",
    section: "global",
    chord: { code: "KeyL", alt: true },
    labelKey: "viewList",
    run: (c) => c.onSetView("list"),
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
    id: "global.toggleHotkeys",
    section: "global",
    chord: { code: "Slash", ctrl: true, shift: true },
    labelKey: "toggleHotkeys",
    run: (c) => c.onToggleHotkeys(),
  },
];
