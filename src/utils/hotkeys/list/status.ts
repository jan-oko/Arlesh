import type { Binding } from "@/utils/hotkeys/chord";
import type { ListSelectionContext } from "./selection";

/** What cycling a row's status acts on. */
export interface ListStatusContext extends ListSelectionContext {
  /** Whether the selected row is currently blocked (and not a Habit instance) — gates Enter. */
  isSelectedBlocked: boolean;
  onCycleStatus: (id: string) => void;
}

export const LIST_STATUS_BINDINGS: readonly Binding<ListStatusContext>[] = [
  {
    // Shares Enter with `listView.cycleVerdict`, and the two cannot both fire: a selection is a
    // Task or a Commitment, never both, so at most one of the two guards is ever true. See
    // chord-sharing.test.ts, which declares the pair and pins that it stays complementary.
    id: "listView.cycleStatus", section: "listView", chord: { code: "Enter" },
    labelKey: "cycleRowStatus",
    when: (c) => c.selectedTaskId !== null && !c.isSelectedBlocked,
    run: (c) => { if (c.selectedTaskId !== null) c.onCycleStatus(c.selectedTaskId); },
  },
];
