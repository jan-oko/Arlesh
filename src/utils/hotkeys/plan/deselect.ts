import type { Binding } from "@/utils/hotkeys/chord";
import type { PlanSelectionContext } from "./selection";

/** What clearing the selection acts on. */
export interface PlanDeselectContext extends PlanSelectionContext {
  onDeselect: () => void;
}

export const PLAN_DESELECT_BINDINGS: readonly Binding<PlanDeselectContext>[] = [
  {
    id: "planView.deselect", section: "planView", chord: { code: "Escape" },
    labelKey: "deselect",
    when: (c) => c.selectedTaskId !== null,
    run: (c) => c.onDeselect(),
  },
];
