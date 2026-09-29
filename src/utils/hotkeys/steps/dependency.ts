import type { Binding } from "@/utils/hotkeys/chord";
import type { StepsSelectionContext } from "./selection";
import { hasSelection, withNode } from "./selection";

/** What the quick dependency picker acts on. */
export interface StepsDependencyContext extends StepsSelectionContext {
  /** Opens the dependency picker at the selected card. */
  onQuickDependency: (ids: readonly string[]) => void;
}

export const STEPS_DEPENDENCY_BINDINGS: readonly Binding<StepsDependencyContext>[] = [
  {
    // The Mindmap's `D`. A card that holds no dependencies — anything but a Task, a fold card, the
    // board — is refused out loud by the handler, as `P` is.
    id: "stepsView.quickDependency", section: "stepsView", chord: { code: "KeyD" },
    labelKey: "quickDependency",
    allowRepeat: false,
    when: hasSelection,
    run: (c) => withNode(c, (id) => c.onQuickDependency([id])),
  },
];
