import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import type { Domain } from "@/api/domains";
import type { TimeScope } from "@/api/time-scope";
import EditorModal from "@/components/EditorModal/EditorModal";
import TimeScopeField from "@/components/ScopePicker/TimeScopeField";
import styles from "@/components/EditorModal/EditorModal.module.css";
import { GOAL_STATUS } from "@/utils/status-mapping";

export interface GoalSaveData {
  title: string;
  status: string;
  blockedReason: string;
  tagIds: number[];
  timeScope: TimeScope | null;
}

const GOAL_STATUSES = Object.values(GOAL_STATUS);

interface Props {
  node: MindmapNode;
  allTags: Domain[];
  onSave: (data: GoalSaveData) => Promise<void>;
  onClose: () => void;
}

export default function GoalEditorModal({ node, allTags, onSave, onClose }: Props) {
  const { t } = useTranslation(["editor", "status"]);
  const [title, setTitle] = useState(node.title);
  const [status, setStatus] = useState(node.status ?? GOAL_STATUS.ACTIVE);
  const [blockedReason, setBlockedReason] = useState(node.blockedReason ?? "");
  const [tagIds, setTagIds] = useState<number[]>(node.tagIds);
  const [timeScope, setTimeScope] = useState<TimeScope | null>(node.timeScope ?? null);
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
      await onSave({ title: title.trim(), status, blockedReason, tagIds, timeScope });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setIsSaving(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && event.target === titleRef.current) { event.preventDefault(); void handleSave(); }
    if (event.key === "Escape") onClose();
  }

  const validTags = allTags.filter((tag) => tag.title.trim() !== "");

  return (
    <EditorModal heading={t("editGoal")} onClose={onClose} onKeyDown={handleKeyDown} isSaving={isSaving} onSave={() => void handleSave()} saveError={saveError}>
      <label className={styles.label}>
        {t("fieldTitle")}
        <input ref={titleRef} className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} type="text" />
      </label>
      <div className={styles.label}>
        {t("fieldStatus")}
        <div className={styles.statusPills}>
          {GOAL_STATUSES.map((s) => (
            <button key={s} type="button" className={`${styles.statusPill}${status === s ? ` ${styles.statusPillActive}` : ""}`} onClick={() => setStatus(s)}>
              {t(`status:goal.${s}`)}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.label}>
        {t("fieldTimeScope")}
        <TimeScopeField value={timeScope} onChange={setTimeScope} />
      </div>
      <label className={styles.label}>
        {t("fieldBlockReason")}
        <textarea className={styles.textarea} value={blockedReason} onChange={(e) => setBlockedReason(e.target.value)} placeholder={t("placeholderBlockReason")} />
      </label>
      {validTags.length > 0 && (
        <fieldset className={styles.tagSection}>
          <legend className={styles.label}>{t("fieldTags")}</legend>
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
