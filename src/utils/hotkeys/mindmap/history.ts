import type { Binding } from "@/utils/hotkeys/chord";

/** What the undo stack acts on. */
export interface MindmapHistoryContext {
  /** Reverses the last thing the user did to the board, anywhere in the app. */
  onUndo: () => void;
  /** Reapplies the most recently undone thing. */
  onRedo: () => void;
}

export const MINDMAP_HISTORY_BINDINGS: readonly Binding<MindmapHistoryContext>[] = [
  {
    id: "mindmap.undo", section: "mindmap", chord: { code: "KeyZ", ctrl: true },
    labelKey: "undo", allowRepeat: false, run: (c) => c.onUndo(),
  },
  {
    id: "mindmap.redo", section: "mindmap", chord: { code: "KeyZ", ctrl: true, shift: true },
    labelKey: "redo", allowRepeat: false, run: (c) => c.onRedo(),
  },
  {
    // The other redo the world uses. Hidden because the sheet already lists Ctrl+Shift+Z.
    id: "mindmap.redoAlias", section: "mindmap", chord: { code: "KeyY", ctrl: true },
    labelKey: "redo", hidden: true, allowRepeat: false, run: (c) => c.onRedo(),
  },
];
