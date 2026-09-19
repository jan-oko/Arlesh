import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import { updateTask } from "@/api/tasks";
import { getErrorMessage } from "@/api/errors";
import { nextAgenticState, storedAgenticState } from "@/utils/agentic";

interface Options {
  findNode: (id: string) => MindmapNode | undefined;
  reload: () => Promise<void>;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

interface Result {
  /** Advances the task one step around Inherit → Agentic → Not agentic. One node, never a
   * multi-selection — the same scope the Backlog key acts at. */
  cycleAgentic: (nodeId: string) => void;
}

function dbIdOf(nodeId: string): number {
  return parseInt(nodeId.split("-").pop() ?? "", 10);
}

/**
 * The Agentic cycle shared by both views: read the task's **own** stored flag, write the next one.
 *
 * A plain update with no invariant to negotiate — unlike Backlog, which a Plan can refuse — so the
 * only interesting parts are which state comes next ({@link nextAgenticState}) and which nodes the
 * key declines to act on.
 *
 * The write is driven by `storedAgenticState(node.agentic)`, the task's own column, never by what
 * it resolves to. Cycling from what it *reads as* would turn a press on a task inheriting "yes"
 * into an explicit one, silently detaching it from the ancestor that was deciding for it.
 */
export function useTaskAgentic({ findNode, reload, showToast }: Options): Result {
  const { t } = useTranslation("warnings");

  const cycleAgentic = useCallback(
    (nodeId: string) => {
      const node = findNode(nodeId);
      // Only a real Task has an agentic column: a virtual Habit instance is rendered from a
      // template and has no row of its own to flag — its id has no database id to address, so
      // this is a refusal to act rather than a write that would go nowhere.
      if (node === undefined || node.kind !== "task" || node.habitItem !== undefined) return;
      const next = nextAgenticState(storedAgenticState(node.agentic));
      void updateTask(dbIdOf(nodeId), { agentic: next }).then(
        () => reload(),
        (error: unknown) => {
          showToast({ nodeId, message: t("agenticFailed", { message: getErrorMessage(error) }) });
        },
      );
    },
    [findNode, reload, showToast, t],
  );

  return { cycleAgentic };
}
