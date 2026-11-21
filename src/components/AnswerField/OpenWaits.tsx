import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import { isReviewWait, isTaskStaged, isWaitStaged, openWaits } from "@/utils/open-question";
import type { AnswerActions } from "@/hooks/use-answer-drafts";
import AnswerField from "./AnswerField";
import ReviewAnswer from "./ReviewAnswer";
import styles from "./AnswerField.module.css";

interface Props {
  /** The Task reading Review. */
  task: MindmapNode;
  /** Stage, unstage and send, for each of its open waits. */
  actions: AnswerActions;
  /** On a card: the compact form of each. */
  compact?: boolean;
}

/**
 * What an agent has open for the user on a Task: its question and review waits, each with the
 * controls to answer it — one when there is one, a short list when there are several. Agentic waits
 * are never nodes of their own, so this is where they are seen and answered, on a card, a row or in
 * the Task's editor alike. Each wait is marked Staged on its own; the Task is marked only when every
 * one of its open waits is (ADR 0021). Nothing when none is open.
 */
export default function OpenWaits({ task, actions, compact = false }: Props) {
  const { t } = useTranslation("expectation");
  const waits = openWaits(task);
  if (waits.length === 0) return null;
  return (
    <div className={styles.waits}>
      {isTaskStaged(task) && <span className={styles.mark} title={t("taskStagedTitle")}>{t("taskStaged")}</span>}
      {waits.map((wait) => isReviewWait(wait)
        ? <ReviewAnswer key={wait.id} review={wait} staged={isWaitStaged(task, wait)} actions={actions} compact={compact} />
        : <AnswerField key={wait.id} question={wait} staged={isWaitStaged(task, wait)} actions={actions} compact={compact} />)}
    </div>
  );
}
