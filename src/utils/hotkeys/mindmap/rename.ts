import type { Binding } from "@/utils/hotkeys/chord";
import type { MindmapSelectionContext } from "./selection";
import { selectedKindIsNot } from "./selection";

/** What renaming acts on. */
export interface MindmapRenameContext extends MindmapSelectionContext {
  onStartRename: (id: string) => void;
}

export const MINDMAP_RENAME_BINDINGS: readonly Binding<MindmapRenameContext>[] = [
  {
    id: "mindmap.renameF2", section: "mindmap", chord: { code: "F2" },
    labelKey: "rename",
    when: selectedKindIsNot("aspect"),
    run: (c) => { if (c.selectedNodeId !== null) c.onStartRename(c.selectedNodeId); },
  },
  {
    id: "mindmap.rename", section: "mindmap", chord: { code: "KeyR" },
    labelKey: "rename",
    when: selectedKindIsNot("aspect"),
    run: (c) => { if (c.selectedNodeId !== null) c.onStartRename(c.selectedNodeId); },
  },
];
