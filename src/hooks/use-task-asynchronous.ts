import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
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

function dbIdOf(nodeId: string): number {
  return parseInt(nodeId.split("-").pop() ?? "", 10);
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
      // Only a real Task has the column: a virtual Habit instance is rendered from a template and
      // has no row of its own to flag — its id carries no database id to address, so this is a
      // refusal to act rather than a write that would go nowhere.
      if (node === undefined || node.kind !== "task" || node.habitItem !== undefined) return;
      void updateTask(dbIdOf(nodeId), { asynchronous: node.asynchronous !== true }).then(
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
