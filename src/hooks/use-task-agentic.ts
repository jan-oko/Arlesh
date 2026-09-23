import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import { rowIdOf } from "@/utils/node-identity";
import { updateTask } from "@/api/tasks";
import { getErrorMessage } from "@/api/errors";
import { toggledAgenticState } from "@/utils/agentic";

interface Options {
  findNode: (id: string) => MindmapNode | undefined;
  reload: () => Promise<void>;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

interface Result {
  /** Flips the task between Agentic and Not agentic. One node, never a multi-selection — the same
   * scope the Backlog key acts at. */
  toggleAgentic: (nodeId: string) => void;
}

/**
 * The Agentic toggle shared by both views: read what the task **resolves to**, write the opposite.
 *
 * A plain update with no invariant to negotiate — unlike Backlog, which a Plan can refuse — so the
 * only interesting parts are which state the press writes ({@link toggledAgenticState}) and which
 * nodes the key declines to act on.
 *
 * Driven by the resolved value, so every press changes what the badge shows. A task that was only
 * inheriting "yes" is pinned to an explicit "no" by one press, which is the toggle doing its job:
 * the alternative is a press that reads as nothing happening. Detaching a task from the ancestor
 * deciding for it is now the editor's business, and so is putting it back.
 */
export function useTaskAgentic({ findNode, reload, showToast }: Options): Result {
  const { t } = useTranslation("warnings");

  const toggleAgentic = useCallback(
    (nodeId: string) => {
      const node = findNode(nodeId);
      // Only a real Task has an agentic column: a virtual Habit instance is rendered from a
      // template and has no row of its own to flag — it carries no `rowId` to address, so
      // this is a refusal to act rather than a write that would go nowhere.
      if (node === undefined || node.kind !== "task" || node.habitItem !== undefined) return;
      void updateTask(rowIdOf(node), { agentic: toggledAgenticState(node) }).then(
        () => reload(),
        (error: unknown) => {
          showToast({ nodeId, message: t("agenticFailed", { message: getErrorMessage(error) }) });
        },
      );
    },
    [findNode, reload, showToast, t],
  );

  return { toggleAgentic };
}
