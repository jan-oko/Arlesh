import { useId, useState } from "react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import { REVIEW_VERDICT } from "@/api/expectations";
import type { ReviewLink } from "@/api/expectations";
import type { WaitReply } from "@/hooks/use-answer-question";
import { useInputCapture } from "@/hooks/use-input-capture";
import styles from "./AnswerField.module.css";

interface Props {
  /** The agent's open review: an agentic wait carrying `review`. */
  review: MindmapNode;
  /** Stores the verdict and the note and releases the wait; resolves whether it landed. */
  onSend: (reply: WaitReply) => Promise<boolean>;
  /** On a card: the summary goes to the title's hover and the lists are left to the editor. */
  compact?: boolean;
}

/** Whether `url` is one the review may link to: a web address, never a script or a file. */
function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function isSendChord(event: KeyboardEvent): boolean {
  return event.key === "Enter" && event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
}

function hasPullRequest(links: readonly ReviewLink[]): boolean {
  return links.some((link) => /\/pull\/\d+/.test(link.url));
}

/**
 * An agent's open review, and the controls to answer it in: its title and summary, its links, its
 * hand tests (a plain list — nothing is ticked or stored per item), a note of the user's own, and
 * the two verdicts. **Approve** is the user's word to merge the PR when there is a PR link, and
 * plain acceptance otherwise; **Request changes** sends the note back. Either releases the review,
 * so the Task reads On Agent again.
 */
export default function ReviewAnswer({ review, onSend, compact = false }: Props) {
  const { t } = useTranslation("expectation");
  const fieldId = useId();
  const [note, setNote] = useState("");
  const [focused, setFocused] = useState(false);
  const [sending, setSending] = useState(false);
  useInputCapture(focused);
  const details = review.agentWaiting?.review;
  const summary = review.agentWaiting?.note ?? null;
  const links = details?.links ?? [];
  const handTests = details?.hand_tests ?? [];

  async function send(verdict: (typeof REVIEW_VERDICT)[keyof typeof REVIEW_VERDICT]): Promise<void> {
    if (sending) return;
    setSending(true);
    const trimmed = note.trim();
    const landed = await onSend({ verdict, ...(trimmed !== "" ? { answer: trimmed } : {}) });
    setSending(false);
    if (landed) setNote("");
  }

  return (
    <div
      className={`${styles.answer}${compact ? ` ${styles.compact}` : ""}`}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <span className={styles.question} dir="auto" title={compact && summary !== null ? summary : undefined}>
        {review.title}
      </span>
      {!compact && summary !== null && <span className={styles.note} dir="auto">{summary}</span>}
      {links.length > 0 && (
        <div className={styles.group}>
          <span className={styles.label}>{t("reviewLinks")}</span>
          <ul className={styles.list}>
            {links.map((link) => (
              <li key={`${link.label}\n${link.url}`}>
                {isWebUrl(link.url)
                  ? <a className={styles.link} href={link.url} target="_blank" rel="noopener noreferrer" dir="auto">{link.label}</a>
                  : <span dir="auto">{link.label}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {handTests.length > 0 && (
        <div className={styles.group}>
          <span className={styles.label}>{t("reviewHandTests")}</span>
          <ul className={styles.list}>
            {handTests.map((test, index) => <li key={`${index}:${test}`} dir="auto">{test}</li>)}
          </ul>
        </div>
      )}
      <label className={styles.label} htmlFor={fieldId}>{t("reviewNoteLabel")}</label>
      <textarea
        id={fieldId}
        className={styles.field}
        dir="auto"
        rows={compact ? 1 : 2}
        value={note}
        placeholder={t("reviewNoteHint")}
        onChange={(event) => setNote(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (!isSendChord(event)) return;
          event.preventDefault();
          event.stopPropagation();
          void send(REVIEW_VERDICT.CHANGES_REQUESTED);
        }}
      />
      <div className={styles.row}>
        <button type="button" className={styles.send} disabled={sending} onClick={() => void send(REVIEW_VERDICT.APPROVED)}>
          {hasPullRequest(links) ? t("reviewApproveMerge") : t("reviewApprove")}
        </button>
        <button type="button" className={styles.secondary} disabled={sending} onClick={() => void send(REVIEW_VERDICT.CHANGES_REQUESTED)}>
          {t("reviewRequestChanges")}
        </button>
      </div>
    </div>
  );
}
