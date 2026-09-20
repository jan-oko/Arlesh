import type { Binding } from "@/utils/hotkeys/chord";
import type { MindmapSelectionContext } from "./selection";
import { hasSelection } from "./selection";

/** What converting a cell to a Flow acts on. */
export interface MindmapConvertToFlowContext extends MindmapSelectionContext {
  onConvertToFlow: (id: string) => void;
}

export const MINDMAP_CONVERT_TO_FLOW_BINDINGS: readonly Binding<MindmapConvertToFlowContext>[] = [
  {
    // Shares bare F with `mindmap.toggleFullscreen`, on the complementary guard: F converts the
    // selection to a Flow, and with nothing selected there is nothing to convert, so it shows the
    // board alone instead. The dispatcher takes the first entry whose chord matches *and* whose
    // guard passes, so the two never contend — see chord-sharing.test.ts, which declares the pair
    // and the order it dispatches in.
    id: "mindmap.convertToFlow", section: "mindmap", chord: { code: "KeyF" },
    labelKey: "convertToFlow",
    when: hasSelection,
    run: (c) => { if (c.selectedNodeId !== null) c.onConvertToFlow(c.selectedNodeId); },
  },
];
