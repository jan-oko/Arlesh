import type { Binding } from "@/utils/hotkeys/chord";
import type { MindmapSelectionContext } from "./selection";
import { hasSelection } from "./selection";

/** What centring the canvas acts on. */
export interface MindmapCenterContext extends MindmapSelectionContext {
  onCenterOnNode: (id: string) => void;
}

export const MINDMAP_CENTER_BINDINGS: readonly Binding<MindmapCenterContext>[] = [
  {
    id: "mindmap.centerOnNode", section: "mindmap", chord: { code: "KeyC" },
    labelKey: "centerOnNode",
    when: hasSelection,
    run: (c) => { if (c.selectedNodeId !== null) c.onCenterOnNode(c.selectedNodeId); },
  },
];
