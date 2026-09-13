import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import BlockReasonsField from "@/components/BlockReasonsField/BlockReasonsField";
import TagPicker from "@/components/TagPicker/TagPicker";
import type { MindmapNode } from "@/utils/tree-layout";
import type { Domain } from "@/api/domains";
import type { TimeScope } from "@/api/time-scope";
import type { OnScopeExit } from "@/api/scope-lifecycle";
import { getErrorMessage } from "@/api/errors";
import EditorModal from "@/components/EditorModal/EditorModal";
import EditorAdvanced from "@/components/EditorModal/EditorAdvanced";
import TimeScopeField from "@/components/ScopePicker/TimeScopeField";
import OnScopeExitField from "@/components/ScopePicker/OnScopeExitField";
import { useInputCapture } from "@/hooks/use-input-capture";
import styles from "@/components/EditorModal/EditorModal.module.css";
import { GOAL_STATUS } from "@/utils/status-mapping";

export interface GoalSaveData {
  title: string;
  status: string;
  blockReasons: string[];
  tagIds: number[];
  timeScope: TimeScope | null;
  onScopeExit: OnScopeExit | null;
  isPrivate: boolean;
}

const GOAL_STATUSES = Object.values(GOAL_STATUS);

interface Props {
  node: MindmapNode;
  allTags: Domain[];
  domainNames: Map<number, string>;
  onSave: (data: GoalSaveData) => Promise<void>;
  onCheckScopeClamp?: (nodeType: "task" | "goal", dbId: number, timeScope: TimeScope) => Promise<boolean>;
  onClose: () => void;
}

export default function GoalEditorModal({ node, allTags, domainNames, onSave, onCheckScopeClamp, onClose }: Props) {
  useInputCapture();
  const { t } = useTranslation(["editor", "status"]);
  const [title, setTitle] = useState(node.title);
  const [status, setStatus] = useState(node.status ?? GOAL_STATUS.ACTIVE);
  const [blockReasons, setBlockReasons] = useState<string[]>(node.blockReasons ?? []);
  const [tagIds, setTagIds] = useState<number[]>(node.tagIds);
  const [timeScope, setTimeScope] = useState<TimeScope | null>(node.timeScope ?? null);
  const [onScopeExit, setOnScopeExit] = useState<OnScopeExit | null>(node.onScopeExit ?? null);
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
      const dbId = parseInt(node.id.split("-").pop() ?? "0", 10);
      if (timeScope !== null && onCheckScopeClamp && !(await onCheckScopeClamp("goal", dbId, timeScope))) {
        setIsSaving(false);
        return;
      }
      await onSave({
        title: title.trim(),
        status,
        blockReasons: blockReasons.map((r) => r.trim()).filter((r) => r !== ""),
        tagIds,
        timeScope,
        onScopeExit: timeScope !== null ? (onScopeExit ?? "keep") : null,
        isPrivate,
      });
    } catch (err) {
      setSaveError(getErrorMessage(err));
      setIsSaving(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && event.target === titleRef.current) { event.preventDefault(); void handleSave(); }
    if (event.key === "Escape") onClose();
  }

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
      {timeScope !== null && (
        <div className={styles.label}>
          {t("fieldOnScopeExit")}
          <OnScopeExitField value={onScopeExit} onChange={setOnScopeExit} />
        </div>
      )}
      <BlockReasonsField reasons={blockReasons} onChange={setBlockReasons} />
      <TagPicker allTags={allTags} domainNames={domainNames} selectedIds={tagIds} onChange={setTagIds} />
      <EditorAdvanced isPrivate={isPrivate} onPrivateChange={setIsPrivate} />
    </EditorModal>
  );
}
