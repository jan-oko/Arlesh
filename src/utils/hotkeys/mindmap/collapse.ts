import type { Binding } from "@/utils/hotkeys/chord";
import type { MindmapSelectionContext } from "./selection";
import { hasSelection } from "./selection";

/** What folding a cell acts on. */
export interface MindmapCollapseContext extends MindmapSelectionContext {
  onToggleCollapsed: (id: string) => void;
}

export const MINDMAP_COLLAPSE_BINDINGS: readonly Binding<MindmapCollapseContext>[] = [
  {
    id: "mindmap.toggleCollapsed", section: "mindmap", chord: { code: "Slash", ctrl: true },
    labelKey: "toggleCollapsed",
    when: hasSelection,
    run: (c) => { if (c.selectedNodeId !== null) c.onToggleCollapsed(c.selectedNodeId); },
  },
];
