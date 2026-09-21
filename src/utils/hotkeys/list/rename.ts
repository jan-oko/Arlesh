import type { Binding } from "@/utils/hotkeys/chord";
import type { ListSelectionContext } from "./selection";

/** What renaming acts on. */
export interface ListRenameContext extends ListSelectionContext {
  onStartRename: (id: string) => void;
}

export const LIST_RENAME_BINDINGS: readonly Binding<ListRenameContext>[] = [
  {
    id: "listView.rename", section: "listView", chord: { code: "KeyR" },
    labelKey: "rename",
    when: (c) => c.selectedTaskId !== null,
    run: (c) => { if (c.selectedTaskId !== null) c.onStartRename(c.selectedTaskId); },
  },
];
