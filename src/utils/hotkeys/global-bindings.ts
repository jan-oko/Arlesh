import type { Binding } from "./chord";

/** What the app-level bindings act on. */
export interface GlobalContext {
  onToggleView: () => void;
  onToggleHotkeys: () => void;
  onToggleFullscreen: () => void;
  /**
   * Whether the Mindmap's recursive expand has a cell to act on, and therefore owns Ctrl+Shift+/
   * for this press. False while the cheat-sheet is open, since the same chord is what closes it.
   */
  isRecursiveExpandArmed: boolean;
}

/** What `isRecursiveExpandArmed` is decided from — the state the two guards have to agree about. */
export interface RecursiveExpandArming {
  /** Whether the Mindmap is the view on screen, and its binding table therefore mounted. */
  isMindmapOnScreen: boolean;
  /** The Mindmap's selection: what a recursive expand would act on. */
  selectedNodeId: string | null;
  /** Whether a modal or an inline editor has the keyboard — including the cheat-sheet itself. */
  isInputCaptured: boolean;
}

/**
 * Whether the Mindmap's recursive expand owns Ctrl+Shift+/ for this press: exactly when its own
 * binding table is live *and* has a cell to act on.
 *
 * It lives here, beside the guard that reads it, so the two halves of the shared chord cannot drift
 * apart — `chord-sharing.test.ts` proves them complementary through this one function.
 */
export function isRecursiveExpandArmed(arming: RecursiveExpandArming): boolean {
  return arming.isMindmapOnScreen && arming.selectedNodeId !== null && !arming.isInputCaptured;
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
    // Shared with the Mindmap's `toggleSubtreeCollapsed`, which takes the chord whenever a cell
    // is selected to act on. The two tables dispatch from separate listeners, so ADR 0003's
    // first-match rule cannot order them: the guards have to be complementary instead, and
    // `chord-sharing.test.ts` pins that they are.
    id: "global.toggleHotkeys",
    section: "global",
    chord: { code: "Slash", ctrl: true, shift: true },
    labelKey: "toggleHotkeys",
    when: (c) => !c.isRecursiveExpandArmed,
    run: (c) => c.onToggleHotkeys(),
  },
];
