import type { Binding } from "@/utils/hotkeys/chord";
import type { ListSelectionContext } from "./selection";

/** What cycling a row's status acts on. */
export interface ListStatusContext extends ListSelectionContext {
  /** Whether the selected row is currently blocked (and not a Habit instance) — gates Enter. */
  isSelectedBlocked: boolean;
  onCycleStatus: (id: string) => void;
  /** Sets the selected Task Started, or resumes a Started one to In Progress. */
  onToggleStarted: (id: string) => void;
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
  {
    // Started: To Do or Done → Started, and In Progress ↔ Started (pause / resume). Gated on
    // blocking exactly as Enter is, since starting blocked work is what the block forbids. The
    // Filter menu's own Alt+Enter (add as Not) lives in the menu, which holds the keys while open.
    id: "listView.toggleStarted", section: "listView", chord: { code: "Enter", alt: true },
    labelKey: "toggleStarted",
    when: (c) => c.selectedTaskId !== null && !c.isSelectedBlocked,
    run: (c) => { if (c.selectedTaskId !== null) c.onToggleStarted(c.selectedTaskId); },
  },
];
