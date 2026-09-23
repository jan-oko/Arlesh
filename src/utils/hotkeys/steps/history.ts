import type { Binding } from "@/utils/hotkeys/chord";

/** What the undo stack acts on. */
export interface StepsHistoryContext {
  onUndo: () => void;
  onRedo: () => void;
}

export const STEPS_HISTORY_BINDINGS: readonly Binding<StepsHistoryContext>[] = [
  {
    id: "stepsView.undo", section: "stepsView", chord: { code: "KeyZ", ctrl: true },
    labelKey: "undo", allowRepeat: false, run: (c) => c.onUndo(),
  },
  {
    id: "stepsView.redo", section: "stepsView", chord: { code: "KeyZ", ctrl: true, shift: true },
    labelKey: "redo", allowRepeat: false, run: (c) => c.onRedo(),
  },
  {
    // The other redo the world uses. Hidden because the sheet already lists Ctrl+Shift+Z.
    id: "stepsView.redoAlias", section: "stepsView", chord: { code: "KeyY", ctrl: true },
    labelKey: "redo", hidden: true, allowRepeat: false, run: (c) => c.onRedo(),
  },
];
