import type { Binding } from "@/utils/hotkeys/chord";

/** What the filter menu binding acts on. */
export interface MindmapFilterContext {
  onToggleFilter: () => void;
}

export const MINDMAP_FILTER_BINDINGS: readonly Binding<MindmapFilterContext>[] = [
  {
    id: "mindmap.toggleFilter", section: "mindmap", chord: { code: "KeyF", alt: true },
    labelKey: "toggleFilter", run: (c) => c.onToggleFilter(),
  },
];
