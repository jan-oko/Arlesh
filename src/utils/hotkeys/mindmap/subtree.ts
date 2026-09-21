import type { Binding } from "@/utils/hotkeys/chord";

/** What getting back out of a subtree acts on. */
export interface MindmapSubtreeContext {
  subtreeRootId: string | null;
  onExitSubtree: () => void;
  onExitToRoot: () => void;
}

export const MINDMAP_SUBTREE_BINDINGS: readonly Binding<MindmapSubtreeContext>[] = [
  {
    id: "mindmap.exitToRoot", section: "mindmap", chord: { code: "Escape", ctrl: true },
    labelKey: "exitToRoot",
    when: (c) => c.subtreeRootId !== null,
    run: (c) => c.onExitToRoot(),
  },
  {
    id: "mindmap.exitSubtree", section: "mindmap", chord: { code: "Escape", shift: true },
    labelKey: "exitSubtree",
    when: (c) => c.subtreeRootId !== null,
    run: (c) => c.onExitSubtree(),
  },
];
