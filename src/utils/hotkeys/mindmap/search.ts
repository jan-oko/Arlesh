import type { Binding } from "@/utils/hotkeys/chord";

/** What the node search acts on. */
export interface MindmapSearchContext {
  onOpenSearch: () => void;
}

export const MINDMAP_SEARCH_BINDINGS: readonly Binding<MindmapSearchContext>[] = [
  {
    id: "mindmap.openSearch", section: "mindmap", chord: { code: "KeyO", ctrl: true },
    labelKey: "openSearch", run: (c) => c.onOpenSearch(),
  },
];
