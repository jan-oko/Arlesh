import type { Binding } from "@/utils/hotkeys/chord";
import type { ListSelectionContext } from "./selection";

/** What the board-alone binding acts on. */
export interface ListFullscreenContext extends ListSelectionContext {
  onToggleFullscreen: () => void;
}

export const LIST_FULLSCREEN_BINDINGS: readonly Binding<ListFullscreenContext>[] = [
  {
    // Bare F shows the board alone, on the same rule as the Mindmap's: only with nothing selected.
    // Nothing else claims F here, but matching the Mindmap matters more than the free key does —
    // one gesture should not mean two things depending on which view you happen to be in.
    id: "listView.toggleFullscreen", section: "listView", chord: { code: "KeyF" },
    labelKey: "toggleFullscreen",
    when: (c) => c.selectedRowId === null,
    run: (c) => c.onToggleFullscreen(),
  },
];
