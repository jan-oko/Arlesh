import type { Binding } from "@/utils/hotkeys/chord";
import type { MindmapSelectionContext } from "./selection";
import { hasSelection } from "./selection";

/** What clearing the selection acts on. */
export interface MindmapDeselectContext extends MindmapSelectionContext {
  onDeselect: () => void;
}

export const MINDMAP_DESELECT_BINDINGS: readonly Binding<MindmapDeselectContext>[] = [
  {
    id: "mindmap.deselect", section: "mindmap", chord: { code: "Escape" },
    labelKey: "deselect",
    when: hasSelection,
    run: (c) => c.onDeselect(),
  },
];
