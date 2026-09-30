import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import { rowIdOf } from "@/utils/node-identity";
import { isDerivedId } from "@/api/node-id";
import { updateTask } from "@/api/tasks";
import { getErrorMessage } from "@/api/errors";

interface Options {
  findNode: (id: string) => MindmapNode | undefined;
  reload: () => Promise<void>;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

interface Result {
  /** `V`: switches the Task between consisting of its sub-items and having its status set by
   * hand. One node, never a multi-selection — the scope every flag key acts at. */
  toggleConsistence: (nodeId: string) => void;
}

/**
 * The Consistence toggle every view shares: read the Task's own flag, write the opposite.
 *
 * Switching it **off** sends the flag alone: the backend keeps the status the Task was showing —
 * the one its sub-items gave it — as its own, in the same write, so one `Ctrl+Z` takes both back.
 * Only a stored Task carries the flag; a Habit occurrence or a check task is turned away out loud
 * rather than left looking like a key that did nothing.
 */
export function useTaskConsistence({ findNode, reload, showToast }: Options): Result {
  const { t } = useTranslation("warnings");

  const toggleConsistence = useCallback(
    (nodeId: string) => {
      const node = findNode(nodeId);
      if (node === undefined || node.kind !== "task" || node.rowId === undefined) return;
      const rowId = rowIdOf(node);
      if (isDerivedId(rowId)) {
        showToast({ nodeId, message: t("consistenceOnDerived") });
        return;
      }
      void updateTask(rowId, { consistent: node.consistent !== true }).then(
        () => reload(),
        (error: unknown) => {
          showToast({ nodeId, message: t("consistenceFailed", { message: getErrorMessage(error) }) });
        },
      );
    },
    [findNode, reload, showToast, t],
  );

  return { toggleConsistence };
}
