import type { Binding } from "@/utils/hotkeys/chord";
import type { ListSelectionContext } from "./selection";

/** What the quick Plan picker acts on. */
export interface ListPlanContext extends ListSelectionContext {
  /** Opens the Plan picker at the selected row. */
  onQuickPlan: (ids: readonly string[]) => void;
}

export const LIST_PLAN_BINDINGS: readonly Binding<ListPlanContext>[] = [
  {
    // The Mindmap's `P`. Any selected row: a Commitment or an Expectation holds no Plan, and the
    // handler says so rather than the key going quiet.
    id: "listView.quickPlan", section: "listView", chord: { code: "KeyP" },
    labelKey: "quickPlan",
    allowRepeat: false,
    when: (c) => c.selectedRowId !== null,
    run: (c) => { if (c.selectedRowId !== null) c.onQuickPlan([c.selectedRowId]); },
  },
];
