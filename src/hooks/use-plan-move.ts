import { useCallback } from "react";
import { updateTask } from "@/api/tasks";
import { getErrorMessage } from "@/api/errors";
import { useTranslation } from "react-i18next";
import type { PendingToast } from "@/stores/use-mindmap-store";
import type { TaskListRow } from "@/utils/list-filter";
import type { ScopeInterval } from "@/utils/scope-interval";
import type { ScopeWindows } from "@/utils/plan-triage";
import { planRefusal } from "@/utils/plan-triage";

interface PlanMoveOptions {
  /** The scope being filled, once it is materialized. */
  targetScopeId: number | null;
  /** That scope's window, once it is resolved. */
  targetWindow: ScopeInterval | null;
  /** The scope in words, for the refusal messages. */
  targetLabel: string;
  /** Every window the containment check reads. */
  windows: ScopeWindows;
  reload: () => Promise<void>;
  showToast: (toast: PendingToast) => void;
}

/**
 * Planning a task into the scope, and taking it back out again. Each resolves to whether the move
 * actually happened, so the caller can advance its cursor on a move and leave it alone on a
 * refusal — a selection that walked on from a task that did not move would be the view quietly
 * disagreeing with the toast beside it.
 */
export interface PlanMoveHandles {
  planInto: (row: TaskListRow) => Promise<boolean>;
  unplan: (row: TaskListRow) => Promise<boolean>;
}

/**
 * The Plan View's one write: a task's Plan, set to the scope being filled or cleared.
 *
 * **A containment failure refuses the move** rather than widening anything on the user's behalf.
 * `Plan ⊆ TimeScope` and `child.Plan ⊆ parent.Plan` both hold as written, and a task whose own
 * window is too narrow for the scope is a task whose window needs an editing decision — which is
 * the editor's job, not a triage gesture's. The refusal is raised here, before the write, so the
 * toast can name *which* bound stopped it; the backend checks the same two rules on the way in, so
 * a refusal this view somehow lets through is still refused, just less precisely.
 *
 * Planning a **backlogged** task takes it out of the Backlog — the model forbids a task being both
 * — and that is said out loud in a toast rather than left to be noticed from a badge that quietly
 * stopped being drawn.
 */
export function usePlanMove({
  targetScopeId, targetWindow, targetLabel, windows, reload, showToast,
}: PlanMoveOptions): PlanMoveHandles {
  const { t } = useTranslation("planView");

  const report = useCallback(
    (row: TaskListRow, error: unknown) => {
      showToast({
        nodeId: row.node.id,
        message: t("moveFailed", { title: row.node.title, message: getErrorMessage(error) }),
      });
    },
    [showToast, t],
  );

  const planInto = useCallback(
    async (row: TaskListRow): Promise<boolean> => {
      const id = row.node.rowId;
      if (id === undefined || targetScopeId === null || targetWindow === null) return false;
      const refusal = planRefusal(row, targetWindow, windows);
      if (refusal !== null) {
        const key = refusal === "ownTimeScope" ? "refusedTimeScope" : "refusedParentPlan";
        showToast({ nodeId: row.node.id, message: t(key, { title: row.node.title, scope: targetLabel }) });
        return false;
      }
      const wasBacklogged = row.node.backlogged === true;
      try {
        await updateTask(id, { plan: { start_id: targetScopeId, end_id: targetScopeId } });
      } catch (error: unknown) {
        report(row, error);
        return false;
      }
      if (wasBacklogged) {
        showToast({
          nodeId: row.node.id,
          message: t("unbacklogged", { title: row.node.title, scope: targetLabel }),
        });
      }
      await reload();
      return true;
    },
    [targetScopeId, targetWindow, targetLabel, windows, reload, showToast, t, report],
  );

  const unplan = useCallback(
    async (row: TaskListRow): Promise<boolean> => {
      const id = row.node.rowId;
      if (id === undefined) return false;
      try {
        await updateTask(id, { plan: null });
      } catch (error: unknown) {
        report(row, error);
        return false;
      }
      await reload();
      return true;
    },
    [reload, report],
  );

  return { planInto, unplan };
}
