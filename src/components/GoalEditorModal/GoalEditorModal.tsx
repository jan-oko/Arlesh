import { useEffect, useRef, useState } from "react";
import type { MindmapNode } from "@/utils/tree-layout";
import type { Domain } from "@/api/domains";
import EditorModal from "@/components/EditorModal/EditorModal";
import styles from "@/components/EditorModal/EditorModal.module.css";
import { GOAL_STATUS } from "@/utils/status-mapping";

export interface GoalSaveData {
  title: string;
  status: string;
  blockedReason: string;
  tagIds: number[];
}

const GOAL_STATUSES = Object.values(GOAL_STATUS);

interface Props {
  node: MindmapNode;
  allTags: Domain[];
  onSave: (data: GoalSaveData) => Promise<void>;
  onClose: () => void;
}

export default function GoalEditorModal({ node, allTags, onSave, onClose }: Props) {
  const [title, setTitle] = useState(node.title);
  const [status, setStatus] = useState(node.status ?? GOAL_STATUS.ACTIVE);
  const [blockedReason, setBlockedReason] = useState(node.blockedReason ?? "");
  const [tagIds, setTagIds] = useState<number[]>(node.tagIds);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); titleRef.current?.select(); }, []);

  function toggleTag(tagId: number) {
    setTagIds((prev) => prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]);
  }

  async function handleSave() {
    if (title.trim() === "") return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave({ title: title.trim(), status, blockedReason, tagIds });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setIsSaving(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && event.target === titleRef.current) { event.preventDefault(); void handleSave(); }
    if (event.key === "Escape") onClose();
  }

  const validTags = allTags.filter((t) => t.title.trim() !== "");

  return (
    <EditorModal heading="Edit Goal" onClose={onClose} onKeyDown={handleKeyDown} isSaving={isSaving} onSave={() => void handleSave()} saveError={saveError}>
      <label className={styles.label}>
        Title
        <input ref={titleRef} className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} type="text" />
      </label>
      <div className={styles.label}>
        Status
        <div className={styles.statusPills}>
          {GOAL_STATUSES.map((s) => (
            <button key={s} type="button" className={`${styles.statusPill}${status === s ? ` ${styles.statusPillActive}` : ""}`} onClick={() => setStatus(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <label className={styles.label}>
        Block reason
        <textarea className={styles.textarea} value={blockedReason} onChange={(e) => setBlockedReason(e.target.value)} placeholder="Leave empty to clear" />
      </label>
      {validTags.length > 0 && (
        <fieldset className={styles.tagSection}>
          <legend className={styles.label}>Tags</legend>
          <div className={styles.tagList}>
            {validTags.map((tag) => (
              <label key={tag.id} className={styles.tagOption}>
                <input type="checkbox" checked={tagIds.includes(tag.id)} onChange={() => toggleTag(tag.id)} />
                {tag.title}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </EditorModal>
  );
}
