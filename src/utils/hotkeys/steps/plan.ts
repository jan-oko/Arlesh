import type { Binding } from "@/utils/hotkeys/chord";
import type { StepsSelectionContext } from "./selection";
import { hasSelection, withNode } from "./selection";

/** What the quick Plan picker acts on. */
export interface StepsPlanContext extends StepsSelectionContext {
  /** Opens the Plan picker at the selected card. */
  onQuickPlan: (ids: readonly string[]) => void;
}

export const STEPS_PLAN_BINDINGS: readonly Binding<StepsPlanContext>[] = [
  {
    // The Mindmap's `P`. A card that holds no Plan — anything but a Task, a fold card, the board —
    // is refused out loud by the handler, as `B`/`A`/`W` are.
    id: "stepsView.quickPlan", section: "stepsView", chord: { code: "KeyP" },
    labelKey: "quickPlan",
    allowRepeat: false,
    when: hasSelection,
    run: (c) => withNode(c, (id) => c.onQuickPlan([id])),
  },
];
