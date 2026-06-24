import { useEffect, useRef, useState } from "react";
import type { MindmapNode } from "@/utils/tree-layout";
import EditorModal from "@/components/EditorModal/EditorModal";
import styles from "@/components/EditorModal/EditorModal.module.css";

export interface ProjectSaveData {
  title: string;
  status: string;
  knowledgeBaseDirectory: string;
}

const PROJECT_STATUSES = ["active", "paused", "completed", "archived"] as const;

interface Props {
  node: MindmapNode;
  onSave: (data: ProjectSaveData) => Promise<void>;
  onClose: () => void;
}

export default function ProjectEditorModal({ node, onSave, onClose }: Props) {
  const [title, setTitle] = useState(node.title);
  const [status, setStatus] = useState(node.status ?? "active");
  const [kbDir, setKbDir] = useState(node.knowledgeBaseDirectory ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); titleRef.current?.select(); }, []);

  async function handleSave() {
    if (title.trim() === "") return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave({ title: title.trim(), status, knowledgeBaseDirectory: kbDir.trim() });
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
    <EditorModal heading="Edit Project" onClose={onClose} onKeyDown={handleKeyDown} isSaving={isSaving} onSave={() => void handleSave()} saveError={saveError}>
      <label className={styles.label}>
        Title
        <input ref={titleRef} className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} type="text" />
      </label>
      <div className={styles.label}>
        Status
        <div className={styles.statusPills}>
          {PROJECT_STATUSES.map((s) => (
            <button key={s} type="button" className={`${styles.statusPill}${status === s ? ` ${styles.statusPillActive}` : ""}`} onClick={() => setStatus(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <label className={styles.label}>
        Knowledge base directory
        <input className={styles.input} value={kbDir} onChange={(e) => setKbDir(e.target.value)} type="text" placeholder="/path/to/vault" />
      </label>
    </EditorModal>
  );
}
