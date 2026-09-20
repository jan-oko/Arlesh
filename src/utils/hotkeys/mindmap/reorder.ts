import type { Binding } from "@/utils/hotkeys/chord";
import type { MindmapSelectionContext } from "./selection";
import { hasSelection } from "./selection";

/** What moving a node among its siblings acts on. */
export interface MindmapReorderContext extends MindmapSelectionContext {
  onReorder: (id: string, dir: 1 | -1) => void;
}

export const MINDMAP_REORDER_BINDINGS: readonly Binding<MindmapReorderContext>[] = [
  {
    id: "mindmap.reorderUp", section: "mindmap", chord: { code: "ArrowUp", alt: true },
    labelKey: "reorder",
    when: hasSelection,
    run: (c) => { if (c.selectedNodeId !== null) c.onReorder(c.selectedNodeId, -1); },
  },
  {
    id: "mindmap.reorderDown", section: "mindmap", chord: { code: "ArrowDown", alt: true },
    labelKey: "reorder",
    when: hasSelection,
    run: (c) => { if (c.selectedNodeId !== null) c.onReorder(c.selectedNodeId, 1); },
  },
];
