import type { Binding } from "@/utils/hotkeys/chord";
import type { StepsSelectionContext } from "./selection";
import { hasSelection, withNode } from "./selection";

/** What the two Expectation gestures act on. */
export interface StepsExpectationContext extends StepsSelectionContext {
  /** Completes the check on the selected wait or its check task: clears the check-by. */
  onCompleteCheck: (id: string) => void;
  /** Releases the selected wait, or takes the release back. */
  onToggleRelease: (id: string) => void;
}

/**
 * The Mindmap's and the List View's keys for a wait: `D` ("done checking") and `L` ("reLease"),
 * both bare and free here. A card that is not a wait is turned away by the handler, out loud, as
 * the flag keys beside them turn away a card that is not a Task.
 */
export const STEPS_EXPECTATION_BINDINGS: readonly Binding<StepsExpectationContext>[] = [
  {
    id: "stepsView.completeCheck", section: "stepsView", chord: { code: "KeyD" },
    labelKey: "completeCheck",
    when: (c) => hasSelection(c),
    run: (c) => withNode(c, c.onCompleteCheck),
  },
  {
    id: "stepsView.toggleRelease", section: "stepsView", chord: { code: "KeyL" },
    labelKey: "toggleRelease",
    when: (c) => hasSelection(c),
    run: (c) => withNode(c, c.onToggleRelease),
  },
];
