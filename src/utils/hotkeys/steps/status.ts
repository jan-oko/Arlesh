import type { Binding } from "@/utils/hotkeys/chord";
import type { StepsSelectionContext } from "./selection";
import { hasSelection, withNode } from "./selection";

/** What cycling the selected card's status acts on. */
export interface StepsStatusContext extends StepsSelectionContext {
  onCycleStatus: (id: string) => void;
  /** Whether the selected card is a blocked node — gates `Alt+Enter`, as in every other view. */
  isSelectedBlocked: boolean;
  /** Sets the selected Task Started, or resumes a Started one to In Progress. */
  onToggleStarted: (id: string) => void;
}

/**
 * `Space` cycles the selected card's status.
 *
 * Not `Enter`, which every other view uses for this: in Steps `Enter` descends, and descending is
 * the gesture this whole view is built around. `Space` is the next most obvious "act on the thing
 * under the cursor" key, it is bound nowhere else, and it reads as a toggle rather than a move.
 *
 * The handler is the Mindmap's own, so a Goal toggles achieved, a Task cycles todo → in progress →
 * done, and a Habit occurrence goes through the completion guard exactly as it does there.
 */
export const STEPS_STATUS_BINDINGS: readonly Binding<StepsStatusContext>[] = [
  {
    id: "stepsView.cycleStatus", section: "stepsView", chord: { code: "Space" },
    labelKey: "stepsCycleStatus",
    when: (c) => hasSelection(c),
    run: (c) => withNode(c, c.onCycleStatus),
  },
  {
    // `Alt+Enter` sets Started here too — the same chord as the other views, since plain `Enter`
    // descending is no reason to move the modified one. Only a Task takes it; the handler leaves
    // any other kind alone.
    id: "stepsView.toggleStarted", section: "stepsView", chord: { code: "Enter", alt: true },
    labelKey: "toggleStarted",
    when: (c) => hasSelection(c) && !c.isSelectedBlocked,
    run: (c) => withNode(c, c.onToggleStarted),
  },
];
