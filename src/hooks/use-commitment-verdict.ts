import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import { rowIdOf } from "@/utils/node-identity";
import type { VerdictPress } from "@/api/node-gestures";
import { pressCommitmentVerdict } from "@/api/node-gestures";
import { usePendingWrite } from "@/hooks/use-pending-write";
import { useReadOnlyNotice } from "@/hooks/use-read-only-notice";
import { commitmentAnswerFields, writtenWith } from "@/utils/answer-fields";
import { verdictAfter } from "@/utils/task-gestures";

interface Options {
  findNode: (id: string) => MindmapNode | undefined;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

interface Result {
  /** Records that the commitment was held to — or clears the verdict if it already said so. */
  markKept: (nodeId: string) => void;
  /** Records that it was not — or clears the verdict if it already said so. */
  markBroken: (nodeId: string) => void;
  /** Advances the verdict one step: Unresolved → Kept → Broken → Unresolved. */
  cycleVerdict: (nodeId: string) => void;
}

/**
 * The ways a verdict is recorded, shared by every surface that offers them.
 *
 * The two **controls** stay two explicit actions rather than one cycling control, because Kept and
 * Broken are equal outcomes: each one toggles, so pressing the one a commitment already reads
 * clears the verdict back to Unresolved — which is how a misclick is taken back — and neither ever
 * moves straight from one verdict to the other. `cycleVerdict` is the keyboard's route through all
 * three in one key, offered beside them rather than in place of them.
 *
 * A press is shown at once and sent through the window's lane (ADR 0012): the verdict it leaves is
 * predicted by `utils/task-gestures.ts`, a pinned copy of `tasks::rules::gestures::verdict_after`,
 * and once the server has answered the board shows the returned row's verdict. Nothing else is
 * derived here: `met` and the rest wait for the board that follows.
 */
export function useCommitmentVerdict({ findNode, showToast }: Options): Result {
  const { t } = useTranslation("warnings");
  const enqueue = usePendingWrite({ showToast });
  const readOnlyNotice = useReadOnlyNotice();

  const record = useCallback(
    (nodeId: string, press: VerdictPress) => {
      const node = findNode(nodeId);
      if (node === undefined || node.kind !== "commitment") return;
      // A commitment Habit's iteration is an ordinary Commitment row (ADR 0008), so its verdict
      // is written like any other's; clearing it back to Unresolved leaves nothing recorded on
      // the occurrence, which is what "you have not said" is.
      const id = rowIdOf(node);
      enqueue({
        nodeId,
        label: "verdict",
        patch: { kind: "fields", fields: { verdict: verdictAfter(press, node.verdict ?? "unresolved") } },
        refuseReadOnly: () => {
          showToast({ nodeId, message: t("verdictFailed", { message: readOnlyNotice() }) });
        },
        send: async () => writtenWith(commitmentAnswerFields(await pressCommitmentVerdict(id, press))),
      });
    },
    [findNode, enqueue, showToast, t, readOnlyNotice],
  );

  return {
    markKept: useCallback((nodeId: string) => record(nodeId, "kept"), [record]),
    markBroken: useCallback((nodeId: string) => record(nodeId, "broken"), [record]),
    cycleVerdict: useCallback((nodeId: string) => record(nodeId, "cycle"), [record]),
  };
}
