import type { Binding } from "@/utils/hotkeys/chord";
import type { MindmapSelectionContext } from "./selection";
import { hasSelection } from "./selection";

export interface ClipboardEntry {
  operation: "cut" | "copy";
  nodeIds: string[];
}

/** What cut, copy and paste act on. */
export interface MindmapClipboardContext extends MindmapSelectionContext {
  clipboard: ClipboardEntry | null;
  onCut: (ids: string[]) => void;
  onCopy: (ids: string[]) => void;
  onPaste: (id: string) => void;
}

export const MINDMAP_CLIPBOARD_BINDINGS: readonly Binding<MindmapClipboardContext>[] = [
  {
    id: "mindmap.cut", section: "mindmap", chord: { code: "KeyX", ctrl: true },
    labelKey: "cut",
    when: hasSelection,
    run: (c) => c.onCut([...c.selectedNodeIds]),
  },
  {
    id: "mindmap.copy", section: "mindmap", chord: { code: "KeyC", ctrl: true },
    labelKey: "copy",
    when: hasSelection,
    run: (c) => c.onCopy([...c.selectedNodeIds]),
  },
  {
    id: "mindmap.paste", section: "mindmap", chord: { code: "KeyV", ctrl: true },
    labelKey: "paste",
    when: (c) => c.clipboard !== null && c.selectedNodeId !== null,
    run: (c) => { if (c.selectedNodeId !== null) c.onPaste(c.selectedNodeId); },
  },
];
