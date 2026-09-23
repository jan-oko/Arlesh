import type { Binding } from "@/utils/hotkeys/chord";
import type { StepsSelectionContext } from "./selection";
import { hasSelection, withNode } from "./selection";

/** What descending into a card acts on. */
export interface StepsDescendContext extends StepsSelectionContext {
  /** Makes the selected card the Step you are standing on — the tab's shared subtree root. */
  onDescend: (id: string) => void;
}

/**
 * `Enter` descends, and that is the whole of this view's forward motion.
 *
 * It moves the tab's **shared subtree root**, the same one `Ctrl+O` and the breadcrumb move, so the
 * breadcrumb naming the Step, `Shift+Escape`, `Ctrl+Escape` and the tab label all follow for free —
 * and switching to the Mindmap afterwards lands on the node you walked to. There is deliberately no
 * Steps-specific way back out: the ways back are the ones that already exist.
 *
 * A card that cannot be descended into is **not** silently inert. The guard passes, the handler
 * runs, and it says why — see `canDescendInto` and `stepRefusalKey` in `steps-card.ts`.
 */
export const STEPS_DESCEND_BINDINGS: readonly Binding<StepsDescendContext>[] = [
  {
    id: "stepsView.descend", section: "stepsView", chord: { code: "Enter" },
    labelKey: "stepsDescend",
    when: (c) => hasSelection(c),
    run: (c) => withNode(c, c.onDescend),
  },
];
