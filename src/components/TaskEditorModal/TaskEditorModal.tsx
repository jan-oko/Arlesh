import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import BlockReasonsField from "@/components/BlockReasonsField/BlockReasonsField";
import TagPicker from "@/components/TagPicker/TagPicker";
import type { MindmapNode } from "@/utils/tree-layout";
import type { Domain } from "@/api/domains";
import type { Dependency, TaskAgentic, TaskArchival } from "@/api/tasks";
import { TASK_AGENTIC, TASK_ARCHIVAL } from "@/api/tasks";
import { storedAgenticState } from "@/utils/agentic";
import type { TimeScope } from "@/api/time-scope";
import type { OnScopeExit } from "@/api/scope-lifecycle";
import { listTaskDependencies } from "@/api/tasks";
import { getErrorMessage } from "@/api/errors";
import EditorModal from "@/components/EditorModal/EditorModal";
import EditorAdvanced from "@/components/EditorModal/EditorAdvanced";
import BeadsIdField from "@/components/EditorModal/BeadsIdField";
import AgenticField from "./AgenticField";
import TimeScopeField from "@/components/ScopePicker/TimeScopeField";
import OnScopeExitField from "@/components/ScopePicker/OnScopeExitField";
import PlanField from "@/components/ScopePicker/PlanField";
import { useInputCapture } from "@/hooks/use-input-capture";
import { useBeadsIdClear } from "@/hooks/use-beads-id-clear";
import Switch from "@/components/Switch/Switch";
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
  /** `backlog` when deliberately set aside. Never `backlog` while `plan` is set — the form keeps
   * the two exclusive, so the save never has to be refused for it. */
  archival: TaskArchival;
  /** The task's own Agentic state. `"inherit"` is a real instruction — it clears a stored flag
   * and puts the task back to reading its ancestors — not an absent value. */
  agentic: TaskAgentic;
  isPrivate: boolean;
}

const TASK_STATUSES = Object.values(TASK_STATUS);

function depKey(dep: Dependency): string { return `${dep.type}-${dep.id}`; }
function depEquals(a: Dependency, b: Dependency): boolean { return a.type === b.type && a.id === b.id; }

interface Props {
  node: MindmapNode;
  allTags: Domain[];
  domainNames: Map<number, string>;
  availableForDep: MindmapNode[];
  onSave: (data: TaskSaveData) => Promise<void>;
  /** Drops the node's `bd` issue link. Called by Save once the row's × has staged the drop, never
   * by the × itself, so Cancel discards it like any other unsaved field. Omitted — as on the blank
   * node a create path opens, which has no link to drop — the Issue row stays wholly read-only. */
  onClearBeadsId?: (() => Promise<void>) | undefined;
  onCheckScopeClamp?: (nodeType: "task" | "goal", dbId: number, timeScope: TimeScope) => Promise<boolean>;
  onClose: () => void;
}

