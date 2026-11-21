import { useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import { isSendableAnswer } from "@/utils/open-question";
import { useInputCapture } from "@/hooks/use-input-capture";
import { ANSWER_FIELD, ANSWER_STAGED, handleFieldKey, keepFocusAtEnd, UNSTAGE_CHORD } from "@/utils/answer-focus";
import { formatChord, matchesChord } from "@/utils/hotkeys/chord";
import { releaseFocus } from "@/hooks/use-answer-drafts";
import type { AnswerActions } from "@/hooks/use-answer-drafts";
import { useAgentActivityStore } from "@/stores/use-agent-activity-store";
import styles from "./AnswerField.module.css";

interface Props {
  /** The agent's open question: an agentic question wait under the Task. */
  question: MindmapNode;
  /** Whether the question is staged: an answer written and not yet sent. */
  staged: boolean;
  /** Stage, unstage and send. */
  actions: AnswerActions;
  /** On a card: the note goes to the question's hover rather than its own line. */
  compact?: boolean;
}

/** Whether a key press is the field's own chord, `Ctrl+Enter`. */
function isChord(event: KeyboardEvent): boolean {
  return event.key === "Enter" && event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
}

/**
 * An agent's open question, and the field to answer it in: on the **Review** card, the List row and
 * in the Task editor's agentic section. Two buttons (ADR 0021). **Stage** toggles: it writes the
 * answer down without sending it, and the field is then locked and marked Staged; pressing it again
 * unstages, keeping the text to edit. **Send** sends every staged answer on the board, this one
 * included: on text that is not staged yet it stages it first. `Alt+Down` / `Alt+Up` move to the next / previous answer field and `Escape` leaves the
 * field, back to the view, without touching the answer. `Ctrl+Enter` stages; in a staged field
 * it sends, and `Ctrl+Shift+Enter` unstages it, keeping the text and the focus. While the field has focus the view's keys stand aside, as for any inline editor; the
 * chord is the field's own and is stopped there.
 */
export default function AnswerField({ question, staged, actions, compact = false }: Props) {
  const { t } = useTranslation("expectation");
  const fieldId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [typed, setTyped] = useState("");
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  useInputCapture(focused);
  const stagedCount = useAgentActivityStore((s) => s.stagedWaitIds.length);
  const note = question.agentWaiting?.note ?? null;
  const shown = staged ? (question.agentWaiting?.draft?.answer ?? "") : typed;
  const hasText = isSendableAnswer(shown);
  const othersStaged = stagedCount - (staged ? 1 : 0) > 0;
  const canStage = !busy && (staged || hasText);
  const canSend = !busy && (staged || hasText || othersStaged);

  async function run(action: () => Promise<boolean>): Promise<boolean> {
    setBusy(true);
    try {
      return await action();
    } finally {
      setBusy(false);
    }
  }

  async function toggleStage(keepFocus = false): Promise<void> {
    if (!canStage) return;
    if (staged) {
      // Unstaging keeps the text, to be edited and staged again.
      const kept = question.agentWaiting?.draft?.answer ?? "";
      if (await run(() => actions.unstage(question))) {
        setTyped(kept);
        if (keepFocus) keepFocusAtEnd(field.current);
      }
      return;
    }
    await run(() => actions.stage(question, { answer: typed }));
  }

  async function send(): Promise<void> {
    if (!canSend) return;
    if (field.current === document.activeElement) releaseFocus();
    const landed = await run(() => (staged || !hasText ? actions.send(question) : actions.send(question, { answer: typed })));
    if (landed) setTyped("");
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
          ref={field}
          id={fieldId}
          {...{ [ANSWER_FIELD]: "", [ANSWER_STAGED]: String(staged) }}
          className={`${styles.field}${staged ? ` ${styles.staged}` : ""}`}
          dir="auto"
          rows={compact ? 1 : 2}
          value={shown}
          readOnly={staged}
          title={staged ? t("answerStagedTitle") : undefined}
          placeholder={t("answerHint")}
          onChange={(event) => setTyped(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (handleFieldKey(event, field.current)) return;
            if (matchesChord(event.nativeEvent, UNSTAGE_CHORD)) {
              // Ctrl+Shift+Enter unstages a staged answer, and does nothing in one that is not.
              event.preventDefault();
              event.stopPropagation();
              if (staged) void toggleStage(true);
              return;
            }
            if (!isChord(event)) return;
            event.preventDefault();
            event.stopPropagation();
            if (staged) void send();
            else void toggleStage();
          }}
        />
        <div className={styles.buttons}>
          <button
            type="button"
            className={styles.secondary}
            aria-pressed={staged}
            aria-keyshortcuts={staged ? formatChord(UNSTAGE_CHORD) : undefined}
            title={staged ? formatChord(UNSTAGE_CHORD) : undefined}
            disabled={!canStage}
            onClick={() => void toggleStage()}
          >
            {t("answerStage")}
          </button>
          <button type="button" className={styles.send} disabled={!canSend} onClick={() => void send()}>
            {t("answerSend")}
          </button>
        </div>
      </div>
    </div>
  );
}
