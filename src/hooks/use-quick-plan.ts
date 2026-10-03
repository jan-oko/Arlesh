import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { getErrorMessage } from "@/api/errors";
import { withGesture } from "@/api/gesture";
import { updateTaskSettlingPlans } from "@/api/tasks";
import { usePlanClamp } from "@/hooks/use-plan-clamp";
import type { TimeScope } from "@/api/time-scope";
import type { PendingToast } from "@/stores/use-mindmap-store";
import { rowIdOf } from "@/utils/node-identity";
import { isOverdue } from "@/utils/overdue";
import { TASK_STATUS } from "@/utils/status-mapping";
import type { MindmapNode } from "@/utils/tree-layout";

/** What the open quick picker is planning. */
export interface QuickPlanTarget {
  /** The node the picker is drawn at — the selection's lead. */
  anchorId: string;
  /** The Tasks the pick is written to, lead first. Never empty. */
  tasks: readonly MindmapNode[];
  /** Selected nodes left out because they hold no Plan — named in the toast once the pick lands. */
  skipped: number;
  /** The lead Task's Plan, which the picker opens on and has selected. */
  value: TimeScope | null;
  /** The bound the picker is held to: the lead Task's Time Scope, or `null` for none (or Overdue). */
  timeScope: TimeScope | null;
}

interface Options {
  findNode: (id: string) => MindmapNode | undefined;
  reload: () => Promise<void>;
  showToast: (toast: PendingToast) => void;
}

/** The `P` quick picker: which Tasks it is open on, and the three ways it ends. */
export interface QuickPlan {
  target: QuickPlanTarget | null;
  /**
   * Opens the picker on `ids` (the lead first), or refuses out loud when none of them can hold a
   * Plan. Only a Task carries one — a stored Task or a Habit occurrence; a wait's drawn check task
   * has no row to write it to.
   */
  open: (ids: readonly string[]) => void;
  /** Writes `plan` (or clears it, with `null`) to every targeted Task, as one Gesture. */
  apply: (plan: TimeScope | null) => Promise<void>;
  /** Closes the picker without writing anything. */
  close: () => void;
}

/** Whether a node holds a Plan of its own: a Task with a row behind it. */
function holdsPlan(node: MindmapNode): boolean {
  return node.kind === "task" && node.virtual !== true && node.rowId !== undefined;
}

/** What a Task's own Plan must sit inside: the Plan it inherits, which already sits inside its
 * window, else its window. An Overdue Task's Plan may leave its passed window, exactly as the
 * editor's Plan field allows. */
function planBound(node: MindmapNode): TimeScope | null {
  if (node.inheritedPlan !== undefined) return node.inheritedPlan;
  if (isOverdue(node) && node.status !== TASK_STATUS.DONE) return null;
  return node.timeScope ?? null;
}

/** What one write across the batch did, so the view can say it in one sentence. */
interface Outcome {
  planned: MindmapNode[];
  failed: Array<{ node: MindmapNode; message: string }>;
  unbacklogged: MindmapNode[];
}

/**
 * Sets a Task's **Plan** without opening the editor — bare `P` on the Mindmap, List View and Steps
 * View.
 *
 * The write is the editor's own: `update_task` with the new `plan`, so every rule the backend holds
 * a Plan to applies unchanged — inside the Task's Time Scope (unless Overdue), inside the nearest
 * planned ancestor's Plan, a Habit occurrence's Plan landing in its overlay, and a backlogged Task
 * coming out of the Backlog. A refusal comes back from the backend and is shown as a toast.
 *
 * **A selection is one Gesture**, so planning five Tasks is one `Ctrl+Z`. It is a plain
 * {@link withGesture}, as the Plan View's batch is: a Task the backend turns away does not take
 * back the ones it accepted, and the toast counts it instead.
 */
export function useQuickPlan({ findNode, reload, showToast }: Options): QuickPlan {
  const { t } = useTranslation(["warnings", "undo"]);
  const [target, setTarget] = useState<QuickPlanTarget | null>(null);
  const askPlanClamp = usePlanClamp();

  const open = useCallback(
    (ids: readonly string[]) => {
      const nodes = ids.map(findNode).filter((node): node is MindmapNode => node !== undefined);
      const lead = nodes[0];
      if (lead === undefined) return;
      const tasks = nodes.filter(holdsPlan);
      const first = tasks[0];
      if (first === undefined) {
        const message = nodes.length === 1
          ? t("warnings:quickPlanNotTask", { title: lead.title })
          : t("warnings:quickPlanNoTasks");
        showToast({ nodeId: lead.id, message });
        return;
      }
      setTarget({
        anchorId: lead.id,
        tasks,
        skipped: nodes.length - tasks.length,
        value: first.plan ?? null,
        timeScope: planBound(first),
      });
    },
    [findNode, showToast, t],
  );

  const close = useCallback(() => setTarget(null), []);

  /** The one thing the batch most needs to say, or `null` when it went exactly as asked. */
  const headline = useCallback(
    (outcome: Outcome, planning: QuickPlanTarget): string | null => {
      const failure = outcome.failed[0];
      if (failure !== undefined) {
        const detail = { title: failure.node.title, message: failure.message };
        return planning.tasks.length === 1
          ? t("warnings:quickPlanFailed", detail)
          : t("warnings:quickPlanFailedSome", { ...detail, count: outcome.failed.length, total: planning.tasks.length });
      }
      if (planning.skipped > 0) return t("warnings:quickPlanSkippedNotTask", { count: planning.skipped });
      if (outcome.unbacklogged.length === 1) return t("warnings:backlogClearedByPlan");
      if (outcome.unbacklogged.length > 1) return t("warnings:backlogClearedByPlanMany", { count: outcome.unbacklogged.length });
      return null;
    },
    [t],
  );

  const apply = useCallback(
    async (plan: TimeScope | null) => {
      const planning = target;
      setTarget(null);
      if (planning === null) return;
      // Tasks below that hold their own Plans inside the old one are asked about first.
      const clamp = await askPlanClamp(planning.tasks.map((node) => ({ id: rowIdOf(node), plan })));
      if (!clamp.proceed) return;
      const outcome: Outcome = { planned: [], failed: [], unbacklogged: [] };
      const gesture = plan === null ? "undo:gestures.clearPlan" : "undo:gestures.plan";
      await withGesture(t(gesture, { count: planning.tasks.length }), async () => {
        for (const node of planning.tasks) {
          try {
            await updateTaskSettlingPlans(rowIdOf(node), { plan }, clamp.descendants);
          } catch (error: unknown) {
            outcome.failed.push({ node, message: getErrorMessage(error) });
            continue;
          }
          outcome.planned.push(node);
          if (plan !== null && node.backlogged === true) outcome.unbacklogged.push(node);
        }
      });
      if (outcome.planned.length > 0) await reload();
      const message = headline(outcome, planning);
      if (message !== null) showToast({ nodeId: planning.anchorId, message });
    },
    [target, askPlanClamp, reload, headline, showToast, t],
  );

  return { target, open, apply, close };
}
