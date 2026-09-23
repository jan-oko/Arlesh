import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import type { TimeScope } from "@/api/time-scope";
import type { ExpectationStatus } from "@/api/expectations";
import { EXPECTATION_STATUS } from "@/api/expectations";
import { getErrorMessage } from "@/api/errors";
import EditorModal from "@/components/EditorModal/EditorModal";
import EditorAdvanced from "@/components/EditorModal/EditorAdvanced";
import TimeScopeField from "@/components/ScopePicker/TimeScopeField";
import Switch from "@/components/Switch/Switch";
import { useInputCapture } from "@/hooks/use-input-capture";
import styles from "@/components/EditorModal/EditorModal.module.css";

export interface ExpectationSaveData {
  title: string;
  status: ExpectationStatus;
  checkBy: TimeScope | null;
  archived: boolean;
  isPrivate: boolean;
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
}

/**
 * The Expectation editor: a title, the status (Pending / Released), the optional **check-by**, and
 * the archive.
 *
 * Shorter than the Task editor on purpose. A wait has no Time Scope, no Plan, no tags, no
 * dependencies of its own and no block reasons. The check-by opens in **Duration** form when it is
 * empty — "look in on it in three days" is the usual shape of the answer — and a stored one opens
 * in whatever form it was set in.
 */
export default function ExpectationEditorModal({ node, heading, lead, onSave, onClose }: Props) {
  useInputCapture();
  const { t } = useTranslation(["expectation", "editor"]);
  const [title, setTitle] = useState(node.title);
  const [status, setStatus] = useState<ExpectationStatus>(
    node.status === EXPECTATION_STATUS.RELEASED ? EXPECTATION_STATUS.RELEASED : EXPECTATION_STATUS.PENDING,
  );
  const [checkBy, setCheckBy] = useState<TimeScope | null>(node.checkBy ?? null);
  const [archived, setArchived] = useState(node.archived === true);
  const [isPrivate, setIsPrivate] = useState(node.isPrivate ?? false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); titleRef.current?.select(); }, []);

  async function handleSave() {
    if (title.trim() === "") return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave({ title: title.trim(), status, checkBy, archived, isPrivate });
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
      <div className={styles.label}>
        {t("expectation:fieldCheckBy")}
        <TimeScopeField value={checkBy} onChange={setCheckBy} defaultForm="duration" />
      </div>
      <EditorAdvanced isPrivate={isPrivate} onPrivateChange={setIsPrivate} startOpen={archived}>
        <Switch checked={archived} onChange={setArchived} label={t("expectation:archived")} />
      </EditorAdvanced>
    </EditorModal>
  );
}
