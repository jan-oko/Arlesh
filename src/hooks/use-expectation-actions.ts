import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import { rowIdOf } from "@/utils/node-identity";
import {
  completeExpectationCheck, completeSpawnedWaitCheck, reopenExpectationCheck, reopenSpawnedWaitCheck,
  updateExpectation, updateSpawnedWait,
} from "@/api/expectations";
import { EXPECTATION_STATUS } from "@/api/expectation-status";
import { getErrorMessage } from "@/api/errors";

interface Options {
  findNode: (id: string) => MindmapNode | undefined;
  reload: () => Promise<void>;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

interface Result {
  /**
   * Completes the check a virtual check task stands for. It records when; the check stays as a done task, the next falls due one
   * interval later, and the wait stays pending. On a **done** check task it reopens that check —
   * the latest only; the backend refuses any other, out loud.
   */
  completeCheck: (nodeId: string) => void;
  /** Releases a pending wait, or takes a release back. */
  toggleRelease: (nodeId: string) => void;
}

/**
 * The two Expectation gestures, shared by every view — for a stored wait and for the one an
 * Asynchronous Task's completion spawned alike.
 *
 * Every caller hands in a wait for `toggleRelease` and a check task for `completeCheck`. The one
 * refusal is said out loud: a delegated Task's wait is released by the Task being done and by
 * nothing else.
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
      // Only a check task's status gesture routes here (see `useStatusCycle` and the List View's
      // `onCycleStatus`), so a node without a wait to check never arrives.
      const wait = node?.expectationCheck;
      if (node === undefined || wait === undefined) return;
      // A completed check task toggles back: `Enter` (`Space` in Steps) and its status control reopen it.
      const reopening = node.checkDueAt;
      const write = reopening !== undefined
        ? (wait.kind === "stored"
          ? reopenExpectationCheck(wait.expectationId, reopening).then(() => undefined)
          : reopenSpawnedWaitCheck(wait.taskId, reopening))
        : wait.kind === "stored"
          ? completeExpectationCheck(wait.expectationId).then(() => undefined)
          : completeSpawnedWaitCheck(wait.taskId);
      void write.then(() => reload(), fail(nodeId));
    },
    [findNode, reload, fail],
  );

  const toggleRelease = useCallback(
    (nodeId: string) => {
      const node = findNode(nodeId);
      if (node === undefined) return;
      if (node.delegationWait !== undefined) {
        showToast({ nodeId, message: t("delegationWaitReleasedByTask") });
        return;
      }
      const status = node.status === EXPECTATION_STATUS.RELEASED ? EXPECTATION_STATUS.PENDING : EXPECTATION_STATUS.RELEASED;
      const write = node.spawnedBy !== undefined
        ? updateSpawnedWait(node.spawnedBy.taskId, { status })
        : updateExpectation(rowIdOf(node), { status }).then(() => undefined);
      void write.then(() => reload(), fail(nodeId));
    },
    [findNode, reload, showToast, fail, t],
  );

  return { completeCheck, toggleRelease };
}
