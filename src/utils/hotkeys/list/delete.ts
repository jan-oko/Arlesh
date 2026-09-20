import type { Binding } from "@/utils/hotkeys/chord";
import type { ListSelectionContext } from "./selection";

/** What deleting acts on. */
export interface ListDeleteContext extends ListSelectionContext {
  /** Raises the delete confirmation for the selected row. */
  onDelete: (id: string) => void;
}

export const LIST_DELETE_BINDINGS: readonly Binding<ListDeleteContext>[] = [
  {
    // The Mindmap's chord, acting on the one thing a flat list can have selected. A Task or a
    // Commitment alike: both are real rows, and both are deletable there. The confirmation, the
    // subtree cascade and the writer behind it are all the Mindmap's, so `Delete` cannot come to
    // mean two different things depending on which view you pressed it in.
    id: "listView.delete", section: "listView", chord: { code: "Delete" },
    labelKey: "delete", allowRepeat: false,
    when: (c) => c.selectedRowId !== null,
    run: (c) => { if (c.selectedRowId !== null) c.onDelete(c.selectedRowId); },
  },
];
