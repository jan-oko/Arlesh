import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { updateGoal } from "@/api/goals";
import type { BacklogCleared, StatusRefusal, StatusStep } from "@/api/node-gestures";
import { stepTaskStatus } from "@/api/node-gestures";
import { GOAL_STATUS } from "@/utils/status-mapping";
import { goalAnswerFields, taskAnswerFields, writtenWith } from "@/utils/answer-fields";
import { statusAfter } from "@/utils/task-gestures";
import type { MindmapNode } from "@/utils/tree-layout";
import { rowIdOf } from "@/utils/node-identity";
import { acknowledged, useOccurrenceCompletion } from "@/hooks/use-occurrence-completion";
import type { OccurrencePrompt } from "@/hooks/use-occurrence-completion";
import { useExpectationActions } from "@/hooks/use-expectation-actions";
import { useReadOnlyNotice } from "@/hooks/use-read-only-notice";

/** The `warnings` key that says why a status gesture wrote nothing. */
const REFUSAL_MESSAGE: Record<StatusRefusal, "compoundStatusRefused" | "altEnterAgenticNotDoing"> = {
  compound: "compoundStatusRefused",
  alt_enter_agentic_not_doing: "altEnterAgenticNotDoing",
};

/** The `warnings` key that names a Task coming out of the Backlog, by the status that did it. */
const BACKLOG_CLEARED_MESSAGE: Record<BacklogCleared, "backlogClearedByStart" | "backlogClearedByStarted"> = {
  by_start: "backlogClearedByStart",
  by_started: "backlogClearedByStarted",
};


