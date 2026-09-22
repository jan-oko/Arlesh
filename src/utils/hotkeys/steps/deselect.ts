import type { Binding } from "@/utils/hotkeys/chord";
import type { StepsSelectionContext } from "./selection";
import { hasSelection } from "./selection";

/** What clearing the selection acts on. */
export interface StepsDeselectContext extends StepsSelectionContext {
  onDeselect: () => void;
}

export const STEPS_DESELECT_BINDINGS: readonly Binding<StepsDeselectContext>[] = [
  {
    // Bare Escape, and only bare: the two modified Escapes leave the *subtree*, which is the tab's
    // and not this view's, and are declared once in the global table.
    id: "stepsView.deselect", section: "stepsView", chord: { code: "Escape" },
    labelKey: "deselect",
    when: (c) => hasSelection(c),
    run: (c) => c.onDeselect(),
  },
];
