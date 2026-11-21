import { useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import { REVIEW_VERDICT } from "@/api/expectations";
import type { ReviewLink, ReviewVerdict } from "@/api/expectations";
import type { WaitReply } from "@/hooks/use-answer-question";
import { useInputCapture } from "@/hooks/use-input-capture";
import { chordFor, REVIEW_OWNED_CODES, verdictForKey } from "@/utils/hotkeys/review-keys";
import { ANSWER_FIELD, ANSWER_STAGED, handleFieldKey, keepFocusAtEnd, UNSTAGE_CHORD } from "@/utils/answer-focus";
import { formatChord, matchesChord } from "@/utils/hotkeys/chord";
import { releaseFocus } from "@/hooks/use-answer-drafts";
import type { AnswerActions } from "@/hooks/use-answer-drafts";
import styles from "./AnswerField.module.css";

interface Props {
  /** The agent's open review: an agentic wait carrying `review`. */
  review: MindmapNode;
  /** Whether the review is staged: a verdict chosen and written down, not yet sent. */
  staged: boolean;
  /** Stage, unstage and send. */
  actions: AnswerActions;
  /** On a card: the summary goes to the title's hover and the lists are left to the editor. */
  compact?: boolean;
}

/** Whether `url` is one the review may link to: a web address, never a script or a file. */
function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function isChord(event: KeyboardEvent): boolean {
  return event.key === "Enter" && event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
}

/** The two verdicts, in the order the switch draws them. */
const VERDICTS: readonly ReviewVerdict[] = [REVIEW_VERDICT.APPROVED, REVIEW_VERDICT.CHANGES_REQUESTED];

function hasPullRequest(links: readonly ReviewLink[]): boolean {
  return links.some((link) => /\/pull\/\d+/.test(link.url));
}

/**
 * An agent's open review, and the controls to answer it in: its title and summary, its links, its
 * hand tests (a plain list — nothing is ticked or stored per item), a note of the user's own, and
 * the two verdicts (ADR 0021; `Alt+Y` and `Alt+N` select them from anywhere in the review), drawn as one segmented switch on a line with Stage and Send. The switch only **selects**: **Approve** is the user's word to
 * merge the PR when there is a PR link, and plain acceptance otherwise; **Request changes** sends the
 * note back. Then the same two buttons as a question: **Stage** writes the verdict and the note
 * down, locking them; **Send** sends every staged answer, staging this one first when it is not
 * staged yet. `Ctrl+Enter` in the note stages the selected verdict; in a staged note it sends. With
 * no verdict selected Stage and Send are disabled and the chord does nothing.
 */
export default function ReviewAnswer({ review, staged, actions, compact = false }: Props) {
  const { t } = useTranslation("expectation");
  const fieldId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [chosen, setChosen] = useState<ReviewVerdict | null>(null);
  const [typed, setTyped] = useState("");
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  useInputCapture(focused);
  const draft = review.agentWaiting?.draft;
  const details = review.agentWaiting?.review;
  const summary = review.agentWaiting?.note ?? null;
  const links = details?.links ?? [];
  const handTests = details?.hand_tests ?? [];
  const verdict = staged ? (draft?.verdict ?? null) : chosen;
  const note = staged ? (draft?.answer ?? "") : typed;
  const canStage = !busy && verdict !== null;
  const canSend = !busy && verdict !== null;

  function replyOf(selected: ReviewVerdict): WaitReply {
    const trimmed = typed.trim();
    return { verdict: selected, ...(trimmed !== "" ? { answer: trimmed } : {}) };
  }

  async function run(action: () => Promise<boolean>): Promise<boolean> {
    setBusy(true);
    try {
      return await action();
    } finally {
      setBusy(false);
    }
  }

  async function toggleStage(keepFocus = false): Promise<void> {
    if (!canStage || verdict === null) return;
    if (staged) {
      // Unstaging keeps the verdict and the note, to change and stage again.
      const kept = { verdict, note };
      if (await run(() => actions.unstage(review))) {
        setChosen(kept.verdict);
        setTyped(kept.note);
        if (keepFocus) keepFocusAtEnd(field.current);
      }
      return;
    }
    await run(() => actions.stage(review, replyOf(verdict)));
  }

  async function send(): Promise<void> {
    if (!canSend || verdict === null) return;
    if (field.current === document.activeElement) releaseFocus();
    const landed = await run(() => (staged ? actions.send(review) : actions.send(review, replyOf(verdict))));
    if (landed) {
      setChosen(null);
      setTyped("");
    }
  }

  const keyShortcut = (option: ReviewVerdict): string | undefined => {
    const chord = chordFor(option);
    return chord === null ? undefined : formatChord(chord);
  };
  const keyTitle = (option: ReviewVerdict): string | undefined => keyShortcut(option);

  /** The answer field keys (Alt+Down, Alt+Up, Escape) and Alt+Y and Alt+N: select a verdict from anywhere in the review. They only select, and a staged
   * review is locked. Handled here, before anything behind it sees the chord, and nothing is typed. */
  function selectByKey(event: KeyboardEvent<HTMLDivElement>): void {
    if (handleFieldKey(event, field.current)) return;
    const selected = verdictForKey(event.nativeEvent);
    if (selected === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (staged || busy) return;
    setChosen(selected);
  }

  /** Arrow keys move the choice along the switch, as a radio group's do. */
  function moveVerdict(event: KeyboardEvent<HTMLDivElement>): void {
    if (staged || busy) return;
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const from = verdict === null ? (step === 1 ? -1 : 0) : VERDICTS.indexOf(verdict);
    const next = VERDICTS[(from + step + VERDICTS.length) % VERDICTS.length];
    if (next !== undefined) setChosen(next);
  }

  return (
    <div
      className={`${styles.answer}${compact ? ` ${styles.compact}` : ""}`}
      data-owns-keys={REVIEW_OWNED_CODES}
      onKeyDown={selectByKey}
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
        ref={field}
        id={fieldId}
        {...{ [ANSWER_FIELD]: "", [ANSWER_STAGED]: String(staged) }}
        className={`${styles.field}${staged ? ` ${styles.staged}` : ""}`}
        dir="auto"
        rows={compact ? 1 : 2}
        value={note}
        readOnly={staged}
        title={staged ? t("answerStagedTitle") : undefined}
        placeholder={t("reviewNoteHint")}
        onChange={(event) => setTyped(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
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
      <div className={styles.controls}>
        <div className={styles.switch} role="radiogroup" aria-label={t("reviewVerdict")} onKeyDown={moveVerdict}>
          {VERDICTS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              className={styles.option}
              aria-checked={verdict === option}
              tabIndex={verdict === option || (verdict === null && option === VERDICTS[0]) ? 0 : -1}
              disabled={busy || staged}
              title={keyTitle(option)}
              aria-keyshortcuts={keyShortcut(option)}
              onClick={() => setChosen(option)}
            >
              {option === REVIEW_VERDICT.APPROVED ? (hasPullRequest(links) ? t("reviewApproveMerge") : t("reviewApprove")) : t("reviewRequestChanges")}
            </button>
          ))}
        </div>
        <button type="button" className={styles.secondary} aria-pressed={staged} aria-keyshortcuts={staged ? formatChord(UNSTAGE_CHORD) : undefined} title={staged ? formatChord(UNSTAGE_CHORD) : undefined} disabled={!canStage} onClick={() => void toggleStage()}>
          {t("answerStage")}
        </button>
        <button type="button" className={styles.send} disabled={!canSend} onClick={() => void send()}>
          {t("answerSend")}
        </button>
      </div>
      {staged && <span className={styles.mark} title={t("answerStagedTitle")}>{t("answerStaged")}</span>}
    </div>
  );
}
