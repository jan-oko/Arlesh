import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { updateTask } from "@/api/tasks";
import { updateGoal } from "@/api/goals";
import { getErrorMessage } from "@/api/errors";
import { GOAL_STATUS, TASK_STATUS } from "@/utils/status-mapping";
import { cameOutOfBacklog, nextTaskStatus } from "@/utils/task-status-cycle";
import type { MindmapNode } from "@/utils/tree-layout";
import { rowIdOf } from "@/utils/node-identity";
import { useOccurrenceCompletion } from "@/hooks/use-occurrence-completion";
import type { OccurrencePrompt } from "@/hooks/use-occurrence-completion";
import { useExpectationActions } from "@/hooks/use-expectation-actions";

const LOG_PREFIX = "[arlesh]";

interface Options {
  findNode: (id: string) => MindmapNode | undefined;
  reload: () => Promise<void>;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

interface StatusCycle {
  /** Advances the node's status by one — the same step a click on its glyph takes. */
  cycleStatus: (nodeId: string) => void;
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
 * Two rules travel with the gesture rather than with the caller, which is the whole point of it
 * living here. Marking an occurrence done while it still holds unfinished added children goes
 * through the **completion guard**, which asks first and names them. And starting a set-aside Task
 * **takes it out of the Backlog** — read off the row the backend sent back rather than predicted,
 * and said out loud, because a flag that stops being true without a word is a flag you stop
 * trusting.
 *
 * It lives here because there are now three callers. The Mindmap's `useNodeActions` delegates to
 * it and the Steps View uses it directly, so every surface that draws a status glyph gets both of
 * those rules rather than rediscovering that it needed them.
 */
export function useStatusCycle({ findNode, reload, showToast }: Options): StatusCycle {
  const { t } = useTranslation(["warnings"]);
  const { prompt: occurrencePrompt, guard, confirm: confirmOccurrence,
    cancel: cancelOccurrence } = useOccurrenceCompletion();
  const { completeCheck, toggleRelease } = useExpectationActions({ findNode, reload, showToast });

  const cycleStatus = useCallback(
    (nodeId: string) => {
      const node = findNode(nodeId);
      if (node === undefined) return;
      // A wait's glyph releases it (or takes the release back); its check task's completes the
      // check, which records when and stores nothing else.
      if (node.expectationCheck !== undefined) { completeCheck(nodeId); return; }
      if (node.kind === "expectation") { toggleRelease(nodeId); return; }
      // A Habit occurrence is an ordinary row (ADR 0008): its glyph advances it exactly as it
      // advances a stored one, through the completion guard that asks before an occurrence closes
      // over unfinished work.
      const failed = (message: string) => (err: unknown): void => {
        console.error(`${LOG_PREFIX} ${message}:`, err);
        showToast({ nodeId, message: t("warnings:statusChangeFailed", { message: getErrorMessage(err) }) });
      };
      // A goal toggles active ↔ achieved on click — no modal.
      if (node.kind === "goal") {
        const dbId = rowIdOf(node);
        const next = node.status === GOAL_STATUS.ACHIEVED ? GOAL_STATUS.ACTIVE : GOAL_STATUS.ACHIEVED;
        guard(node, async (confirmed) => {
          await updateGoal(dbId, { status: next }, confirmed);
          await reload();
        }, failed("goal status toggle failed"));
        return;
      }
      if (node.kind !== "task") return;
      const dbId = rowIdOf(node);
      const next = nextTaskStatus(node.status ?? TASK_STATUS.TODO);
      guard(node, async (confirmed) => {
        const updated = await updateTask(dbId, { status: next }, confirmed);
        // Starting a set-aside task takes it out of the backlog, in the same write and so in the
        // same undo step. The row that comes back says whether it did; it is never assumed.
        if (cameOutOfBacklog(node, updated)) {
          showToast({ nodeId, message: t("warnings:backlogClearedByStart") });
        }
        await reload();
      }, failed("status cycle failed"));
    },
    [findNode, reload, guard, showToast, t, completeCheck, toggleRelease],
  );

  return { cycleStatus, occurrencePrompt, confirmOccurrence, cancelOccurrence };
}
