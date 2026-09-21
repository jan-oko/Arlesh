import type { Binding } from "@/utils/hotkeys/chord";

/** What getting back out of a subtree acts on. */
export interface ListSubtreeContext {
  /** Whether the view is currently re-rooted at a subtree — gates the two exit chords. */
  subtreeRootId: string | null;
  /** Up one subtree level. */
  onExitSubtree: () => void;
  /** Straight back out to the true root. */
  onExitToRoot: () => void;
}

// Subtree navigation, matching the Mindmap's exactly (the subtree root is shared state, so the
// two views have to agree on how you get back out of one). Chord matching is strict about
// modifiers, so Ctrl+Escape, Shift+Escape and bare Escape never reach each other.
export const LIST_SUBTREE_BINDINGS: readonly Binding<ListSubtreeContext>[] = [
  {
    id: "listView.exitToRoot", section: "listView", chord: { code: "Escape", ctrl: true },
    labelKey: "exitToRoot",
    when: (c) => c.subtreeRootId !== null,
    run: (c) => c.onExitToRoot(),
  },
  {
    id: "listView.exitSubtree", section: "listView", chord: { code: "Escape", shift: true },
    labelKey: "exitSubtree",
    when: (c) => c.subtreeRootId !== null,
    run: (c) => c.onExitSubtree(),
  },
];
