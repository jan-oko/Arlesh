import type { Binding } from "@/utils/hotkeys/chord";

/** What the undo stack acts on. */
export interface PlanHistoryContext {
  onUndo: () => void;
  onRedo: () => void;
}

export const PLAN_HISTORY_BINDINGS: readonly Binding<PlanHistoryContext>[] = [
  {
    id: "planView.undo", section: "planView", chord: { code: "KeyZ", ctrl: true },
    labelKey: "undo", allowRepeat: false, run: (c) => c.onUndo(),
  },
  {
    id: "planView.redo", section: "planView", chord: { code: "KeyZ", ctrl: true, shift: true },
    labelKey: "redo", allowRepeat: false, run: (c) => c.onRedo(),
  },
  {
    // The other redo the world uses. Hidden because the sheet already lists Ctrl+Shift+Z.
    id: "planView.redoAlias", section: "planView", chord: { code: "KeyY", ctrl: true },
    labelKey: "redo", hidden: true, allowRepeat: false, run: (c) => c.onRedo(),
  },
];
