import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import { rowIdOf } from "@/utils/node-identity";
import { updateTask } from "@/api/tasks";
import { getErrorMessage } from "@/api/errors";
import { takesCompound } from "@/utils/compound";

interface Options {
  findNode: (id: string) => MindmapNode | undefined;
  reload: () => Promise<void>;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

interface Result {
  /** `V`: switches the Task between consisting of its sub-items and having its status set by
   * hand. One node, never a multi-selection — the scope every flag key acts at. */
  toggleCompound: (nodeId: string) => void;
}

/**
 * The Compound toggle every view shares: read the Task's own flag, write the opposite.
 *
 * Switching it **off** sends the flag alone: the backend keeps the status the Task was showing —
 * the one its sub-items gave it — as its own, in the same write, so one `Ctrl+Z` takes both back.
 * A stored Task carries the flag, and so does a Habit occurrence of a flow Task item, over its
 * item's; an iteration's root or a check task is turned away out loud rather than left looking
 * like a key that did nothing.
 */
export function useTaskCompound({ findNode, reload, showToast }: Options): Result {
  const { t } = useTranslation("warnings");

  const toggleCompound = useCallback(
    (nodeId: string) => {
      const node = findNode(nodeId);
      if (node === undefined || node.kind !== "task" || node.rowId === undefined) return;
      if (!takesCompound(node)) {
        showToast({ nodeId, message: t("compoundOnDerived") });
        return;
      }
      const rowId = rowIdOf(node);
      void updateTask(rowId, { compound: node.compound !== true }).then(
        () => reload(),
        (error: unknown) => {
          showToast({ nodeId, message: t("compoundFailed", { message: getErrorMessage(error) }) });
        },
      );
    },
    [findNode, reload, showToast, t],
  );

  return { toggleCompound };
}
