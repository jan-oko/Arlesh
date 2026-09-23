import type { Binding } from "@/utils/hotkeys/chord";
import type { MindmapSelectionContext } from "./selection";
import { selectedNode } from "./selection";

/** What the two Expectation gestures act on. */
export interface MindmapExpectationContext extends MindmapSelectionContext {
  /** Completes the check on a wait: clears the check-by of the selected Expectation, or of the one
   * the selected virtual check task belongs to. The Expectation stays pending. */
  onCompleteCheck: (id: string) => void;
  /** Releases the selected Expectation, or takes a release back. */
  onToggleRelease: (id: string) => void;
}

/** A wait, or a wait's check task — what `D` is aimed at. */
function selectedWaitOrCheck(c: MindmapSelectionContext): boolean {
  const node = selectedNode(c);
  return node !== undefined && (node.kind === "expectation" || node.expectationCheck !== undefined);
}

export const MINDMAP_EXPECTATION_BINDINGS: readonly Binding<MindmapExpectationContext>[] = [
  {
    // D for "done checking". Bare D was free: Shift+D creates a Domain and Alt+D is the Do preset,
    // and chord matching is strict about modifiers, exactly as it keeps A and Alt+A apart.
    id: "mindmap.completeCheck", section: "mindmap", chord: { code: "KeyD" },
    labelKey: "completeCheck",
    when: selectedWaitOrCheck,
    run: (c) => { if (c.selectedNodeId !== null) c.onCompleteCheck(c.selectedNodeId); },
  },
  {
    // L for "reLease" — R renames and E edits. Bare L was free; Ctrl+L switches to the List View.
    id: "mindmap.toggleRelease", section: "mindmap", chord: { code: "KeyL" },
    labelKey: "toggleRelease",
    when: (c) => selectedNode(c)?.kind === "expectation",
    run: (c) => { if (c.selectedNodeId !== null) c.onToggleRelease(c.selectedNodeId); },
  },
];
