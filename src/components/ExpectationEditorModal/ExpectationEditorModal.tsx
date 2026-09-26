import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import type { DurationSpec, TimeScope } from "@/api/time-scope";
import type { ExpectationStatus } from "@/api/expectation-status";
import { EXPECTATION_STATUS } from "@/api/expectation-status";
import { getErrorMessage } from "@/api/errors";
import EditorModal from "@/components/EditorModal/EditorModal";
import EditorAdvanced from "@/components/EditorModal/EditorAdvanced";
import TimeScopeField from "@/components/ScopePicker/TimeScopeField";
import CountedDurationField from "@/components/EditorModal/CountedDurationField";
import StartingDayField from "@/components/ScopePicker/StartingDayField";
import Switch from "@/components/Switch/Switch";
import TagPicker from "@/components/TagPicker/TagPicker";
import type { Domain } from "@/api/domains";
import { useInputCapture } from "@/hooks/use-input-capture";
import styles from "@/components/EditorModal/EditorModal.module.css";

export interface ExpectationSaveData {
  title: string;
  status: ExpectationStatus;
  checkEvery: DurationSpec | null;
  /** When the first check falls due, `YYYY-MM-DD`; `null` leaves it to start now. */
  checkStartingDate: string | null;
  timeScope: TimeScope | null;
  tagIds: number[];
  archived: boolean;
  isPrivate: boolean;
  /** Whether an agent raised this wait on the Agentic Task above it. Refused by the backend
   * anywhere but directly under one. */
  agentic: boolean;
  /** The agent's question, or what it is waiting on; `null` for none. */
  agenticNote: string | null;
  /** The answer to a question wait; `null` for none. Releasing a question wait needs one. */
  agenticAnswer: string | null;
}

const STATUSES: readonly ExpectationStatus[] = [EXPECTATION_STATUS.PENDING, EXPECTATION_STATUS.RELEASED];

interface Props {
  /** The Expectation being edited — or, on the create path, a blank node standing in for one. */
  node: MindmapNode;
  /** Overrides the "Edit expectation" heading: the create paths open the same fields on a blank. */
  heading?: string;
  /** A line under the heading, for the create paths that say why the editor opened. */
  lead?: string;
  onSave: (data: ExpectationSaveData) => Promise<void>;
  onClose: () => void;
  /** The tags to pick from. Omitted — as on the paths that create a wait for a Task — the tag
   * picker is not drawn, and the wait starts with none. */
  allTags?: Domain[];
  domainNames?: Map<number, string>;
}

/**
 * The Expectation editor: a title, the status (Pending / Released), its Time Scope, how often to
 * check on it (**Check every**, from a **Starting** day that defaults to today), its tags, and the
 * archive.
 *
 * Shorter than the Task editor on purpose. A wait has no Plan, no dependencies of its own and no
 * block reasons.
 */
