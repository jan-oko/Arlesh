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
    // Ctrl+Shift+/ would read as the obvious "more of Ctrl+/", but the cheat-sheet has held it
    // since it shipped, and a chord shared across two tables cannot be ordered — the two dispatch
    // from separate listeners, so one of the pair would need a guard the other complements
    // exactly. Ctrl+Alt is unused everywhere, and a free chord beats a shared one.
    id: "mindmap.toggleSubtreeCollapsed", section: "mindmap", chord: { code: "Slash", ctrl: true, alt: true },
    labelKey: "toggleSubtreeCollapsed",
    when: hasSelection,
    run: (c) => { if (c.selectedNodeId !== null) c.onToggleSubtreeCollapsed(c.selectedNodeId); },
  },
];
