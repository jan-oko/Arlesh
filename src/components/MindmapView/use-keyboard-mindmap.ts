import { useCallback, useEffect, useRef } from "react";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { DOUBLE_TAP_MS, MINDMAP_BINDINGS } from "@/utils/hotkeys/mindmap-bindings";
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
  const pendingVerdict = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { onCycleVerdict } = rest;

  // Enter on a Commitment is ambiguous while the double-tap window is open: the press may yet turn
  // out to be the first half of the double tap that enters the commitment's subtree. Since nothing
  // but the user may decide a verdict, the cycle waits the window out rather than writing a step
  // that navigating would then have to take back. The binding stamps `lastEnterMs` with -Infinity
  // when a double tap consumes the pair, which is how a waiting cycle learns it was half of one.
  const scheduleVerdictCycle = useCallback((nodeId: string) => {
    if (pendingVerdict.current !== null) clearTimeout(pendingVerdict.current);
    pendingVerdict.current = setTimeout(() => {
      pendingVerdict.current = null;
      if (lastEnterMs.current === -Infinity) return;
      onCycleVerdict(nodeId);
    }, DOUBLE_TAP_MS);
  }, [onCycleVerdict]);

  useEffect(() => () => {
    if (pendingVerdict.current !== null) clearTimeout(pendingVerdict.current);
  }, []);

  const context: MindmapContext = { ...rest, lastEnterMs, onCycleVerdict: scheduleVerdictCycle };

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
