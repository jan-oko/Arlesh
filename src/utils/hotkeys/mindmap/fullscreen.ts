import type { Binding } from "@/utils/hotkeys/chord";
import type { MindmapSelectionContext } from "./selection";

/** What the board-alone binding acts on. */
export interface MindmapFullscreenContext extends MindmapSelectionContext {
  onToggleFullscreen: () => void;
}

export const MINDMAP_FULLSCREEN_BINDINGS: readonly Binding<MindmapFullscreenContext>[] = [
  {
    // The other half of bare F — see `mindmap.convertToFlow`, which is declared before this one
    // because that is the only reason order between the two could ever matter.
    id: "mindmap.toggleFullscreen", section: "mindmap", chord: { code: "KeyF" },
    labelKey: "toggleFullscreen",
    when: (c) => c.selectedNodeId === null,
    run: (c) => c.onToggleFullscreen(),
  },
];
