import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import type { Verdict } from "@/api/commitments";
import { VERDICT, updateCommitment, verdictAfterPressing } from "@/api/commitments";
import { setHabitItemStatus } from "@/api/flows";
import { getErrorMessage } from "@/api/errors";

interface Options {
  findNode: (id: string) => MindmapNode | undefined;
  reload: () => Promise<void>;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

interface Result {
  /** Records that the commitment was held to — or clears the verdict if it already said so. */
  markKept: (nodeId: string) => void;
  /** Records that it was not — or clears the verdict if it already said so. */
  markBroken: (nodeId: string) => void;
}

function dbIdOf(nodeId: string): number {
  return parseInt(nodeId.split("-").pop() ?? "", 10);
}

/**
 * The two verdict controls, shared by every surface that offers them.
 *
 * Two explicit actions rather than one cycling control, because Kept and Broken are equal
 * outcomes and Broken must never be one stray keystroke past Kept. Each one **toggles**: pressing
 * it on a commitment that already reads that way clears the verdict back to Unresolved, which is
 * how a misclick is taken back. Neither ever moves straight from one verdict to the other.
 *
 * Nothing is derived and nothing is predicted: the write goes to the backend and the tree is
 * reloaded, so what the user sees afterwards is what was stored.
 */
export function useCommitmentVerdict({ findNode, reload, showToast }: Options): Result {
  const { t } = useTranslation("warnings");

  const record = useCallback(
    (nodeId: string, pressed: Exclude<Verdict, "unresolved">) => {
      const node = findNode(nodeId);
      if (node === undefined || node.kind !== "commitment") return;
      const next = verdictAfterPressing(pressed, node.verdict ?? VERDICT.UNRESOLVED);
      // A commitment Habit's iteration is virtual: it has no row of its own, so its verdict is a
      // per-iteration Modification, in the same slot an ordinary instance keeps its status in.
      // Clearing one back to Unresolved removes the Modification, exactly as un-completing a task
      // instance does — there is then nothing recorded, which is what "you have not said" is.
      const write =
        node.habitItem === undefined
          ? updateCommitment(dbIdOf(nodeId), { verdict: next }).then(() => undefined)
          : setHabitItemStatus(
              node.habitItem.flowId,
              node.habitItem.itemType,
              node.habitItem.itemId,
              node.habitItem.scopeId,
              next === VERDICT.UNRESOLVED ? null : next,
              Date.now(),
            );
      void write.then(
        () => reload(),
        (error: unknown) => {
          showToast({ nodeId, message: t("verdictFailed", { message: getErrorMessage(error) }) });
        },
      );
    },
    [findNode, reload, showToast, t],
  );

  return {
    markKept: useCallback((nodeId: string) => record(nodeId, VERDICT.KEPT), [record]),
    markBroken: useCallback((nodeId: string) => record(nodeId, VERDICT.BROKEN), [record]),
  };
}