export default function ExpectationEditorModal({ node, heading, lead, onSave, onClose, allTags, domainNames }: Props) {
  useInputCapture();
  const { t } = useTranslation(["expectation", "editor"]);
  // A delegation wait is drawn with a label round its title; the editor edits the title itself.
  const [title, setTitle] = useState(node.rowTitle ?? node.title);
  const [status, setStatus] = useState<ExpectationStatus>(
    node.status === EXPECTATION_STATUS.RELEASED ? EXPECTATION_STATUS.RELEASED : EXPECTATION_STATUS.PENDING,
  );
  const [checkEvery, setCheckEvery] = useState<DurationSpec | null>(node.checkEvery ?? null);
  const [checkStartingDate, setCheckStartingDate] = useState<string | null>(node.checkStarting?.slice(0, 10) ?? null);
  const [timeScope, setTimeScope] = useState<TimeScope | null>(node.timeScope ?? null);
  const [tagIds, setTagIds] = useState<number[]>(node.tagIds);
  const [archived, setArchived] = useState(node.archived === true);
  const [isPrivate, setIsPrivate] = useState(node.isPrivate ?? false);
  const [agentic, setAgentic] = useState(node.agentWaiting !== undefined);
  const [agenticNote, setAgenticNote] = useState(node.agentWaiting?.note ?? "");
  const [agenticAnswer, setAgenticAnswer] = useState(node.agentWaiting?.answer ?? "");
  // A question for the user unless the agent said otherwise — and a wait the user makes agentic
  // here is one too, as the backend defaults it.
  const isQuestion = node.agentWaiting?.question !== false;
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); titleRef.current?.select(); }, []);

  async function handleSave() {
    if (title.trim() === "") return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave({
        title: title.trim(), status, checkEvery, checkStartingDate, timeScope, tagIds, archived, isPrivate,
        // Trailing blank lines are dropped: a stray Enter at the end of a textarea is not part of
        // what the agent reads back.
        agentic, agenticNote: agenticNote.trim() === "" ? null : agenticNote.trimEnd(),
        agenticAnswer: agenticAnswer.trim() === "" ? null : agenticAnswer.trimEnd(),
      });
    } catch (err) {
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
      heading={heading ?? t("expectation:editHeading")}
      onClose={onClose}
      onKeyDown={handleKeyDown}
      isSaving={isSaving}
      onSave={() => void handleSave()}
      saveError={saveError}
    >
      {lead !== undefined && <p className={styles.label}>{lead}</p>}
      <label className={styles.label}>
        {t("editor:fieldTitle")}
        <input ref={titleRef} className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} type="text" />
      </label>
      <div className={styles.label}>
        {t("editor:fieldStatus")}
        <div className={styles.statusPills}>
          {STATUSES.map((option) => (
            <button
              key={option}
              type="button"
              className={`${styles.statusPill}${status === option ? ` ${styles.statusPillActive}` : ""}`}
              onClick={() => setStatus(option)}
            >
              {t(`expectation:status.${option}`)}
            </button>
          ))}
        </div>
      </div>
      {/* An agent's note comes first when there is one: it is what the wait is for. A question
          wait then takes the user's answer, in a field of its own — releasing it needs one. */}
      {agentic && (
        <label className={styles.label}>
          {isQuestion ? t("expectation:agentNote") : t("expectation:agentWaitNote")}
          <textarea
            className={styles.textarea}
            rows={4}
            value={agenticNote}
            onChange={(e) => setAgenticNote(e.target.value)}
          />
        </label>
      )}
      {agentic && isQuestion && (
        <label className={styles.label}>
          {t("expectation:agentAnswer")}
          <textarea
            className={styles.textarea}
            rows={3}
            value={agenticAnswer}
            placeholder={t("expectation:agentAnswerHint")}
            onChange={(e) => setAgenticAnswer(e.target.value)}
          />
        </label>
      )}
      <div className={styles.label}>
        {t("editor:fieldTimeScope")}
        <TimeScopeField value={timeScope} onChange={setTimeScope} />
      </div>
      <div className={styles.label}>
        {t("expectation:fieldCheckEvery")}
        <CountedDurationField
          value={checkEvery}
          onChange={setCheckEvery}
          label={t("expectation:fieldCheckEvery")}
          emptyLabel={t("expectation:checkEveryNone")}
          subDay
        />
      </div>
      {checkEvery !== null && (
        <div className={styles.label}>
          {t("expectation:fieldCheckStarting")}
          <StartingDayField
            value={checkStartingDate}
            onChange={setCheckStartingDate}
            emptyLabel={t("expectation:checkStartingNow")}
          />
        </div>
      )}
      {allTags !== undefined && domainNames !== undefined && (
        <TagPicker allTags={allTags} domainNames={domainNames} selectedIds={tagIds} onChange={setTagIds} />
      )}
      <EditorAdvanced isPrivate={isPrivate} onPrivateChange={setIsPrivate} startOpen={archived || agentic}>
        <Switch checked={archived} onChange={setArchived} label={t("expectation:archived")} />
        <Switch checked={agentic} onChange={setAgentic} label={t("expectation:agentWaiting")} />
      </EditorAdvanced>
    </EditorModal>
  );
}
