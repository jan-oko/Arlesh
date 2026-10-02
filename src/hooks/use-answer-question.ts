import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { RowId } from "@/api/node-id";
import { updateExpectation } from "@/api/expectations";
import { EXPECTATION_STATUS } from "@/api/expectation-status";
import { getErrorMessage } from "@/api/errors";

interface Options {
  reload: () => Promise<void>;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

/** Answers an agent's question: what the answer field's Send does. */
export type AnswerQuestion = (waitNodeId: string, waitRowId: RowId, answer: string) => Promise<boolean>;

/**
 * **Send** on an agent's question, from the Review card or the Task editor: stores the answer on the
 * wait and releases it in one write — the same write the wait's own editor makes — so the Task reads
 * On Agent again and the agent reads the answer off `arlesh_waits.get` or the snapshot. Resolves
 * whether it landed; a refusal is said in a toast and leaves the field as it was.
 */
export function useAnswerQuestion({ reload, showToast }: Options): AnswerQuestion {
  const { t } = useTranslation("expectation");
  return useCallback(async (waitNodeId, waitRowId, answer) => {
    try {
      await updateExpectation(waitRowId, { status: EXPECTATION_STATUS.RELEASED, answer: answer.trim() });
    } catch (error: unknown) {
      showToast({ nodeId: waitNodeId, message: t("actionFailed", { message: getErrorMessage(error) }) });
      return false;
    }
    await reload();
    return true;
  }, [reload, showToast, t]);
}
