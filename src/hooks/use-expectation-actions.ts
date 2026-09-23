import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode, WaitRef } from "@/utils/tree-layout";
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
   * Completes the current check on a wait — the selected wait's, or the one a selected virtual
   * check task belongs to. It records when; the check stays as a done task, the next falls due one
   * interval later, and the wait stays pending. On a **done** check task it reopens that check —
   * the latest only; the backend refuses any other, out loud.
   */
  completeCheck: (nodeId: string) => void;
  /** Releases a pending wait, or takes a release back. */
  toggleRelease: (nodeId: string) => void;
}

/** The wait a node stands for: itself, or the one its check task checks on. */
function waitOf(node: MindmapNode): WaitRef | null {
  if (node.expectationCheck !== undefined) return node.expectationCheck;
  if (node.spawnedBy !== undefined) return { kind: "spawned", taskId: node.spawnedBy.taskId };
  if (node.kind === "expectation" && node.rowId !== undefined) return { kind: "stored", expectationId: node.rowId };
  return null;
}

/**
 * The two Expectation gestures, shared by every view — for a stored wait and for the one an
 * Asynchronous Task's completion spawned alike.
 *
 * Every refusal is said out loud: a delegated Task's wait is released by the Task being done and by
 * nothing else, a wait with no Check every has no check to complete, and a node that is not a wait
 * is not one.
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
      const wait = waitOf(node);
      if (wait === null) {
        showToast({ nodeId, message: t("notAWait") });
        return;
      }
      if (node.kind === "expectation" && (node.checkEvery ?? null) === null) {
        showToast({ nodeId, message: t("noCheckEvery") });
        return;
      }
      // A completed check task toggles back: `D`, `Enter` and its status control reopen it.
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
      if (node.kind !== "expectation") {
        showToast({ nodeId, message: t("notAWait") });
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
