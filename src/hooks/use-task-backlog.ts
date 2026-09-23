import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import { rowIdOf } from "@/utils/node-identity";
import type { TimeScope } from "@/api/time-scope";
import { updateTask, backlogNeedsPlanCleared, TASK_ARCHIVAL } from "@/api/tasks";
import { getErrorMessage } from "@/api/errors";

/**
 * A pending "this task is planned — clear the plan and set it aside?" prompt.
 *
 * Raised only by the backend refusing the write, never predicted here: the invariant belongs to
 * the model, and a frontend guess about it is one more place for the two to drift apart.
 */
export interface BacklogPlanPrompt {
  nodeId: string;
  /** The task row the confirmed write goes to. */
  rowId: number;
  title: string;
  plan: TimeScope | null;
}

interface Options {
  findNode: (id: string) => MindmapNode | undefined;
  reload: () => Promise<void>;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

interface Result {
  /** Puts the task in the backlog, or takes it out. Acts on one node — never a multi-selection. */
  toggleBacklog: (nodeId: string) => void;
  /** The pending clear-the-plan prompt, or `null`. */
  planPrompt: BacklogPlanPrompt | null;
  /** Clears the Plan and backlogs the task in one write. */
  confirmClearPlan: () => void;
  /** Declines: the task keeps its plan and stays out of the backlog. */
  cancelPlanPrompt: () => void;
}

/**
 * The Backlog toggle shared by both views: the write, the one refusal that is really a question,
 * and the prompt that answers it.
 *
 * Backlog is a stored state, so this is a plain update — the node's own `backlogged` flag decides
 * which way the toggle goes. The single interesting case is the invariant: a Task is never both
 * backlogged and planned, so backlogging a planned one comes back refused, and that refusal
 * becomes a prompt offering to clear the Plan and set the task aside in one action. Declining
 * leaves both the plan and the backlog state exactly as they were, because nothing was written.
 */
export function useTaskBacklog({ findNode, reload, showToast }: Options): Result {
  const { t } = useTranslation("warnings");
  const [planPrompt, setPlanPrompt] = useState<BacklogPlanPrompt | null>(null);

  const reportFailure = useCallback(
    (nodeId: string, error: unknown) => {
      showToast({ nodeId, message: t("backlogFailed", { message: getErrorMessage(error) }) });
    },
    [showToast, t],
  );

  const toggleBacklog = useCallback(
    (nodeId: string) => {
      const node = findNode(nodeId);
      // Only a real Task has a backlog column: a virtual Habit instance is rendered from a
      // template and has no row of its own to set aside.
      if (node === undefined || node.kind !== "task" || node.habitItem !== undefined) return;
      const next = node.backlogged === true ? TASK_ARCHIVAL.LIVE : TASK_ARCHIVAL.BACKLOG;
      const rowId = rowIdOf(node);
      void updateTask(rowId, { archival: next }).then(
        () => reload(),
        (error: unknown) => {
          if (backlogNeedsPlanCleared(error)) {
            setPlanPrompt({ nodeId, rowId, title: node.title, plan: node.plan ?? null });
            return;
          }
          reportFailure(nodeId, error);
        },
      );
    },
    [findNode, reload, reportFailure],
  );

  const confirmClearPlan = useCallback(() => {
    if (planPrompt === null) return;
    const { nodeId, rowId } = planPrompt;
    setPlanPrompt(null);
    // Both fields in one write: the plan going and the backlog arriving are the same decision, and
    // sending them separately would leave a moment where neither the old state nor the new holds.
    void updateTask(rowId, { archival: TASK_ARCHIVAL.BACKLOG, plan: null }).then(
      () => reload(),
      (error: unknown) => reportFailure(nodeId, error),
    );
  }, [planPrompt, reload, reportFailure]);

  const cancelPlanPrompt = useCallback(() => setPlanPrompt(null), []);

  return { toggleBacklog, planPrompt, confirmClearPlan, cancelPlanPrompt };
}
