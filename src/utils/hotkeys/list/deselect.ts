import type { Binding } from "@/utils/hotkeys/chord";
import type { ListSelectionContext } from "./selection";

/** What clearing the selection acts on. */
export interface ListDeselectContext extends ListSelectionContext {
  onDeselect: () => void;
}

export const LIST_DESELECT_BINDINGS: readonly Binding<ListDeselectContext>[] = [
  {
    id: "listView.deselect", section: "listView", chord: { code: "Escape" },
    labelKey: "deselect",
    when: (c) => c.selectedRowId !== null,
    run: (c) => c.onDeselect(),
  },
];
