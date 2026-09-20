import type { Binding } from "@/utils/hotkeys/chord";
import type { ListSelectionContext } from "./selection";

/** What opening the editor acts on. */
export interface ListEditorContext extends ListSelectionContext {
  onOpenEditor: (id: string) => void;
}

export const LIST_EDITOR_BINDINGS: readonly Binding<ListEditorContext>[] = [
  {
    id: "listView.openEditor", section: "listView", chord: { code: "KeyE" },
    labelKey: "openEditor",
    when: (c) => c.selectedRowId !== null,
    run: (c) => { if (c.selectedRowId !== null) c.onOpenEditor(c.selectedRowId); },
  },
];
