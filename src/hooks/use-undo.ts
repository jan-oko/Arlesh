import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { getErrorMessage } from "@/api/errors";
import { gestureName, redo, undo } from "@/api/gesture";
import type { GestureSummary } from "@/api/gesture";
import { describeChanges } from "@/utils/gesture-label";
import type { GestureVerb } from "@/utils/gesture-label";

/**
 * What an undo notice anchors to. Deliberately not a node id, so the toast renders at the fixed
 * fallback spot: an undo is about the board, not about one node, and the node it changed may have
 * just stopped existing.
 */
export const UNDO_TOAST_ANCHOR = "undo:toast";

/** Which way a Gesture is being applied. */
type Direction = "undo" | "redo";

const CHANGE_KEYS = {
  create: "changes.create",
  update: "changes.update",
  delete: "changes.delete",
  change: "changes.change",
} as const satisfies Record<GestureVerb, string>;

interface Options {
  /** Re-reads the board, the way every other mutation already does. */
  reload: () => Promise<void>;
  /** The app's existing anchored notice. */
  showToast: (toast: { nodeId: string; message: string }) => void;
}

/** The two hotkey handlers. */
export interface UndoActions {
  onUndo: () => void;
  onRedo: () => void;
}

/** What the toast should call a Gesture: the name it was opened with, or its row counts. */
function phraseGesture(summary: GestureSummary, t: TFunction<"undo">): string {
  const named = gestureName(summary.gesture);
  if (named !== undefined) return named;
  const { verb, count } = describeChanges(summary);
  return t(CHANGE_KEYS[verb], { count });
}

/**
 * Ctrl+Z and Ctrl+Shift+Z: reverse a Gesture, say what was reversed, and redraw.
 *
 * Three outcomes, and they must not look alike:
 *
 * - A Gesture came back — say what it was and reload.
 * - `null` came back — the stack was empty. Nothing happened, nothing is said. Pressing Ctrl+Z
 *   with nothing to undo is not a mistake and must not flash like one.
 * - It rejected — the Gesture could not be applied, the board is untouched and the Gesture is still
 *   on the stack. Say so, and do not reload: there is nothing new to draw.
 *
 * The stacks are never consulted before pressing. `undo_status` labels controls; it is not a guard,
 * and asking first would only add a round trip and a window for the answer to go stale.
 */
export function useUndo({ reload, showToast }: Options): UndoActions {
  const { t } = useTranslation("undo");
  // One at a time. Holding Ctrl+Z would otherwise start a second reversal against a board the first
  // has not finished changing, and the two toasts would race.
  const isApplying = useRef(false);

  const apply = useCallback(
    (direction: Direction) => {
      if (isApplying.current) return;
      isApplying.current = true;
      const reverse = direction === "undo" ? undo : redo;
      void reverse()
        .then(async (summary: GestureSummary | null) => {
          if (summary === null) return;
          const gesture = phraseGesture(summary, t);
          const message = direction === "undo" ? t("undid", { gesture }) : t("redid", { gesture });
          showToast({ nodeId: UNDO_TOAST_ANCHOR, message });
          await reload();
        })
        .catch((error: unknown) => {
          const message = getErrorMessage(error);
          showToast({
            nodeId: UNDO_TOAST_ANCHOR,
            message: direction === "undo" ? t("undoFailed", { message }) : t("redoFailed", { message }),
          });
        })
        .finally(() => {
          isApplying.current = false;
        });
    },
    [reload, showToast, t],
  );

  const onUndo = useCallback(() => apply("undo"), [apply]);
  const onRedo = useCallback(() => apply("redo"), [apply]);

  return { onUndo, onRedo };
}
