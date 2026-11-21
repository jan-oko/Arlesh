import type { Binding } from "@/utils/hotkeys/chord";

/** What the jump to the next waiting answer acts on. */
export interface ListWaitingContext {
  /** Selects the Task of the next answer waiting for you and focuses its field. */
  onJumpToWaitingAnswer: () => void;
  /** The same over the staged answers: selects the Task and focuses the locked field. */
  onJumpToStagedAnswer: () => void;
}

/**
 * `Q` jumps to the next answer field whose question or review is waiting for you (not staged),
 * wrapping at the end; `Shift+Q` does the same over the staged ones. In the views that draw answer fields: the List and Zen Views.
 */
export const LIST_WAITING_BINDINGS: readonly Binding<ListWaitingContext>[] = [
  {
    id: "listView.jumpToWaitingAnswer", section: "listView", chord: { code: "KeyQ" },
    labelKey: "jumpToWaitingAnswer", run: (c) => c.onJumpToWaitingAnswer(),
  },
  {
    id: "listView.jumpToStagedAnswer", section: "listView", chord: { code: "KeyQ", shift: true },
    labelKey: "jumpToStagedAnswer", run: (c) => c.onJumpToStagedAnswer(),
  },
];
