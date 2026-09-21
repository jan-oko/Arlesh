import type { Binding } from "@/utils/hotkeys/chord";
import type { MindmapSelectionContext } from "./selection";
import { hasSelection } from "./selection";

/** What folding a cell acts on. */
export interface MindmapCollapseContext extends MindmapSelectionContext {
  onToggleCollapsed: (id: string) => void;
  onToggleSubtreeCollapsed: (id: string) => void;
}

export const MINDMAP_COLLAPSE_BINDINGS: readonly Binding<MindmapCollapseContext>[] = [
  {
    id: "mindmap.toggleCollapsed", section: "mindmap", chord: { code: "Slash", ctrl: true },
    labelKey: "toggleCollapsed",
    when: hasSelection,
    run: (c) => { if (c.selectedNodeId !== null) c.onToggleCollapsed(c.selectedNodeId); },
  },
  {
    // The recursive counterpart of the binding above: it goes whichever way the pressed cell is
    // not, so a second press is the first one undone.
    //
    // Ctrl+Shift+/ is also the cheat-sheet's chord, and the two tables dispatch from separate
    // listeners, so what keeps exactly one of them firing is the pair of guards, not the order:
    // this one takes the chord whenever there is a cell to act on, and `global.toggleHotkeys`
    // takes it otherwise. `chord-sharing.test.ts` declares the pair and pins it complementary.
    id: "mindmap.toggleSubtreeCollapsed", section: "mindmap", chord: { code: "Slash", ctrl: true, shift: true },
    labelKey: "toggleSubtreeCollapsed",
    when: hasSelection,
    run: (c) => { if (c.selectedNodeId !== null) c.onToggleSubtreeCollapsed(c.selectedNodeId); },
  },
];
