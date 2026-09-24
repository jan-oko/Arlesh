import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import { rowIdOf } from "@/utils/node-identity";
import { isDelegationWait } from "@/utils/derived-wait";
import { updateExpectation } from "@/api/expectations";
import { EXPECTATION_STATUS } from "@/api/expectation-status";
import { getErrorMessage } from "@/api/errors";

interface Options {
  findNode: (id: string) => MindmapNode | undefined;
  reload: () => Promise<void>;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

interface Result {
  /** Releases a pending wait, or takes a release back. */
  toggleRelease: (nodeId: string) => void;
}

/**
 * The Expectation gesture shared by every view — for a stored wait and for the one an Asynchronous
 * Task's completion spawned alike, since both are rows (ADR 0008). A wait's check tasks are Task
 * rows too, and are completed through the ordinary status cycle.
 *
 * The one refusal is said out loud: a delegated Task's wait is released by the Task being done and
 * by nothing else.
 */
export function useExpectationActions({ findNode, reload, showToast }: Options): Result {
  const { t } = useTranslation("expectation");

  const toggleRelease = useCallback(
    (nodeId: string) => {
      const node = findNode(nodeId);
      if (node === undefined) return;
      if (isDelegationWait(node)) {
        showToast({ nodeId, message: t("delegationWaitReleasedByTask") });
        return;
      }
      const status = node.status === EXPECTATION_STATUS.RELEASED ? EXPECTATION_STATUS.PENDING : EXPECTATION_STATUS.RELEASED;
      void updateExpectation(rowIdOf(node), { status }).then(
        () => reload(),
        (error: unknown) => {
          showToast({ nodeId, message: t("actionFailed", { message: getErrorMessage(error) }) });
        },
      );
    },
    [findNode, reload, showToast, t],
  );

  return { toggleRelease };
}
