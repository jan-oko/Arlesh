import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { RowId } from "@/api/node-id";
import { clearAnswerDraft, saveAnswerDraft, sendAnswerDrafts } from "@/api/answer-drafts";
import type { SendOutcome, SkippedDraft } from "@/api/answer-drafts";
import { withGesture } from "@/api/gesture";
import { getErrorMessage } from "@/api/errors";
import type { WaitReply } from "@/hooks/use-answer-question";

interface Options {
  settle: () => Promise<void>;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

/** What the screen does with staged answers: stage, unstage and send (ADR 0021). Each resolves
 * whether it landed; a refusal is said in a toast and leaves the controls as they were. */
export interface AnswerDrafts {
  /** Stages the answer, or a review's verdict and note, on a wait. The last save wins. */
  stage: (waitNodeId: string, waitRowId: RowId, reply: WaitReply) => Promise<boolean>;
  /** Unstages a wait: its draft goes. */
  unstage: (waitNodeId: string, waitRowId: RowId) => Promise<boolean>;
  /** Sends every staged answer on the board. `shown` is the waits the screen shows as staged. A
   * send that skipped any says which in one toast, at the first skipped wait's Task. */
  send: (anchorNodeId: string, shown: readonly RowId[]) => Promise<boolean>;
}

/** The node a send's toast hangs on: the first skipped wait's Task, else where the press was. */
export function skippedAnchor(skipped: readonly SkippedDraft[], fallback: string): string {
  const task = skipped.find((entry) => entry.task_id !== undefined && entry.task_id !== null)?.task_id;
  return task === undefined || task === null ? fallback : `task-${task}`;
}

/**
 * **Stage**, unstage and **Send** on an agent's open waits, from a card, a row or the Task editor.
 * Staging stores the answer on the server without releasing the wait; Send releases every staged
 * wait on the board in one write, as one Gesture, so one Ctrl+Z puts every answer back to staged.
 *
 * A Send on text that is not staged yet is the caller's two calls: `stage`, then `send`, each its
 * own Gesture, so the first Ctrl+Z undoes the send and the current answer returns to staged too.
 */
export function useAnswerDrafts({ settle, showToast }: Options): AnswerDrafts {
  const { t } = useTranslation("expectation");
  const { t: tUndo } = useTranslation("undo");

  const failed = useCallback(
    (nodeId: string, error: unknown) => {
      showToast({ nodeId, message: t("actionFailed", { message: getErrorMessage(error) }) });
      return false;
    },
    [showToast, t],
  );

  const stage = useCallback<AnswerDrafts["stage"]>(
    async (waitNodeId, waitRowId, reply) => {
      try {
        await saveAnswerDraft(waitRowId, {
          ...(reply.answer !== undefined ? { answer: reply.answer.trim() } : {}),
          ...(reply.verdict !== undefined ? { verdict: reply.verdict } : {}),
        });
      } catch (error: unknown) {
        return failed(waitNodeId, error);
      }
      await settle();
      return true;
    },
    [settle, failed],
  );

  const unstage = useCallback<AnswerDrafts["unstage"]>(
    async (waitNodeId, waitRowId) => {
      try {
        await clearAnswerDraft(waitRowId);
      } catch (error: unknown) {
        return failed(waitNodeId, error);
      }
      await settle();
      return true;
    },
    [settle, failed],
  );

  const send = useCallback<AnswerDrafts["send"]>(
    async (anchorNodeId, shown) => {
      let outcome: SendOutcome;
      try {
        outcome = await withGesture(tUndo("gestures.sendAnswers", { count: shown.length }), () =>
          sendAnswerDrafts({ shown: [...shown] }),
        );
      } catch (error: unknown) {
        return failed(anchorNodeId, error);
      }
      if (outcome.skipped.length > 0) {
        const list = outcome.skipped
          .map((entry) =>
            t("draftSkipped", {
              title: entry.title ?? t("draftSkippedUntitled"),
              reason: t(`draftSkipReason.${entry.reason}`),
            }),
          )
          .join("; ");
        showToast({ nodeId: skippedAnchor(outcome.skipped, anchorNodeId), message: t("draftsNotSent", { list }) });
      }
      await settle();
      return true;
    },
    [settle, showToast, failed, t, tUndo],
  );

  return { stage, unstage, send };
}

