import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import EditorModal from "@/components/EditorModal/EditorModal";
import EditorAdvanced from "@/components/EditorModal/EditorAdvanced";
import styles from "@/components/EditorModal/EditorModal.module.css";

export interface ProjectSaveData {
  title: string;
  status: string;
  knowledgeBaseDirectory: string;
  nsfw: boolean;
}

const PROJECT_STATUS = {
  ACTIVE: "active",
  PAUSED: "paused",
  COMPLETED: "completed",
  ARCHIVED: "archived",
} as const;

const PROJECT_STATUSES = Object.values(PROJECT_STATUS);

interface Props {
  node: MindmapNode;
  onSave: (data: ProjectSaveData) => Promise<void>;
  onClose: () => void;
}

export default function ProjectEditorModal({ node, onSave, onClose }: Props) {
  const { t } = useTranslation(["editor", "status"]);
  const [title, setTitle] = useState(node.title);
  const [status, setStatus] = useState(node.status ?? PROJECT_STATUS.ACTIVE);
  const [kbDir, setKbDir] = useState(node.knowledgeBaseDirectory ?? "");
  const [nsfw, setNsfw] = useState(node.nsfw ?? false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); titleRef.current?.select(); }, []);

  async function handleSave() {
    if (title.trim() === "") return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave({ title: title.trim(), status, knowledgeBaseDirectory: kbDir.trim(), nsfw });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
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
      <EditorAdvanced nsfw={nsfw} onNsfwChange={setNsfw} />
    </EditorModal>
  );
}
