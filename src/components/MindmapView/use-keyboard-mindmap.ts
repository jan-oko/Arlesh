import { useEffect, useRef } from "react";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { MINDMAP_BINDINGS } from "@/utils/hotkeys/mindmap-bindings";
import type { MindmapContext } from "@/utils/hotkeys/mindmap-bindings";

/**
 * `lastEnterMs` is omitted deliberately: it is internal Enter-double-tap state this hook owns via a
 * ref, not something MindmapView passes in.
 */
interface Options extends Omit<MindmapContext, "lastEnterMs"> {
  isInputActive: boolean;
  isWarningActive: boolean;
  onDismissWarning: () => void;
}

/**
 * The Mindmap's keyboard bindings. The bindings themselves live in the shared hotkey registry (so
 * the cheat-sheet renders the same table this dispatches from); this hook supplies the context and
 * owns the gating the registry deliberately doesn't model — a focused input, and the warning modal,
 * which swallows every key but the Escape that dismisses it.
 */
export function useKeyboardMindmap(options: Options): void {
  const { isInputActive, isWarningActive, onDismissWarning, ...rest } = options;
  const lastEnterMs = useRef(-Infinity);
  const context: MindmapContext = { ...rest, lastEnterMs };

  useEffect(() => {
    if (isInputActive || !isWarningActive) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.code !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onDismissWarning();
    }
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [isInputActive, isWarningActive, onDismissWarning]);

  useHotkeys(MINDMAP_BINDINGS, context, !isInputActive && !isWarningActive);
}
