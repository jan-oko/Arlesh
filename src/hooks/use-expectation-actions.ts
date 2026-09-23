import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import { rowIdOf } from "@/utils/node-identity";
import { clearExpectationCheckBy, updateExpectation } from "@/api/expectations";
import { EXPECTATION_STATUS } from "@/api/expectation-status";
import { getErrorMessage } from "@/api/errors";

interface Options {
  findNode: (id: string) => MindmapNode | undefined;
  reload: () => Promise<void>;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

interface Result {
  /**
   * Completes the check on a wait: clears the check-by of the selected Expectation, or of the one
   * a selected virtual check task belongs to. The Expectation stays pending; nothing is stored for
   * the check itself.
   */
  completeCheck: (nodeId: string) => void;
  /** Releases a pending Expectation, or takes a release back. */
  toggleRelease: (nodeId: string) => void;
}

/** The row id of the Expectation a node stands for: itself, or the one its check task belongs to. */
function expectationRowOf(node: MindmapNode): number | null {
  if (node.expectationCheck !== undefined) return node.expectationCheck.expectationId;
  if (node.kind === "expectation" && node.rowId !== undefined) return node.rowId;
  return null;
}

/**
 * The two Expectation gestures, shared by the Mindmap and the List View.
 *
 * Every refusal is said out loud: a delegated Task's wait is released by the Task being done and
 * by nothing else, and a wait with no check-by has no check to complete.
 */
export function useExpectationActions({ findNode, reload, showToast }: Options): Result {
  const { t } = useTranslation("expectation");

  const fail = useCallback(
    (nodeId: string) => (error: unknown) => {
      showToast({ nodeId, message: t("actionFailed", { message: getErrorMessage(error) }) });
    },
    [showToast, t],
  );

  const completeCheck = useCallback(
    (nodeId: string) => {
      const node = findNode(nodeId);
      if (node === undefined) return;
      if (node.delegationWait !== undefined) {
        showToast({ nodeId, message: t("delegationWaitHasNoCheck") });
        return;
      }
      const expectationId = expectationRowOf(node);
      if (expectationId === null) return;
      if (node.kind === "expectation" && (node.checkBy ?? null) === null) {
        showToast({ nodeId, message: t("noCheckBy") });
        return;
      }
      void clearExpectationCheckBy(expectationId).then(() => reload(), fail(nodeId));
    },
    [findNode, reload, showToast, fail, t],
  );

  const toggleRelease = useCallback(
    (nodeId: string) => {
      const node = findNode(nodeId);
      if (node === undefined) return;
      if (node.delegationWait !== undefined) {
        showToast({ nodeId, message: t("delegationWaitReleasedByTask") });
        return;
      }
      if (node.kind !== "expectation") return;
      const next = node.status === EXPECTATION_STATUS.RELEASED ? EXPECTATION_STATUS.PENDING : EXPECTATION_STATUS.RELEASED;
      void updateExpectation(rowIdOf(node), { status: next }).then(() => reload(), fail(nodeId));
    },
    [findNode, reload, showToast, fail, t],
  );

  return { completeCheck, toggleRelease };
}
