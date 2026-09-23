import type { Binding } from "@/utils/hotkeys/chord";
import type { StepsSelectionContext } from "./selection";
import { hasSelection } from "./selection";

/** What the board-alone binding acts on. */
export interface StepsFullscreenContext extends StepsSelectionContext {
  onToggleFullscreen: () => void;
}

export const STEPS_FULLSCREEN_BINDINGS: readonly Binding<StepsFullscreenContext>[] = [
  {
    // Bare F shows the board alone, gated on nothing being selected — the same guard the other
    // three views carry, so one gesture does not mean two things depending on which view you are
    // in. It asks `hasSelection` rather than "is a node selected", because the board's own header
    // card is a selection with no node behind it and `F` must not fire through it.
    id: "stepsView.toggleFullscreen", section: "stepsView", chord: { code: "KeyF" },
    labelKey: "toggleFullscreen",
    when: (c) => !hasSelection(c),
    run: (c) => c.onToggleFullscreen(),
  },
];
