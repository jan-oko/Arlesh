import type { Binding } from "@/utils/hotkeys/chord";
import type { MindmapSelectionContext } from "./selection";
import { hasSelection } from "./selection";

/** What deleting acts on. */
export interface MindmapDeleteContext extends MindmapSelectionContext {
  onDelete: (ids: string[]) => void;
}

export const MINDMAP_DELETE_BINDINGS: readonly Binding<MindmapDeleteContext>[] = [
  {
    id: "mindmap.delete", section: "mindmap", chord: { code: "Delete" },
    labelKey: "delete",
    when: hasSelection,
    run: (c) => c.onDelete([...c.selectedNodeIds]),
  },
];
