import { useId, useState } from "react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import { isSendableAnswer } from "@/utils/open-question";
import { useInputCapture } from "@/hooks/use-input-capture";
import styles from "./AnswerField.module.css";

interface Props {
  /** The agent's open question: an agentic question wait under the Task. */
  question: MindmapNode;
  /** Stores the answer and releases the wait; resolves whether it landed. */
  onSend: (answer: string) => Promise<boolean>;
  /** On a card: the note goes to the question's hover rather than its own line. */
  compact?: boolean;
}

/** Whether a key press is the field's own send chord, `Ctrl+Enter`. */
function isSendChord(event: KeyboardEvent): boolean {
  return event.key === "Enter" && event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
}

/**
 * An agent's open question, and the field to answer it in: on the **Review** card and in the Task
 * editor's agentic section. **Send** — the button, or `Ctrl+Enter` in the field — stores the answer
 * on the wait and releases it, so the Task reads On Agent again. While the field has focus the view's
 * keys stand aside, as they do for any inline editor; the chord is the field's own, and is stopped
 * there, so nothing behind it sees it.
 */
export default function AnswerField({ question, onSend, compact = false }: Props) {
  const { t } = useTranslation("expectation");
  const fieldId = useId();
  const [answer, setAnswer] = useState("");
  const [focused, setFocused] = useState(false);
  const [sending, setSending] = useState(false);
  useInputCapture(focused);
  const note = question.agentWaiting?.note ?? null;
  const sendable = isSendableAnswer(answer) && !sending;

  async function send(): Promise<void> {
    if (!sendable) return;
    setSending(true);
    const landed = await onSend(answer);
    setSending(false);
    if (landed) setAnswer("");
  }

  return (
    <div
      className={`${styles.answer}${compact ? ` ${styles.compact}` : ""}`}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <span className={styles.question} dir="auto" title={compact && note !== null ? note : undefined}>
        {question.title}
      </span>
      {!compact && note !== null && <span className={styles.note} dir="auto">{note}</span>}
      <label className={styles.label} htmlFor={fieldId}>{t("agentAnswer")}</label>
      <div className={styles.row}>
        <textarea
          id={fieldId}
          className={styles.field}
          dir="auto"
          rows={compact ? 1 : 2}
          value={answer}
          placeholder={t("answerHint")}
          onChange={(event) => setAnswer(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (!isSendChord(event)) return;
            event.preventDefault();
            event.stopPropagation();
            void send();
          }}
        />
        <button type="button" className={styles.send} disabled={!sendable} onClick={() => void send()}>
          {t("answerSend")}
        </button>
      </div>
    </div>
  );
}
