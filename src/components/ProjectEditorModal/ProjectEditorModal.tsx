import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import { getErrorMessage } from "@/api/errors";
import EditorModal from "@/components/EditorModal/EditorModal";
import EditorAdvanced from "@/components/EditorModal/EditorAdvanced";
import BeadsIdField from "@/components/EditorModal/BeadsIdField";
import { useInputCapture } from "@/hooks/use-input-capture";
import { useBeadsIdClear } from "@/hooks/use-beads-id-clear";
import styles from "@/components/EditorModal/EditorModal.module.css";
import { PROJECT_STATUS } from "@/utils/status-mapping";

export interface ProjectSaveData {
  title: string;
  status: string;
  knowledgeBaseDirectory: string;
  isPrivate: boolean;
}

const PROJECT_STATUSES = Object.values(PROJECT_STATUS);

interface Props {
  node: MindmapNode;
  onSave: (data: ProjectSaveData) => Promise<void>;
  /** Drops the node's `bd` issue link. Called by Save once the row's × has staged the drop, never
   * by the × itself, so Cancel discards it like any other unsaved field. Omitted — as on the blank
   * node a create path opens, which has no link to drop — the Issue row stays wholly read-only. */
  onClearBeadsId?: (() => Promise<void>) | undefined;
  onClose: () => void;
}

export default function ProjectEditorModal({ node, onSave, onClearBeadsId, onClose }: Props) {
  useInputCapture();
  const { t } = useTranslation(["editor", "status"]);
  const [title, setTitle] = useState(node.title);
  const [status, setStatus] = useState(node.status ?? PROJECT_STATUS.ACTIVE);
  const [kbDir, setKbDir] = useState(node.knowledgeBaseDirectory ?? "");
  const [isPrivate, setIsPrivate] = useState(node.isPrivate ?? false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const beadsClear = useBeadsIdClear(onClearBeadsId);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); titleRef.current?.select(); }, []);

  async function handleSave() {
    if (title.trim() === "") return;
    setIsSaving(true);
    setSaveError(null);
    try {
      // Before the update, not after: a refused clear then leaves the node exactly as it was,
      // rather than half-saved, and the refusal reaches the save error line below the fields.
      await beadsClear.commitClear();
      await onSave({ title: title.trim(), status, knowledgeBaseDirectory: kbDir.trim(), isPrivate });
    } catch (err) {
      setSaveError(getErrorMessage(err));
      setIsSaving(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && event.target === titleRef.current) { event.preventDefault(); void handleSave(); }
    if (event.key === "Escape") onClose();
  }

  return (
    <EditorModal heading={t("editProject")} onClose={onClose} onKeyDown={handleKeyDown} isSaving={isSaving} onSave={() => void handleSave()} saveError={saveError}>
      <label className={styles.label}>
        {t("fieldTitle")}
        <input ref={titleRef} className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} type="text" />
      </label>
      <BeadsIdField beadsId={node.beadsId} isCleared={beadsClear.isCleared} onClear={beadsClear.stageClear} />
      <div className={styles.label}>
        {t("fieldStatus")}
        <div className={styles.statusPills}>
          {PROJECT_STATUSES.map((s) => (
            <button key={s} type="button" className={`${styles.statusPill}${status === s ? ` ${styles.statusPillActive}` : ""}`} onClick={() => setStatus(s)}>
              {t(`status:project.${s}`)}
            </button>
          ))}
        </div>
      </div>
      <label className={styles.label}>
        {t("fieldKbDir")}
        <input className={styles.input} value={kbDir} onChange={(e) => setKbDir(e.target.value)} type="text" placeholder={t("placeholderKbDir")} />
      </label>
      <EditorAdvanced isPrivate={isPrivate} onPrivateChange={setIsPrivate} />
    </EditorModal>
  );
}
