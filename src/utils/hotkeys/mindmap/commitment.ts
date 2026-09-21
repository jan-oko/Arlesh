import type { Binding } from "@/utils/hotkeys/chord";
import type { MindmapSelectionContext } from "./selection";
import { selectedKindIs } from "./selection";

/** What recording a broken commitment acts on. */
export interface MindmapCommitmentContext extends MindmapSelectionContext {
  /** Records that the selected Commitment was not held to, or clears an existing Broken. */
  onMarkBroken: (id: string) => void;
}

export const MINDMAP_COMMITMENT_BINDINGS: readonly Binding<MindmapCommitmentContext>[] = [
  {
    // The same key the List View gives it, for the same reason: Enter reaches Broken only by
    // passing through Kept, so without this the canvas would offer Kept in one press and Broken
    // in two. Bare X is free here; Ctrl+X is Cut, and a chord is matched on its exact modifiers.
    id: "mindmap.markBroken", section: "mindmap", chord: { code: "KeyX" },
    labelKey: "markBroken",
    when: selectedKindIs("commitment"),
    run: (c) => { if (c.selectedNodeId !== null) c.onMarkBroken(c.selectedNodeId); },
  },
];
