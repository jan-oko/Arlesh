import { useCallback, useEffect, useState } from "react";
import { useUndo } from "@/hooks/use-undo";
import type { PendingToast } from "@/stores/use-mindmap-store";
import { useSettingsReloadStore } from "@/stores/use-settings-reload-store";
import { matchesChord } from "@/utils/hotkeys/chord";
import type { Chord } from "@/utils/hotkeys/chord";

const UNDO: Chord = { code: "KeyZ", ctrl: true };
const REDO: Chord = { code: "KeyZ", ctrl: true, shift: true };
const REDO_ALIAS: Chord = { code: "KeyY", ctrl: true };

/** Whether the event came from somewhere the user types, where the field undoes its own text. */
function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
}

/**
 * Undo and redo while the Settings modal is open.
 *
 * The modal captures the keyboard, which suspends every view's own Ctrl+Z; what the pages change
 * (the MCP roots, the agents and their Claims) is journaled like any board edit, so the same
 * Gesture stacks serve them. A press inside a text field is left to the field. An undone or redone
 * Gesture bumps {@link useSettingsReloadStore}, which the pages read from, and its notice is
 * returned for the modal to draw above itself — the board's own toast sits beneath the overlay.
 */
export function useSettingsUndo(): { toast: PendingToast | null; dismissToast: () => void } {
  const [toast, setToast] = useState<PendingToast | null>(null);
  const bump = useSettingsReloadStore((s) => s.bump);
  const reload = useCallback(async () => { bump(); }, [bump]);
  const { onUndo, onRedo } = useUndo({ reload, showToast: setToast });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (isTypingTarget(event.target) || event.repeat) return;
      if (matchesChord(event, UNDO)) {
        event.preventDefault();
        onUndo();
      } else if (matchesChord(event, REDO) || matchesChord(event, REDO_ALIAS)) {
        event.preventDefault();
        onRedo();
      }
    }
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [onUndo, onRedo]);

  return { toast, dismissToast: () => setToast(null) };
}
