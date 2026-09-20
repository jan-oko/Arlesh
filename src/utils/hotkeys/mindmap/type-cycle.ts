import type { Binding } from "@/utils/hotkeys/chord";
import type { MindmapSelectionContext } from "./selection";
import { hasSelection } from "./selection";

/** What cycling a node's kind acts on. */
export interface MindmapTypeCycleContext extends MindmapSelectionContext {
  onCycleType: (id: string, dir: 1 | -1) => void;
}

// Each cross-table retype creates+deletes a node, and held-key repeats race the reload, spawning
// duplicate siblings — so type-cycling opts out of auto-repeat.
export const MINDMAP_TYPE_CYCLE_BINDINGS: readonly Binding<MindmapTypeCycleContext>[] = [
  {
    id: "mindmap.cycleTypeUp", section: "mindmap", chord: { code: "ArrowUp", ctrl: true },
    labelKey: "cycleType", allowRepeat: false,
    when: hasSelection,
    run: (c) => { if (c.selectedNodeId !== null) c.onCycleType(c.selectedNodeId, -1); },
  },
  {
    id: "mindmap.cycleTypeDown", section: "mindmap", chord: { code: "ArrowDown", ctrl: true },
    labelKey: "cycleType", allowRepeat: false,
    when: hasSelection,
    run: (c) => { if (c.selectedNodeId !== null) c.onCycleType(c.selectedNodeId, 1); },
  },
];
