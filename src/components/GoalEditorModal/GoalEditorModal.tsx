import { useEffect, useRef, useState } from "react";
import { isDerivedId } from "@/api/node-id";
import { useTranslation } from "react-i18next";
import { rowIdOf, isOccurrence } from "@/utils/node-identity";
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
  /** A Save the server refused: the editor opens again on what was typed, with the reason on its error line. */
  reopened?: { draft: GoalSaveData; error: string } | undefined;
  onCheckScopeClamp?: (nodeType: "task" | "goal", dbId: number, timeScope: TimeScope) => Promise<boolean>;
  onClose: () => void;
}

export default function GoalEditorModal({ node, allTags, domainNames, onSave, reopened, onCheckScopeClamp, onClose }: Props) {
  useInputCapture();
  const { t } = useTranslation(["editor", "status"]);
  const draft = reopened?.draft;
  const [title, setTitle] = useState(draft?.title ?? node.rowTitle ?? node.title);
  const [status, setStatus] = useState(draft?.status ?? node.status ?? GOAL_STATUS.ACTIVE);
  const [blockReasons, setBlockReasons] = useState<string[]>(draft?.blockReasons ?? node.blockReasons ?? []);
  const [tagIds, setTagIds] = useState<number[]>(draft?.tagIds ?? node.tagIds);
  const [timeScope, setTimeScope] = useState<TimeScope | null>(draft ? draft.timeScope : node.timeScope ?? null);
  const [onScopeExit, setOnScopeExit] = useState<OnScopeExit | null>(draft ? draft.onScopeExit : node.onScopeExit ?? null);
  const [isPrivate, setIsPrivate] = useState(draft?.isPrivate ?? node.isPrivate ?? false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(reopened?.error ?? null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); titleRef.current?.select(); }, []);

  async function handleSave() {
    if (title.trim() === "") return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const dbId = rowIdOf(node);
      if (timeScope !== null && !isDerivedId(dbId) && onCheckScopeClamp && !(await onCheckScopeClamp("goal", dbId, timeScope))) {
        setIsSaving(false);
        return;
      }
      // The editor closes as the Save is handed on; the write runs as one all-or-nothing Gesture
      // (see `useNodeEditor`), and a refusal opens this editor again with the reason.
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
        <TimeScopeField
          value={timeScope}
          onChange={setTimeScope}
          {...(isOccurrence(node) ? { lockedReason: t("editor:scopeLockedOccurrence") } : {})}
        />
      </div>
      {timeScope !== null && (
        <div className={styles.label}>
          {t("fieldOnScopeExit")}
          <OnScopeExitField value={onScopeExit} onChange={setOnScopeExit} />
        </div>
      )}
      <BlockReasonsField reasons={blockReasons} onChange={setBlockReasons} coolingUntil={node.coolingUntil} />
      <TagPicker allTags={allTags} domainNames={domainNames} selectedIds={tagIds} onChange={setTagIds} />
      <EditorAdvanced isPrivate={isPrivate} onPrivateChange={setIsPrivate} />
    </EditorModal>
  );
}
