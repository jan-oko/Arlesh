import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { updateGoal } from "@/api/goals";
import { getErrorMessage } from "@/api/errors";
import type { BacklogCleared, StatusRefusal, StatusStep } from "@/api/node-gestures";
import { stepTaskStatus } from "@/api/node-gestures";
import { GOAL_STATUS } from "@/utils/status-mapping";
import type { MindmapNode } from "@/utils/tree-layout";
import { rowIdOf } from "@/utils/node-identity";
import { acknowledged, useOccurrenceCompletion } from "@/hooks/use-occurrence-completion";
import type { OccurrencePrompt } from "@/hooks/use-occurrence-completion";
import { useExpectationActions } from "@/hooks/use-expectation-actions";

const LOG_PREFIX = "[arlesh]";

/** The `warnings` key that says why a status gesture wrote nothing. */
const REFUSAL_MESSAGE: Record<StatusRefusal, "compoundStatusRefused" | "altEnterAgenticNotDoing"> = {
  compound: "compoundStatusRefused",
  alt_enter_agentic_not_doing: "altEnterAgenticNotDoing",
};

/** The `warnings` key that names a Task coming out of the Backlog, by the status that did it. */
const BACKLOG_CLEARED_MESSAGE: Record<BacklogCleared, "backlogClearedByStart" | "backlogClearedByStarted"> = {
  by_start: "backlogClearedByStart",
  by_started: "backlogClearedByStarted",
};


interface Options {
  findNode: (id: string) => MindmapNode | undefined;
  reload: () => Promise<void>;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

interface StatusCycle {
  /** Advances the node's status by one — the same step a click on its glyph takes. */
  cycleStatus: (nodeId: string) => void;
  /** `Alt+Enter`: on an ordinary Task, sets it **Started** or resumes a Started one to In
   * Progress; on an Agentic one, hands a Doing Task back to its agent (On Agent), and anywhere
   * else says it cannot. Anything that is not a Task is left alone. */
  toggleStarted: (nodeId: string) => void;
  /** The occurrence completion the backend is holding for confirmation, or `null`. */
  occurrencePrompt: OccurrencePrompt | null;
  /** Answers that prompt: marks the occurrence done and leaves its children in place. */
  confirmOccurrence: () => void;
  /** Declines it. Nothing was written, so nothing is undone. */
  cancelOccurrence: () => void;
}

/**
 * **One definition of "advance this node's status"**, for every surface that offers the gesture.
 *
 * A Goal toggles active ↔ achieved; a Task cycles todo → in progress → done — a Habit occurrence
 * exactly as a stored row, since it is one (ADR 0008). A **Commitment** is excluded: it is kept or broken, never advanced, and its verdict
 * has its own writer.
 *
 * Two rules travel with the gesture rather than with the caller, which is the whole point of it
 * living here. Marking an occurrence done while it still holds unfinished added children goes
 * through the **completion guard**, which asks first and names them. And starting a set-aside Task
 * **takes it out of the Backlog** — read off the row the backend sent back rather than predicted,
 * and said out loud, because a flag that stops being true without a word is a flag you stop
 * trusting.
 *
 * It lives here because there are now three callers. The Mindmap's `useNodeActions` delegates to
 * it and the Steps View uses it directly, so every surface that draws a status glyph gets both of
 * those rules rather than rediscovering that it needed them.
 */
export function useStatusCycle({ findNode, reload, showToast }: Options): StatusCycle {
  const { t } = useTranslation(["warnings"]);
  const { prompt: occurrencePrompt, guard, confirm: confirmOccurrence,
    cancel: cancelOccurrence } = useOccurrenceCompletion();
  const { toggleRelease } = useExpectationActions({ findNode, reload, showToast });

  // One status gesture, sent to the backend through the completion guard: the backend decides
  // what the press writes (`tasks::rules::gestures`), and says when it refused — a Task that
  // consists of its sub-items, or `Alt+Enter` on Agentic work that is not Doing — and when the
  // write took a set-aside Task out of the Backlog. Both are said out loud here; neither is
  // predicted.
  const stepStatus = useCallback(
    (node: MindmapNode, step: StatusStep, onError: (err: unknown) => void) => {
      guard(node, async (confirmed) => {
        const outcome = await stepTaskStatus(rowIdOf(node), step, ...acknowledged(confirmed));
        if (outcome.outcome === "refused") {
          showToast({ nodeId: node.id, message: t(`warnings:${REFUSAL_MESSAGE[outcome.reason]}`) });
          return;
        }
        if (outcome.backlog_cleared !== null) {
          showToast({ nodeId: node.id, message: t(`warnings:${BACKLOG_CLEARED_MESSAGE[outcome.backlog_cleared]}`) });
        }
        await reload();
      }, onError);
    },
    [guard, reload, showToast, t],
  );

  const cycleStatus = useCallback(
    (nodeId: string) => {
      const node = findNode(nodeId);
      if (node === undefined) return;
      // A wait's glyph releases it (or takes the release back). Its check task is a Task row, and
      // cycles like one: marking it done records the check, and taking it back reopens it.
      if (node.kind === "expectation") { toggleRelease(nodeId); return; }
      // A Habit occurrence is an ordinary row (ADR 0008): its glyph advances it exactly as it
      // advances a stored one, through the completion guard that asks before an occurrence closes
      // over unfinished work.
      const failed = (message: string) => (err: unknown): void => {
        console.error(`${LOG_PREFIX} ${message}:`, err);
        showToast({ nodeId, message: t("warnings:statusChangeFailed", { message: getErrorMessage(err) }) });
      };
      // A goal toggles active ↔ achieved on click — no modal.
      if (node.kind === "goal") {
        const dbId = rowIdOf(node);
        const next = node.status === GOAL_STATUS.ACHIEVED ? GOAL_STATUS.ACTIVE : GOAL_STATUS.ACHIEVED;
        guard(node, async (confirmed) => {
          await updateGoal(dbId, { status: next }, ...acknowledged(confirmed));
          await reload();
        }, failed("goal status toggle failed"));
        return;
      }
      if (node.kind !== "task") return;
      stepStatus(node, "advance", failed("status cycle failed"));
    },
    [findNode, reload, guard, showToast, t, toggleRelease, stepStatus],
  );

  const toggleStarted = useCallback(
    (nodeId: string) => {
      const node = findNode(nodeId);
      if (node?.kind !== "task") return;
      stepStatus(node, "alt", (err: unknown) => {
        console.error(`${LOG_PREFIX} started toggle failed:`, err);
        showToast({ nodeId, message: t("warnings:statusChangeFailed", { message: getErrorMessage(err) }) });
      });
    },
    [findNode, showToast, t, stepStatus],
  );

  return { cycleStatus, toggleStarted, occurrencePrompt, confirmOccurrence, cancelOccurrence };
}
