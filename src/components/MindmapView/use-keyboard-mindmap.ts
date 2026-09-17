import { useRef } from "react";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { MINDMAP_BINDINGS } from "@/utils/hotkeys/mindmap-bindings";
import type { MindmapContext } from "@/utils/hotkeys/mindmap-bindings";

/**
 * `lastEnterMs` is omitted deliberately: it is internal Enter-double-tap state this hook owns via a
 * ref, not something MindmapView passes in.
 */
interface Options extends Omit<MindmapContext, "lastEnterMs"> {
  isInputActive: boolean;
}

/**
 * The Mindmap's keyboard bindings. The bindings themselves live in the shared hotkey registry (so
 * the cheat-sheet renders the same table this dispatches from); this hook supplies the context and
 * owns the one piece of gating the registry deliberately doesn't model — whether something on top
 * of the view, an open modal or an inline editor, currently holds the keyboard.
 *
 * Dismissing those overlays is not this hook's business: each modal handles its own Escape, so it
 * behaves the same however it was opened and from whichever view.
 */
export function useKeyboardMindmap(options: Options): void {
  const { isInputActive, ...rest } = options;
  const lastEnterMs = useRef(-Infinity);
  const context: MindmapContext = { ...rest, lastEnterMs };

  useHotkeys(MINDMAP_BINDINGS, context, !isInputActive);
}
