import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { RowId } from "@/api/node-id";
import { updateExpectation } from "@/api/expectations";
import type { ReviewVerdict } from "@/api/expectations";
import { EXPECTATION_STATUS } from "@/api/expectation-status";
import { getErrorMessage } from "@/api/errors";

interface Options {
  reload: () => Promise<void>;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

/** What the user answers an agent's open wait with: a question's answer, or a review's verdict and
 * their note. */
export interface WaitReply {
  /** The answer to a question; the note on a review (optional there). */
  answer?: string;
  /** The verdict on a review. */
  verdict?: ReviewVerdict;
}

/** Answers an agent's question or review: what its answer controls' Send does. */
export type AnswerQuestion = (waitNodeId: string, waitRowId: RowId, reply: WaitReply) => Promise<boolean>;

/**
 * **Send** on an agent's open wait, from a card or the Task editor: stores the answer — or, on a
 * review, the verdict and the note — on the wait and releases it in one write, so the Task reads On
 * Agent again whichever the verdict, and the agent reads the reply off `arlesh_waits.get` or the
 * snapshot. Resolves whether it landed; a refusal is said in a toast and leaves the controls as they
 * were.
 */
export function useAnswerQuestion({ reload, showToast }: Options): AnswerQuestion {
  const { t } = useTranslation("expectation");
  return useCallback(async (waitNodeId, waitRowId, reply) => {
    try {
      await updateExpectation(waitRowId, {
        status: EXPECTATION_STATUS.RELEASED,
        ...(reply.answer !== undefined ? { answer: reply.answer.trim() } : {}),
        ...(reply.verdict !== undefined ? { verdict: reply.verdict } : {}),
      });
    } catch (error: unknown) {
      showToast({ nodeId: waitNodeId, message: t("actionFailed", { message: getErrorMessage(error) }) });
      return false;
    }
    await reload();
    return true;
  }, [reload, showToast, t]);
}
