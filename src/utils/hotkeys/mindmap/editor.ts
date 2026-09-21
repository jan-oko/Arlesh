import type { Binding } from "@/utils/hotkeys/chord";
import type { MindmapSelectionContext } from "./selection";
import { selectedKindIsNot } from "./selection";

/** What opening the editor acts on. */
export interface MindmapEditorContext extends MindmapSelectionContext {
  onOpenEditor: (id: string) => void;
}

export const MINDMAP_EDITOR_BINDINGS: readonly Binding<MindmapEditorContext>[] = [
  {
    id: "mindmap.openEditor", section: "mindmap", chord: { code: "KeyE" },
    labelKey: "openEditor",
    when: selectedKindIsNot("aspect"),
    run: (c) => { if (c.selectedNodeId !== null) c.onOpenEditor(c.selectedNodeId); },
  },
];
