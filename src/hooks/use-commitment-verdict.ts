import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import { rowIdOf } from "@/utils/node-identity";
import type { VerdictPress } from "@/api/node-gestures";
import { pressCommitmentVerdict } from "@/api/node-gestures";
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
 * Nothing is derived and nothing is predicted: the press goes to the backend, which decides the
 * verdict it leaves (`tasks::rules::gestures::verdict_after`), and the tree is reloaded, so what the
 * user sees afterwards is what was stored.
 */
export function useCommitmentVerdict({ findNode, reload, showToast }: Options): Result {
  const { t } = useTranslation("warnings");

  const record = useCallback(
    (nodeId: string, press: VerdictPress) => {
      const node = findNode(nodeId);
      if (node === undefined || node.kind !== "commitment") return;
      // A commitment Habit's iteration is an ordinary Commitment row (ADR 0008), so its verdict
      // is written like any other's; clearing it back to Unresolved leaves nothing recorded on
      // the occurrence, which is what "you have not said" is.
      const write = pressCommitmentVerdict(rowIdOf(node), press);
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
    markKept: useCallback((nodeId: string) => record(nodeId, "kept"), [record]),
    markBroken: useCallback((nodeId: string) => record(nodeId, "broken"), [record]),
    cycleVerdict: useCallback((nodeId: string) => record(nodeId, "cycle"), [record]),
  };
}
