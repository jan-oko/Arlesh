import type { MindmapNode } from "@/utils/tree-layout";
import { isReviewWait, openWaits } from "@/utils/open-question";
import type { WaitReply } from "@/hooks/use-answer-question";
import AnswerField from "./AnswerField";
import ReviewAnswer from "./ReviewAnswer";
import styles from "./AnswerField.module.css";

interface Props {
  /** The Task reading Review. */
  task: MindmapNode;
  /** Answers one of its open waits: stores the reply and releases the wait. */
  onAnswer: (wait: MindmapNode, reply: WaitReply) => Promise<boolean>;
  /** On a card: the compact form of each. */
  compact?: boolean;
}

/**
 * What an agent has open for the user on a Task: its question and review waits, each with the
 * controls to answer it — one when there is one, a short list when there are several. Agentic waits
 * are never nodes of their own, so this is where they are seen and answered, on a card or in the
 * Task's editor alike. Nothing when none is open.
 */
export default function OpenWaits({ task, onAnswer, compact = false }: Props) {
  const waits = openWaits(task);
  if (waits.length === 0) return null;
  return (
    <div className={styles.waits}>
      {waits.map((wait) => isReviewWait(wait)
        ? <ReviewAnswer key={wait.id} review={wait} compact={compact} onSend={(reply) => onAnswer(wait, reply)} />
        : (
          <AnswerField
            key={wait.id}
            question={wait}
            compact={compact}
            onSend={(answer) => onAnswer(wait, { answer })}
          />
        ))}
    </div>
  );
}
