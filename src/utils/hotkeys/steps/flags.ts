import type { Binding } from "@/utils/hotkeys/chord";
import type { StepsSelectionContext } from "./selection";
import { hasSelection, withNode } from "./selection";

/** What the flags on a Task act on. */
export interface StepsFlagsContext extends StepsSelectionContext {
  onToggleBacklog: (id: string) => void;
  onToggleAgentic: (id: string) => void;
  onToggleAsynchronous: (id: string) => void;
}

/**
 * The same three bare letters the Mindmap and the List View bind — `B` backlog, `A` agentic, `W`
 * for the **wait** an asynchronous Task starts.
 *
 * Bare, because a flag on the selected Task is a bare letter in every view, and `Alt+letter` is a
 * status preset in every view; strict chord matching keeps `A` and `Alt+A` apart. A card that is
 * not a Task is turned away by the handler, which says so, rather than by a guard that would leave
 * the key looking broken.
 */
export const STEPS_FLAGS_BINDINGS: readonly Binding<StepsFlagsContext>[] = [
  {
    id: "stepsView.toggleBacklog", section: "stepsView", chord: { code: "KeyB" },
    labelKey: "toggleBacklog",
    when: (c) => hasSelection(c),
    run: (c) => withNode(c, c.onToggleBacklog),
  },
  {
    id: "stepsView.toggleAgentic", section: "stepsView", chord: { code: "KeyA" },
    labelKey: "toggleAgentic",
    when: (c) => hasSelection(c),
    run: (c) => withNode(c, c.onToggleAgentic),
  },
  {
    id: "stepsView.toggleAsynchronous", section: "stepsView", chord: { code: "KeyW" },
    labelKey: "toggleAsynchronous",
    when: (c) => hasSelection(c),
    run: (c) => withNode(c, c.onToggleAsynchronous),
  },
];
