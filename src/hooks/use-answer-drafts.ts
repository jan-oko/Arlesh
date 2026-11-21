import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { RowId } from "@/api/node-id";
import { clearAnswerDraft, saveAnswerDraft, sendAnswerDrafts } from "@/api/answer-drafts";
import type { SendOutcome, SkippedDraft } from "@/api/answer-drafts";
import { withGesture } from "@/api/gesture";
import { getErrorMessage } from "@/api/errors";
import type { WaitReply } from "@/hooks/use-answer-question";
import type { MindmapNode } from "@/utils/tree-layout";
import { rowIdOf } from "@/utils/node-identity";
import { useAgentActivityStore } from "@/stores/use-agent-activity-store";
import { useBoardStore } from "@/stores/use-board-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";

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

  return useMemo(() => ({ stage, unstage, send }), [stage, unstage, send]);
}


/** What an answer's controls do with the wait they sit on (ADR 0021). */
export interface AnswerActions {
  /** Stages the reply on `wait`. */
  stage: (wait: MindmapNode, reply: WaitReply) => Promise<boolean>;
  /** Unstages `wait`. */
  unstage: (wait: MindmapNode) => Promise<boolean>;
  /** Sends every staged answer on the board. Given a `reply` — the field's text, not staged yet —
   * it is staged first, in a call of its own, so the first Ctrl+Z undoes the send and the answer
   * returns to staged. */
  send: (wait: MindmapNode, reply?: WaitReply) => Promise<boolean>;
}

/** Releases the keyboard from a text field that is about to leave: a field still holding focus
 * when its wait is released would answer the next Ctrl+Z with the browser's own undo, not the
 * board's (docs/spec/undo.md). */
export function releaseFocus(): void {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

/** {@link useAnswerDrafts} as the answer controls use it: by the wait's node. */
export function useAnswerActions(options: Options): AnswerActions {
  const drafts = useAnswerDrafts(options);
  const stage = useCallback<AnswerActions["stage"]>((wait, reply) => drafts.stage(wait.id, rowIdOf(wait), reply), [drafts]);
  const unstage = useCallback<AnswerActions["unstage"]>((wait) => drafts.unstage(wait.id, rowIdOf(wait)), [drafts]);
  const send = useCallback<AnswerActions["send"]>(
    async (wait, reply) => {
      const id = rowIdOf(wait);
      if (reply !== undefined && !(await drafts.stage(wait.id, id, reply))) return false;
      const shown = useAgentActivityStore.getState().stagedWaitIds;
      return drafts.send(wait.id, shown.includes(id) ? shown : [...shown, id]);
    },
    [drafts],
  );
  return useMemo(() => ({ stage, unstage, send }), [stage, unstage, send]);
}

/** The board-wide Send: the top bar's button and the palette's entry. */
export interface StagedSender {
  /** How many answers are staged on the whole board. */
  count: number;
  /** Sends them all, saying any that were skipped. */
  send: () => Promise<boolean>;
}

export function useStagedSender(): StagedSender {
  const settle = useBoardStore((s) => s.settle);
  const showToast = useMindmapStore((s) => s.showToast);
  const drafts = useAnswerDrafts({ settle, showToast });
  const ids = useAgentActivityStore((s) => s.stagedWaitIds);
  const send = useCallback(async () => {
    const shown = useAgentActivityStore.getState().stagedWaitIds;
    const landed = await drafts.send("", shown);
    releaseFocus();
    return landed;
  }, [drafts]);
  return { count: ids.length, send };
}