export default function TaskEditorModal({ node, allTags, domainNames, availableForDep, onSave, onClearBeadsId, onCheckScopeClamp, onClose }: Props) {
  useInputCapture();
  const { t } = useTranslation(["editor", "status", "nodeKinds"]);
  const [title, setTitle] = useState(node.title);
  const [status, setStatus] = useState(node.status ?? TASK_STATUS.TODO);
  const [blockReasons, setBlockReasons] = useState<string[]>(node.blockReasons ?? []);
  const [tagIds, setTagIds] = useState<number[]>(node.tagIds);
  const [timeScope, setTimeScope] = useState<TimeScope | null>(node.timeScope ?? null);
  const [onScopeExit, setOnScopeExit] = useState<OnScopeExit | null>(node.onScopeExit ?? null);
  const [plan, setPlan] = useState<TimeScope | null>(node.plan ?? null);
  const [isBacklogged, setIsBacklogged] = useState(node.backlogged === true);
  const [agentic, setAgentic] = useState<TaskAgentic>(storedAgenticState(node.agentic));
  const [isPrivate, setIsPrivate] = useState(node.isPrivate ?? false);
  const [initialDeps, setInitialDeps] = useState<Dependency[]>([]);
  const [currentDeps, setCurrentDeps] = useState<Dependency[]>([]);
  const [depSearch, setDepSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const beadsClear = useBeadsIdClear(onClearBeadsId);
  const titleRef = useRef<HTMLInputElement>(null);
  const dbId = parseInt(node.id.split("-").pop() ?? "0", 10);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
    void listTaskDependencies(dbId).then((deps) => { setInitialDeps(deps); setCurrentDeps(deps); });
  }, [dbId]);


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
      // Before the update, not after: a refused clear then leaves the node exactly as it was,
      // rather than half-saved, and the refusal reaches the save error line below the fields.
      await beadsClear.commitClear();
      await onSave({
        title: title.trim(), status, blockReasons: blockReasons.map((r) => r.trim()).filter((r) => r !== ""),
        tagIds, addedDeps, removedDeps, timeScope,
        onScopeExit: timeScope !== null ? (onScopeExit ?? "keep") : null,
        plan,
        archival: isBacklogged ? TASK_ARCHIVAL.BACKLOG : TASK_ARCHIVAL.LIVE,
        agentic,
        isPrivate,
      });
    } catch (err) {
      setSaveError(getErrorMessage(err));
      setIsSaving(false);
    }
  }

  // The two are mutually exclusive, and the form resolves that rather than letting the save be
  // refused for it. Each direction clears the other *in front of the user*, in the same panel, so
  // the change is seen as it happens instead of arriving as a surprise after saving.
  function setBacklogAndClearPlan(next: boolean) {
    setIsBacklogged(next);
    if (next) setPlan(null);
  }

  function setPlanAndClearBacklog(next: TimeScope | null) {
    setPlan(next);
    if (next !== null) setIsBacklogged(false);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && event.target === titleRef.current) { event.preventDefault(); void handleSave(); }
    if (event.key === "Escape") onClose();
  }

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

  // Virtual blockers derived from the *current* (editable) dependencies — an unmet dependency (a
  // non-Done task / non-Achieved goal) blocks. Recomputed live, so removing a dependency drops its row.
  const virtualBlockers = currentDeps.flatMap((dep) => {
    const target = availableForDep.find((n) => n.id === `${dep.type}-${dep.id}`);
    const unmet = target === undefined
      ? true
      : dep.type === "task" ? target.status !== "done" : target.status !== "achieved";
    return unmet ? [`Blocked by ${dep.type} ${dep.id} (${depTitle(dep)})`] : [];
  });

  return (
    <EditorModal heading={t("editTask")} onClose={onClose} onKeyDown={handleKeyDown} isSaving={isSaving} onSave={() => void handleSave()} saveError={saveError}>
      <label className={styles.label}>
        {t("fieldTitle")}
        <input ref={titleRef} className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} type="text" />
      </label>
      <BeadsIdField beadsId={node.beadsId} isCleared={beadsClear.isCleared} onClear={beadsClear.stageClear} />
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
        <PlanField value={plan} timeScope={timeScope} onChange={setPlanAndClearBacklog} />
      </div>
      <div className={styles.label}>
        {t("fieldBacklog")}
        <Switch
          checked={isBacklogged}
          onChange={setBacklogAndClearPlan}
          label={isBacklogged ? t("backlogOn") : t("backlogOff")}
        />
      </div>
      <BlockReasonsField reasons={blockReasons} onChange={setBlockReasons} virtualBlockers={virtualBlockers} />
      <TagPicker allTags={allTags} domainNames={domainNames} selectedIds={tagIds} onChange={setTagIds} />
      <div className={styles.depSection}>
        <span className={styles.label}>{t("fieldDependencies")}</span>
        {currentDeps.length > 0 && (
          <div className={styles.depList}>
            {currentDeps.map((dep) => (
              <div key={depKey(dep)} className={styles.depItem}>
                <span>{depTitle(dep)}<span className={styles.depKind}>{t(`nodeKinds:${dep.type}`)}</span></span>
                <button type="button" className={styles.depRemoveBtn} aria-label={t("removeDependency")} onClick={() => removeDep(dep)}>×</button>
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
      <EditorAdvanced
        isPrivate={isPrivate}
        onPrivateChange={setIsPrivate}
        startOpen={agentic !== TASK_AGENTIC.INHERIT}
      >
        <AgenticField
          value={agentic}
          inherited={node.inheritedAgentic === true}
          onChange={setAgentic}
        />
      </EditorAdvanced>
    </EditorModal>
  );
}
