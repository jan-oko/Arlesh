import type { Binding } from "@/utils/hotkeys/chord";
import type { MindmapSelectionContext } from "./selection";
import { selectedNode } from "./selection";

/** What the two Expectation gestures act on. */
export interface MindmapExpectationContext extends MindmapSelectionContext {
  /** Completes the check on a wait — the selected Expectation, or the one
   * the selected virtual check task belongs to. The next check falls due one interval later. */
  onCompleteCheck: (id: string) => void;
  /** Releases the selected Expectation, or takes a release back. */
  onToggleRelease: (id: string) => void;
  /** Opens the selected Task's editor at its Expectation section, with Asynchronous on. */
  onBindWait: (id: string) => void;
}

/** A wait, or a wait's check task — what `D` is aimed at. */
function selectedWaitOrCheck(c: MindmapSelectionContext): boolean {
  const node = selectedNode(c);
  return node !== undefined && (node.kind === "expectation" || node.expectationCheck !== undefined);
}

export const MINDMAP_EXPECTATION_BINDINGS: readonly Binding<MindmapExpectationContext>[] = [
  {
    // Shift+W — the "wait" letter bare W flips on a Task, plus Shift: open the Task's editor at
    // its Expectation section with Asynchronous on, to say what the wait will be. Nothing is
    // written until Save. Fires on any selection so a node that is not a Task is refused by name
    // rather than by a dead key.
    id: "mindmap.bindWait", section: "mindmap", chord: { code: "KeyW", shift: true },
    labelKey: "bindWait", allowRepeat: false,
    when: (c) => c.selectedNodeId !== null,
    run: (c) => { if (c.selectedNodeId !== null) c.onBindWait(c.selectedNodeId); },
  },
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
