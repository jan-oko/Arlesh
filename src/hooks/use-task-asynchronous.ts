import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import { rowIdOf } from "@/utils/node-identity";
import { updateTask } from "@/api/tasks";
import { getErrorMessage } from "@/api/errors";

interface Options {
  findNode: (id: string) => MindmapNode | undefined;
  reload: () => Promise<void>;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

interface Result {
  /** Flips the task between Asynchronous and not. One node, never a multi-selection — the same
   * scope the Backlog and Agentic keys act at. */
  toggleAsynchronous: (nodeId: string) => void;
}

/**
 * The Asynchronous toggle shared by both views: read the task's own flag, write the opposite.
 *
 * Simpler than its Agentic counterpart, and deliberately so. The flag is a plain boolean that does
 * not inherit, so there is no resolved value to read through and no third state to resolve: what
 * the badge shows is what the column holds, and one press flips both.
 */
export function useTaskAsynchronous({ findNode, reload, showToast }: Options): Result {
  const { t } = useTranslation("warnings");

  const toggleAsynchronous = useCallback(
    (nodeId: string) => {
      const node = findNode(nodeId);
      // Any Task row, a Habit occurrence included: its flag lands on that occurrence alone.
      if (node === undefined || node.kind !== "task" || node.rowId === undefined) return;
      void updateTask(rowIdOf(node), { asynchronous: node.asynchronous !== true }).then(
        () => reload(),
        (error: unknown) => {
          showToast({ nodeId, message: t("asynchronousFailed", { message: getErrorMessage(error) }) });
        },
      );
    },
    [findNode, reload, showToast, t],
  );

  return { toggleAsynchronous };
}
