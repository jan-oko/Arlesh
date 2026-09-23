import type { Binding } from "@/utils/hotkeys/chord";
import type { StepsSelectionContext } from "./selection";
import { hasSelection, withNode } from "./selection";

/**
 * What the Expectation binding acts on. Releasing a wait and completing a check have no keys of
 * their own: `Space` and the status control do both, as they advance any card's status.
 */
export interface StepsExpectationContext extends StepsSelectionContext {
  /** Opens the selected Task's editor at its Expectation section, with Asynchronous on. */
  onBindWait: (id: string) => void;
}

/** `Shift+W`, as on the Mindmap and the List View. A card that is not a Task is turned away out loud. */
export const STEPS_EXPECTATION_BINDINGS: readonly Binding<StepsExpectationContext>[] = [
  {
    id: "stepsView.bindWait", section: "stepsView", chord: { code: "KeyW", shift: true },
    labelKey: "bindWait", allowRepeat: false,
    when: (c) => hasSelection(c),
    run: (c) => withNode(c, c.onBindWait),
  },
];
