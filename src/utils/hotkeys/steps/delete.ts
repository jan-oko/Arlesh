import type { Binding } from "@/utils/hotkeys/chord";
import type { StepsSelectionContext } from "./selection";
import { hasSelection, withNode } from "./selection";

/** What deleting acts on. */
export interface StepsDeleteContext extends StepsSelectionContext {
  /** Raises the delete confirmation for the selected card, or refuses out loud. */
  onDelete: (id: string) => void;
}

/**
 * `Delete`, on the one card a Step can have selected. The refusals, the confirmation, the subtree
 * cascade and the writer are the other views' — so `Delete` means one thing whichever view you
 * pressed it in, and one `Ctrl+Z` takes it back.
 */
export const STEPS_DELETE_BINDINGS: readonly Binding<StepsDeleteContext>[] = [
  {
    id: "stepsView.delete", section: "stepsView", chord: { code: "Delete" },
    labelKey: "delete", allowRepeat: false,
    when: hasSelection,
    run: (c) => withNode(c, c.onDelete),
  },
];