interface Options {
  findNode: (id: string) => MindmapNode | undefined;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

interface StatusCycle {
  /** Advances the node's status by one — the same step a click on its glyph takes. */
  cycleStatus: (nodeId: string) => void;
  /** `Alt+Enter`: on an ordinary Task, sets it **Started** or resumes a Started one to In
   * Progress; on an Agentic one, hands a Doing Task back to its agent (On Agent), and anywhere
   * else says it cannot. Anything that is not a Task is left alone. */
  toggleStarted: (nodeId: string) => void;
  /** The occurrence completion the backend is holding for confirmation, or `null`. */
  occurrencePrompt: OccurrencePrompt | null;
  /** Answers that prompt: marks the occurrence done and leaves its children in place. */
  confirmOccurrence: () => void;
  /** Declines it. Nothing was written, so nothing is undone. */
  cancelOccurrence: () => void;
}

/**
 * **One definition of "advance this node's status"**, for every surface that offers the gesture.
 *
 * A Goal toggles active ↔ achieved; a Task cycles todo → in progress → done — a Habit occurrence
 * exactly as a stored row, since it is one (ADR 0008). A **Commitment** is excluded: it is kept or broken, never advanced, and its verdict
 * has its own writer.
 *
 * A press is **shown at once** and sent through the window's lane (ADR 0012): the status it writes
 * is predicted by `utils/task-gestures.ts`, a pinned copy of `tasks::rules::gestures`, and the
 * status the board shows after the answer is the returned row's. A Compound Task's press, and
 * `Alt+Enter` on Agentic work that is not Doing, are refused here with their toast and write nothing.
 *
 * Two rules travel with the gesture rather than with the caller, which is the whole point of it
 * living here. Marking an occurrence done while it still holds unfinished added children goes
 * through the **completion guard**, which rolls the patch back, asks first and names them. And
 * starting a set-aside Task **takes it out of the Backlog** — read off the row the backend sent back
 * rather than predicted, and said out loud, because a flag that stops being true without a word is
 * a flag you stop trusting.
 *
 * It lives here because there are now three callers. The Mindmap's `useNodeActions` delegates to
 * it and the Steps View uses it directly, so every surface that draws a status glyph gets both of
 * those rules rather than rediscovering that it needed them.
 */
export function useStatusCycle({ findNode, showToast }: Options): StatusCycle {
  const { t } = useTranslation(["warnings"]);
  const { prompt: occurrencePrompt, submit, confirm: confirmOccurrence,
    cancel: cancelOccurrence } = useOccurrenceCompletion({ showToast });
  const { toggleRelease } = useExpectationActions({ findNode, showToast });
  const readOnlyNotice = useReadOnlyNotice();

  const refuseReadOnly = useCallback(
    (nodeId: string) => (): void => {
      showToast({ nodeId, message: t("warnings:statusChangeFailed", { message: readOnlyNotice() }) });
    },
    [showToast, t, readOnlyNotice],
  );

  // One status gesture on a Task. What it writes is predicted by the pinned copy of the backend's
  // rule, and a refusal that rule makes is said here without a write; the backend still decides
  // (`tasks::rules::gestures`) and says when it refused anyway, and when the write took a set-aside
  // Task out of the Backlog. Both are said out loud; neither is predicted.
  const stepStatus = useCallback(
    (node: MindmapNode, step: StatusStep) => {
      if (node.taskStatus === undefined) return;
      const prediction = statusAfter(step, node.taskStatus, node.compound === true);
      if (prediction.outcome === "refused") {
        showToast({ nodeId: node.id, message: t(`warnings:${REFUSAL_MESSAGE[prediction.reason]}`) });
        return;
      }
      const { status } = prediction;
      submit(node, {
        label: "status change",
        patch: { kind: "fields", fields: { status: status.status, taskStatus: status } },
        refuseReadOnly: refuseReadOnly(node.id),
        send: async (confirmed) => {
          const outcome = await stepTaskStatus(rowIdOf(node), step, ...acknowledged(confirmed));
          if (outcome.outcome === "refused") {
            return { outcome: "refused", message: t(`warnings:${REFUSAL_MESSAGE[outcome.reason]}`) };
          }
          if (outcome.backlog_cleared !== null) {
            showToast({ nodeId: node.id, message: t(`warnings:${BACKLOG_CLEARED_MESSAGE[outcome.backlog_cleared]}`) });
          }
          return writtenWith(taskAnswerFields(outcome.task));
        },
      });
    },
    [submit, refuseReadOnly, showToast, t],
  );

  const cycleStatus = useCallback(
    (nodeId: string) => {
      const node = findNode(nodeId);
      if (node === undefined) return;
      // A wait's glyph releases it (or takes the release back). Its check task is a Task row, and
      // cycles like one: marking it done records the check, and taking it back reopens it.
      if (node.kind === "expectation") { toggleRelease(nodeId); return; }
      // A goal toggles active ↔ achieved on click — no modal.
      if (node.kind === "goal") {
        const dbId = rowIdOf(node);
        const next = node.status === GOAL_STATUS.ACHIEVED ? GOAL_STATUS.ACTIVE : GOAL_STATUS.ACHIEVED;
        submit(node, {
          label: "status change",
          patch: { kind: "fields", fields: { status: next } },
          refuseReadOnly: refuseReadOnly(nodeId),
          send: async (confirmed) =>
            writtenWith(goalAnswerFields(await updateGoal(dbId, { status: next }, ...acknowledged(confirmed)))),
        });
        return;
      }
      // A Habit occurrence is an ordinary row (ADR 0008): its glyph advances it exactly as it
      // advances a stored one, through the completion guard that asks before an occurrence closes
      // over unfinished work.
      if (node.kind !== "task") return;
      stepStatus(node, "advance");
    },
    [findNode, submit, refuseReadOnly, toggleRelease, stepStatus],
  );

  const toggleStarted = useCallback(
    (nodeId: string) => {
      const node = findNode(nodeId);
      if (node?.kind !== "task") return;
      stepStatus(node, "alt");
    },
    [findNode, stepStatus],
  );

  return { cycleStatus, toggleStarted, occurrencePrompt, confirmOccurrence, cancelOccurrence };
}
