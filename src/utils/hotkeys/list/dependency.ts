import type { Binding } from "@/utils/hotkeys/chord";
import type { ListSelectionContext } from "./selection";

/** What the quick dependency picker acts on. */
export interface ListDependencyContext extends ListSelectionContext {
  /** Opens the dependency picker at the selected row. */
  onQuickDependency: (ids: readonly string[]) => void;
}

export const LIST_DEPENDENCY_BINDINGS: readonly Binding<ListDependencyContext>[] = [
  {
    // The Mindmap's `D`. Any selected row: a Commitment or an Expectation depends on nothing, and
    // the handler says so rather than the key going quiet.
    id: "listView.quickDependency", section: "listView", chord: { code: "KeyD" },
    labelKey: "quickDependency",
    allowRepeat: false,
    when: (c) => c.selectedRowId !== null,
    run: (c) => { if (c.selectedRowId !== null) c.onQuickDependency([c.selectedRowId]); },
  },
];
