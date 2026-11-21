import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { nextWaitingField, taskOfField } from "@/utils/answer-focus";

interface Options {
  /** Selects a Task in the view that calls. */
  select: (taskNodeId: string) => void;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

/**
 * The jump to the next answer that is waiting for you (ADR 0021): selects the Task that holds it in
 * the current view and focuses its field. The next one after the field in use, wrapping; it looks
 * among the answer fields the view draws. With none waiting it says so in a toast.
 */
export function useJumpToWaiting({ select, showToast }: Options): () => void {
  const { t } = useTranslation("expectation");
  return useCallback(() => {
    const field = nextWaitingField(document.activeElement);
    if (field === null) {
      showToast({ nodeId: "", message: t("nothingWaiting") });
      return;
    }
    const task = taskOfField(field);
    if (task !== null) select(task);
    field.focus();
  }, [select, showToast, t]);
}
