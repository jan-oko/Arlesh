import type { Binding } from "@/utils/hotkeys/chord";

/** What getting back out of a subtree acts on. */
export interface PlanSubtreeContext {
  /** Whether the view is currently re-rooted at a subtree — gates the two exit chords. */
  subtreeRootId: string | null;
  onExitSubtree: () => void;
  onExitToRoot: () => void;
}

// The subtree root is shared across every view in a tab, so the ways back out of one are the same
// chords here as on the Mindmap and in the List View.
export const PLAN_SUBTREE_BINDINGS: readonly Binding<PlanSubtreeContext>[] = [
  {
    id: "planView.exitToRoot", section: "planView", chord: { code: "Escape", ctrl: true },
    labelKey: "exitToRoot",
    when: (c) => c.subtreeRootId !== null,
    run: (c) => c.onExitToRoot(),
  },
  {
    id: "planView.exitSubtree", section: "planView", chord: { code: "Escape", shift: true },
    labelKey: "exitSubtree",
    when: (c) => c.subtreeRootId !== null,
    run: (c) => c.onExitSubtree(),
  },
];
