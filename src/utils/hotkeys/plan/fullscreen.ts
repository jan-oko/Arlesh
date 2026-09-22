import type { Binding } from "@/utils/hotkeys/chord";
import type { PlanSelectionContext } from "./selection";

/** What the board-alone binding acts on. */
export interface PlanFullscreenContext extends PlanSelectionContext {
  onToggleFullscreen: () => void;
}

export const PLAN_FULLSCREEN_BINDINGS: readonly Binding<PlanFullscreenContext>[] = [
  {
    // Bare F shows the board alone, gated on nothing being selected — the same guard the other two
    // views carry, so one gesture does not mean two things depending on which view you are in.
    id: "planView.toggleFullscreen", section: "planView", chord: { code: "KeyF" },
    labelKey: "toggleFullscreen",
    when: (c) => c.selectedTaskId === null,
    run: (c) => c.onToggleFullscreen(),
  },
];
