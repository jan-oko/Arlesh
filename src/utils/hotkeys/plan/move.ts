import type { Binding } from "@/utils/hotkeys/chord";
import type { PlanSelectionContext } from "./selection";

/** What planning a task into the scope — or taking it back out — acts on. */
export interface PlanMoveContext extends PlanSelectionContext {
  onMoveAcross: (id: string) => void;
}

/**
 * One chord for both directions, because the pane the selection is in already says which one is
 * meant: a candidate moves in, and something already in the scope moves out. A second chord would
 * only be a second way to ask the same question of a row that can only answer it one way.
 */
export const PLAN_MOVE_BINDINGS: readonly Binding<PlanMoveContext>[] = [
  {
    id: "planView.moveAcross", section: "planView", chord: { code: "Enter" },
    labelKey: "planMoveAcross", allowRepeat: false,
    when: (c) => c.selectedTaskId !== null,
    run: (c) => { if (c.selectedTaskId !== null) c.onMoveAcross(c.selectedTaskId); },
  },
];
