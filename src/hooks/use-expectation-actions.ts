import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import { rowIdOf } from "@/utils/node-identity";
import { isDelegationWait } from "@/utils/derived-wait";
import { updateExpectation } from "@/api/expectations";
import { EXPECTATION_STATUS } from "@/api/expectation-status";
import { usePendingWrite } from "@/hooks/use-pending-write";
import { useReadOnlyNotice } from "@/hooks/use-read-only-notice";
import { expectationAnswerFields, writtenWith } from "@/utils/answer-fields";

interface Options {
  findNode: (id: string) => MindmapNode | undefined;
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
 * A release is shown at once and sent through the window's lane (ADR 0012). Pending ↔ Released is
 * no rule, so nothing needs pinning.
 *
 * The one refusal is said out loud: a delegated Task's wait is released by the Task being done and
 * by nothing else.
 */
export function useExpectationActions({ findNode, showToast }: Options): Result {
  const { t } = useTranslation("expectation");
  const enqueue = usePendingWrite({ showToast });
  const readOnlyNotice = useReadOnlyNotice();

  const toggleRelease = useCallback(
    (nodeId: string) => {
      const node = findNode(nodeId);
      if (node === undefined) return;
      if (isDelegationWait(node)) {
        showToast({ nodeId, message: t("delegationWaitReleasedByTask") });
        return;
      }
      const status = node.status === EXPECTATION_STATUS.RELEASED ? EXPECTATION_STATUS.PENDING : EXPECTATION_STATUS.RELEASED;
      const id = rowIdOf(node);
      enqueue({
        nodeId,
        label: "release",
        patch: { kind: "fields", fields: { status } },
        refuseReadOnly: () => {
          showToast({ nodeId, message: t("actionFailed", { message: readOnlyNotice() }) });
        },
        send: async () => writtenWith(expectationAnswerFields(await updateExpectation(id, { status }))),
      });
    },
    [findNode, enqueue, showToast, t, readOnlyNotice],
  );

  return { toggleRelease };
}
