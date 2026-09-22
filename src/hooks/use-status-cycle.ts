import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { updateTask } from "@/api/tasks";
import { updateGoal } from "@/api/goals";
import { getErrorMessage } from "@/api/errors";
import { GOAL_STATUS, TASK_STATUS } from "@/utils/status-mapping";
import type { MindmapNode } from "@/utils/tree-layout";
import { useOccurrenceCompletion } from "@/hooks/use-occurrence-completion";
import type { OccurrencePrompt } from "@/hooks/use-occurrence-completion";

const LOG_PREFIX = "[arlesh]";

function nextTaskStatus(current: string): string {
  if (current === TASK_STATUS.IN_PROGRESS) return TASK_STATUS.DONE;
  if (current === TASK_STATUS.DONE) return TASK_STATUS.TODO;
  return TASK_STATUS.IN_PROGRESS;
}

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
 * A real Goal toggles active ↔ achieved; a real Task cycles todo → in progress → done; a virtual
 * Habit instance advances just itself, writing a Modification, with `null` clearing back to the
 * base status. A **Commitment** is excluded: it is kept or broken, never advanced, and its verdict
 * has its own writer.
 *
 * Marking an occurrence done while it still holds unfinished added children goes through the
 * completion guard, which asks first and names them — so the question is asked the same way from
 * every view rather than only from the one that happened to implement it.
 *
 * It lives here because there are now three callers. The Mindmap's `useNodeActions` delegates to
 * it, the Steps View uses it directly, and every future surface that draws a status glyph gets the
 * occurrence guard for free rather than rediscovering that it needed one.
 */
export function useStatusCycle({ findNode, reload, showToast }: Options): StatusCycle {
  const { t } = useTranslation(["warnings"]);
  const { prompt: occurrencePrompt, setOccurrenceStatus, confirm: confirmOccurrence,
    cancel: cancelOccurrence } = useOccurrenceCompletion(reload);

  const cycleStatus = useCallback(
    (nodeId: string) => {
      const node = findNode(nodeId);
      if (node === undefined) return;
      if (node.habitItem !== undefined && node.kind !== "commitment") {
        let next: string | null;
        if (node.kind === "goal") {
          next = node.status === GOAL_STATUS.ACHIEVED ? null : TASK_STATUS.DONE;
        } else {
          const cycled = nextTaskStatus(node.status ?? TASK_STATUS.TODO);
          next = cycled === TASK_STATUS.TODO ? null : cycled;
        }
        setOccurrenceStatus(node, next);
        return;
      }
      if (node.kind === "goal") {
        const dbId = parseInt(nodeId.split("-").pop() ?? "0", 10);
        const next = node.status === GOAL_STATUS.ACHIEVED ? GOAL_STATUS.ACTIVE : GOAL_STATUS.ACHIEVED;
        void updateGoal(dbId, { status: next })
          .then(() => reload())
          .catch((err: unknown) => {
            console.error(`${LOG_PREFIX} goal status toggle failed:`, err);
            showToast({ nodeId, message: t("warnings:statusChangeFailed", { message: getErrorMessage(err) }) });
          });
        return;
      }
      if (node.kind !== "task") return;
      const dbId = parseInt(nodeId.split("-").pop() ?? "0", 10);
      void updateTask(dbId, { status: nextTaskStatus(node.status ?? TASK_STATUS.TODO) })
        .then(() => reload())
        .catch((err: unknown) => {
          console.error(`${LOG_PREFIX} status cycle failed:`, err);
          showToast({ nodeId, message: t("warnings:statusChangeFailed", { message: getErrorMessage(err) }) });
        });
    },
    [findNode, reload, setOccurrenceStatus, showToast, t],
  );

  return { cycleStatus, occurrencePrompt, confirmOccurrence, cancelOccurrence };
}
