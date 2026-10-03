import { useEffect, useRef, useState } from "react";
import { isOccurrence } from "@/utils/node-identity";
import { useTranslation } from "react-i18next";
import TagPicker from "@/components/TagPicker/TagPicker";
import type { MindmapNode } from "@/utils/tree-layout";
import type { Domain } from "@/api/domains";
import type { TimeScope, DurationSpec } from "@/api/time-scope";
import type { Verdict } from "@/api/verdict";
import { VERDICT, VERDICT_VALUES } from "@/api/verdict";
import { getErrorMessage } from "@/api/errors";
import { withAtomicGesture } from "@/api/gesture";
import EditorModal from "@/components/EditorModal/EditorModal";
import EditorAdvanced from "@/components/EditorModal/EditorAdvanced";
import TimeScopeField from "@/components/ScopePicker/TimeScopeField";
import VerdictWindowField from "./VerdictWindowField";
import { useInputCapture } from "@/hooks/use-input-capture";
import styles from "@/components/EditorModal/EditorModal.module.css";
import { formatCooldownUntil } from "@/utils/cooldown-until";

export interface CommitmentSaveData {
  title: string;
  verdict: Verdict;
  tagIds: number[];
  timeScope: TimeScope | null;
  verdictWindow: DurationSpec | null;
  isPrivate: boolean;
}

interface Props {
  node: MindmapNode;
  allTags: Domain[];
  domainNames: Map<number, string>;
  /** Overrides the "Edit commitment" title — the create path opens the same fields on a blank node. */
  heading?: string;
  onSave: (data: CommitmentSaveData) => Promise<void>;
  onClose: () => void;
}

/**
 * The Commitment editor.
 *
 * Shorter than the Task one, and the omissions are the design: there is no Plan field (the window
 * *is* the commitment), no On-exit field (a Commitment always Keeps — the Verdict Window is what
 * eventually ends that), no delegate, no dependencies and no block reasons. What it has instead
 * is a **Verdict** — three equal choices rather than a cycle, so Broken is never one stray press
 * away from Kept — and a **Verdict Window**.
 */
export default function CommitmentEditorModal({ node, allTags, domainNames, heading, onSave, onClose }: Props) {
  useInputCapture();
  const { t } = useTranslation(["editor", "status", "undo"]);
  const [title, setTitle] = useState(node.rowTitle ?? node.title);
  const [verdict, setVerdict] = useState<Verdict>(node.verdict ?? VERDICT.UNRESOLVED);
  const [tagIds, setTagIds] = useState<number[]>(node.tagIds);
  const [timeScope, setTimeScope] = useState<TimeScope | null>(node.timeScope ?? null);
  const [verdictWindow, setVerdictWindow] = useState<DurationSpec | null>(node.verdictWindow ?? null);
  const [isPrivate, setIsPrivate] = useState(node.isPrivate ?? false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); titleRef.current?.select(); }, []);

  function windowKindLabel(kind: string): string {
    switch (kind) {
      case "week": return t("editor:kindWeek");
      case "month": return t("editor:kindMonth");
      case "season": return t("editor:kindSeason");
      default: return t("editor:kindDay");
    }
  }

  async function handleSave() {
    if (title.trim() === "") return;
    setIsSaving(true);
    setSaveError(null);
    try {
      // One Gesture, all or nothing: the update and the tags are several commands
      // but one thing the user filled in, so they are one Ctrl+Z — and a refusal partway takes
      // back the ones that landed rather than leaving a form half-applied.
      await withAtomicGesture(t("undo:gestures.editCommitment"), async () => {
        await onSave({ title: title.trim(), verdict, tagIds, timeScope, verdictWindow, isPrivate });
      });
    } catch (err) {
      // A commitment that can never come due is not written — whether that is a new one saved
      // with no window in reach, or an edit clearing the last window above an existing one. The
      // message says so, in the editor holding the fields that would answer it, rather than the
      // save silently doing nothing.
      setSaveError(getErrorMessage(err));
      setIsSaving(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && event.target === titleRef.current) {
      event.preventDefault();
      void handleSave();
    }
    if (event.key === "Escape") onClose();
  }

  return (
    <EditorModal
      heading={heading ?? t("editCommitment")}
      onClose={onClose}
      onKeyDown={handleKeyDown}
      isSaving={isSaving}
      onSave={() => void handleSave()}
      saveError={saveError}
    >
      <label className={styles.label}>
        {t("fieldTitle")}
        <input ref={titleRef} className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} type="text" />
      </label>
      <div className={styles.label}>
        {t("fieldVerdict")}
        <div className={styles.statusPills}>
          {VERDICT_VALUES.map((option) => (
            <button
              key={option}
              type="button"
              className={`${styles.statusPill}${verdict === option ? ` ${styles.statusPillActive}` : ""}`}
              onClick={() => setVerdict(option)}
            >
              {t(`status:commitment.${option}`)}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.label}>
        {t("fieldTimeScope")}
        <TimeScopeField
          value={timeScope}
          onChange={setTimeScope}
          {...(isOccurrence(node) ? { lockedReason: t("editor:scopeLockedOccurrence") } : {})}
        />
      </div>
      <div className={styles.label}>
        {t("fieldVerdictWindow")}
        {/* An occurrence's Verdict Window is its template's, for every occurrence: shown, not
            edited (ruled by the user, 2026-10-03). */}
        {isOccurrence(node) ? (
          <span title={t("editor:verdictWindowLockedOccurrence")}>
            {verdictWindow === null
              ? t("editor:verdictWindowNone")
              : t("editor:verdictWindowSummary", { n: verdictWindow.n, kind: windowKindLabel(verdictWindow.kind) })}
          </span>
        ) : (
          <VerdictWindowField value={verdictWindow} onChange={setVerdictWindow} />
        )}
      </div>
      {/* A Commitment takes no block reasons of its own; the one it can carry is its Habit's
          cooldown, derived and read-only. A verdict may still be recorded while it is blocked. */}
      {node.coolingUntil !== undefined && (
        <div className={styles.virtualBlockers}>
          <span className={styles.virtualBlockersLabel}>{t("editor:cooldownBlockLabel")}</span>
          <div className={styles.virtualBlockerRow}>{t("editor:cooldownBlocked", { when: formatCooldownUntil(node.coolingUntil) })}</div>
        </div>
      )}
      <TagPicker allTags={allTags} domainNames={domainNames} selectedIds={tagIds} onChange={setTagIds} />
      <EditorAdvanced isPrivate={isPrivate} onPrivateChange={setIsPrivate} />
    </EditorModal>
  );
}
