import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { getErrorMessage } from "@/api/errors";
import { gestureName, redo, undo } from "@/api/gesture";
import type { GestureSummary } from "@/api/gesture";
import { usePendingWritesStore } from "@/stores/use-pending-writes-store";
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

/**
 * Waits for the window's pending writes to be answered, so the server undoes or redoes the newest
 * thing the user did. Resolves `true` when a write it waited for was refused: that refusal already
 * took the change back, so the press is spent on it and the server is not asked (ADR 0012,
 * decision 9).
 */
async function waitForLane(): Promise<boolean> {
  const { whenDrained, rollbacks } = usePendingWritesStore.getState();
  const before = rollbacks;
  await whenDrained();
  return usePendingWritesStore.getState().rollbacks > before;
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
 * - `null` came back — the stack was empty. Say so and reload nothing: there is nothing to draw.
 *   "Nothing to undo" is a statement of fact about the board, not a failure, and its wording has to
 *   stay clear of the refusal's below. The toast carries no severity of its own — one class, one
 *   tone — so the words are the only thing keeping the two apart.
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
      // With nothing pending, the backend is asked in the same tick, as it was before the lane.
      void (usePendingWritesStore.getState().isBusy()
        ? waitForLane().then((spent) => (spent ? undefined : reverse()))
        : reverse())
        .then(async (summary: GestureSummary | null | undefined) => {
          // The press was spent on a write that was refused (see `waitForLane`).
          if (summary === undefined) return;
          if (summary === null) {
            showToast({
              nodeId: UNDO_TOAST_ANCHOR,
              message: direction === "undo" ? t("nothingToUndo") : t("nothingToRedo"),
            });
            return;
          }
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

  // Ctrl+Z asks the window's pending writes first (ADR 0012, decision 9): a newest write that has
  // not been sent is cancelled here, and nothing is asked of the server.
  const onUndo = useCallback(() => {
    const cancelled = usePendingWritesStore.getState().cancelTail();
    if (cancelled === null) {
      apply("undo");
      return;
    }
    showToast({ nodeId: UNDO_TOAST_ANCHOR, message: t("undid", { gesture: cancelled.label }) });
  }, [apply, showToast, t]);
  const onRedo = useCallback(() => apply("redo"), [apply]);

  return { onUndo, onRedo };
}
