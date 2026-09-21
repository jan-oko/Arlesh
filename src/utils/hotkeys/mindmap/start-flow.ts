import type { Binding } from "@/utils/hotkeys/chord";
import type { MindmapSelectionContext } from "./selection";
import { selectedKindIs } from "./selection";

/** What starting a Flow acts on. */
export interface MindmapStartFlowContext extends MindmapSelectionContext {
  onStartFlow: (id: string) => void;
}

export const MINDMAP_START_FLOW_BINDINGS: readonly Binding<MindmapStartFlowContext>[] = [
  {
    id: "mindmap.startFlow", section: "mindmap", chord: { code: "KeyS" },
    labelKey: "startFlow",
    when: selectedKindIs("flow"),
    run: (c) => { if (c.selectedNodeId !== null) c.onStartFlow(c.selectedNodeId); },
  },
];
