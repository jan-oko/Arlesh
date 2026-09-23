import type { Binding } from "@/utils/hotkeys/chord";
import type { MindmapSelectionContext } from "./selection";

/**
 * What the Expectation binding acts on. Releasing a wait and completing a check have no keys of
 * their own: `Enter` and the status control do both, as they advance any node's status.
 */
export interface MindmapExpectationContext extends MindmapSelectionContext {
  /** Opens the selected Task's editor at its Expectation section, with Asynchronous on. */
  onBindWait: (id: string) => void;
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
];
