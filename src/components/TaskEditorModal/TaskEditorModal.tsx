import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import BlockReasonsField from "@/components/BlockReasonsField/BlockReasonsField";
import type { MindmapNode } from "@/utils/tree-layout";
import type { Domain } from "@/api/domains";
import type { Dependency } from "@/api/tasks";
import type { TimeScope } from "@/api/time-scope";
import type { OnScopeExit } from "@/api/scope-lifecycle";
import { listTaskDependencies } from "@/api/tasks";
import EditorModal from "@/components/EditorModal/EditorModal";
import TimeScopeField from "@/components/ScopePicker/TimeScopeField";
import OnScopeExitField from "@/components/ScopePicker/OnScopeExitField";
import PlanField from "@/components/ScopePicker/PlanField";
import styles from "@/components/EditorModal/EditorModal.module.css";
import { TASK_STATUS } from "@/utils/status-mapping";

export interface TaskSaveData {
  title: string;
  status: string;
  blockReasons: string[];
  tagIds: number[];
  addedDeps: Dependency[];
  removedDeps: Dependency[];
  timeScope: TimeScope | null;
  onScopeExit: OnScopeExit | null;
  plan: TimeScope | null;
}

const TASK_STATUSES = Object.values(TASK_STATUS);

function depKey(dep: Dependency): string { return `${dep.type}-${dep.id}`; }
function depEquals(a: Dependency, b: Dependency): boolean { return a.type === b.type && a.id === b.id; }

interface Props {
  node: MindmapNode;
  allTags: Domain[];
  availableForDep: MindmapNode[];
  onSave: (data: TaskSaveData) => Promise<void>;
  onCheckScopeClamp?: (nodeType: "task" | "goal", dbId: number, timeScope: TimeScope) => Promise<boolean>;
  onClose: () => void;
}

export default function TaskEditorModal({ node, allTags, availableForDep, onSave, onCheckScopeClamp, onClose }: Props) {
  const { t } = useTranslation(["editor", "status", "nodeKinds"]);
  const [title, setTitle] = useState(node.title);
  const [status, setStatus] = useState(node.status ?? TASK_STATUS.TODO);
  const [blockReasons, setBlockReasons] = useState<string[]>(node.blockReasons ?? []);
  const [tagIds, setTagIds] = useState<number[]>(node.tagIds);
  const [timeScope, setTimeScope] = useState<TimeScope | null>(node.timeScope ?? null);
  const [onScopeExit, setOnScopeExit] = useState<OnScopeExit | null>(node.onScopeExit ?? null);
  const [plan, setPlan] = useState<TimeScope | null>(node.plan ?? null);
  const [initialDeps, setInitialDeps] = useState<Dependency[]>([]);
  const [currentDeps, setCurrentDeps] = useState<Dependency[]>([]);
  const [depSearch, setDepSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const dbId = parseInt(node.id.split("-").pop() ?? "0", 10);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
    void listTaskDependencies(dbId).then((deps) => { setInitialDeps(deps); setCurrentDeps(deps); });
  }, [dbId]);

  function toggleTag(tagId: number) {
    setTagIds((prev) => prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]);
  }

  function removeDep(dep: Dependency) {
    setCurrentDeps((prev) => prev.filter((d) => !depEquals(d, dep)));
  }

  function addDep(candidate: MindmapNode) {
    const kind = candidate.kind === "goal" ? "goal" : "task";
    const id = parseInt(candidate.id.split("-").pop() ?? "0", 10);
    const dep: Dependency = { type: kind, id };
    if (currentDeps.some((d) => depEquals(d, dep))) return;
    setCurrentDeps((prev) => [...prev, dep]);
    setDepSearch("");
  }

  async function handleSave() {
    if (title.trim() === "") return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const addedDeps = currentDeps.filter((d) => !initialDeps.some((id) => depEquals(id, d)));
      const removedDeps = initialDeps.filter((d) => !currentDeps.some((cd) => depEquals(cd, d)));
      if (timeScope !== null && onCheckScopeClamp && !(await onCheckScopeClamp("task", dbId, timeScope))) {
        setIsSaving(false);
        return;
      }
      await onSave({
        title: title.trim(), status, blockReasons: blockReasons.map((r) => r.trim()).filter((r) => r !== ""),
        tagIds, addedDeps, removedDeps, timeScope,
        onScopeExit: timeScope !== null ? (onScopeExit ?? "keep") : null,
        plan,
      });
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
  const depSearchLower = depSearch.toLowerCase();
  const searchResults = depSearch.trim() === "" ? [] : availableForDep
    .filter((n) => n.kind === "task" || n.kind === "goal")
    .filter((n) => n.title.toLowerCase().includes(depSearchLower))
    .filter((n) => {
      const id = parseInt(n.id.split("-").pop() ?? "0", 10);
      const type = n.kind === "goal" ? "goal" : "task";
      return !currentDeps.some((d) => d.type === type && d.id === id);
    })
    .slice(0, 8);

  function depTitle(dep: Dependency): string {
    return availableForDep.find((n) => n.id === `${dep.type}-${dep.id}`)?.title ?? `${dep.type} #${dep.id}`;
  }

  return (
    <EditorModal heading={t("editTask")} onClose={onClose} onKeyDown={handleKeyDown} isSaving={isSaving} onSave={() => void handleSave()} saveError={saveError}>
      <label className={styles.label}>
        {t("fieldTitle")}
        <input ref={titleRef} className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} type="text" />
      </label>
      <div className={styles.label}>
        {t("fieldStatus")}
        <div className={styles.statusPills}>
          {TASK_STATUSES.map((s) => (
            <button key={s} type="button" className={`${styles.statusPill}${status === s ? ` ${styles.statusPillActive}` : ""}`} onClick={() => setStatus(s)}>
              {t(`status:task.${s}`)}
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
      <div className={styles.label}>
        {t("fieldPlan")}
        <PlanField value={plan} timeScope={timeScope} onChange={setPlan} />
      </div>
      <BlockReasonsField reasons={blockReasons} onChange={setBlockReasons} />
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
      <div className={styles.depSection}>
        <span className={styles.label}>{t("fieldDependencies")}</span>
        {currentDeps.length > 0 && (
          <div className={styles.depList}>
            {currentDeps.map((dep) => (
              <div key={depKey(dep)} className={styles.depItem}>
                <span>{depTitle(dep)}<span className={styles.depKind}>{t(`nodeKinds:${dep.type}`)}</span></span>
                <button type="button" className={styles.depRemoveBtn} onClick={() => removeDep(dep)}>×</button>
              </div>
            ))}
          </div>
        )}
        <div className={styles.depSearchWrap}>
          <input type="text" className={styles.depSearch} placeholder={t("placeholderDepSearch")} value={depSearch} onChange={(e) => setDepSearch(e.target.value)} />
          {searchResults.length > 0 && (
            <div className={styles.depResults}>
              {searchResults.map((n) => (
                <div key={n.id} className={styles.depResult} onMouseDown={(e) => { e.preventDefault(); addDep(n); }}>
                  <span>{n.title}</span>
                  <span className={styles.depKind}>{t(`nodeKinds:${n.kind}`)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </EditorModal>
  );
}
