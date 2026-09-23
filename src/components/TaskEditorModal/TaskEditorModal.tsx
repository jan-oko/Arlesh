import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import BlockReasonsField from "@/components/BlockReasonsField/BlockReasonsField";
import TagPicker from "@/components/TagPicker/TagPicker";
import type { MindmapNode } from "@/utils/tree-layout";
import type { Domain } from "@/api/domains";
import type { Delegate, Dependency, TaskAgentic, TaskArchival } from "@/api/tasks";
import { TASK_AGENTIC, TASK_ARCHIVAL } from "@/api/tasks";
import { storedAgenticState } from "@/utils/agentic";
import { isDelegatedToAgent, toggledAgentDelegate } from "@/utils/delegation";
import type { TimeScope } from "@/api/time-scope";
import type { OnScopeExit } from "@/api/scope-lifecycle";
import { listTaskDependencies } from "@/api/tasks";
import { getErrorMessage } from "@/api/errors";
import { withAtomicGesture } from "@/api/gesture";
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
  /** Whether doing this task starts a wait. A plain boolean — the flag does not inherit, so
   * there is no third "unset" state for it to be in. */
  asynchronous: boolean;
  /** The task's new delegate, present only when the form changed it — `null` takes it back. Absent
   * says nothing about delegation at all, so a save that never touched it cannot overwrite it. */
  delegate?: Delegate | null;
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
  const { t } = useTranslation(["editor", "status", "nodeKinds", "undo"]);
  const [title, setTitle] = useState(node.title);
  const [status, setStatus] = useState(node.status ?? TASK_STATUS.TODO);
  const [blockReasons, setBlockReasons] = useState<string[]>(node.blockReasons ?? []);
  const [tagIds, setTagIds] = useState<number[]>(node.tagIds);
  const [timeScope, setTimeScope] = useState<TimeScope | null>(node.timeScope ?? null);
  const [onScopeExit, setOnScopeExit] = useState<OnScopeExit | null>(node.onScopeExit ?? null);
  const [plan, setPlan] = useState<TimeScope | null>(node.plan ?? null);
  const [isBacklogged, setIsBacklogged] = useState(node.backlogged === true);
  const [agentic, setAgentic] = useState<TaskAgentic>(storedAgenticState(node.agentic));
  const [isAsynchronous, setIsAsynchronous] = useState(node.asynchronous === true);
  const [delegate, setDelegate] = useState<Delegate | null>(node.delegate ?? null);
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
      // One Gesture, all or nothing: the beads clear, the update, the block reasons, the tags and
      // the dependencies are several commands but one thing the user filled in, so they are one
      // Ctrl+Z — and a refusal partway takes back the ones that landed rather than leaving a form
      // half-applied. The clamp prompt above is outside it, having written nothing yet.
      await withAtomicGesture(t("undo:gestures.editTask"), async () => {
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
          asynchronous: isAsynchronous,
          ...(delegate !== (node.delegate ?? null) ? { delegate } : {}),
          isPrivate,
        });
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

  // Starting a set-aside task takes it out of the backlog — you cannot be actively doing something
  // you have put down — and the backend does exactly this to a bare status change. Here the switch
  // moves in front of the user instead, so the save is not the first they hear of it. Only this
  // direction: a task already in progress may still be set aside, and keeps its status when it is.
  function setStatusAndClearBacklog(next: string) {
    setStatus(next);
    if (next === TASK_STATUS.IN_PROGRESS) setIsBacklogged(false);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && event.target === titleRef.current) { event.preventDefault(); void handleSave(); }
    if (event.key === "Escape") onClose();
  }

  // The one-click delegate button is offered on a task that reads as agentic — its own flag, or an
  // inherited one while it is on Inherit — and on any task already delegated to the Agent, so an
  // Agent delegate can always be taken back even after the flag that earned it is gone.
  const readsAgentic = agentic === TASK_AGENTIC.YES || (agentic === TASK_AGENTIC.INHERIT && node.inheritedAgentic === true);
  const delegatedToAgent = isDelegatedToAgent(delegate);

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
            <button key={s} type="button" className={`${styles.statusPill}${status === s ? ` ${styles.statusPillActive}` : ""}`} onClick={() => setStatusAndClearBacklog(s)}>
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
      {/* Beside Backlog rather than down in Advanced, where the Agentic control sits: this one is
          a statement about the order the work wants to be done in, which is the same kind of
          question as whether it is set aside at all — and it is the flag the List View's
          "Asynchronous first" setting reads. */}
      <div className={styles.label}>
        {t("fieldAsynchronous")}
        <Switch
          checked={isAsynchronous}
          onChange={setIsAsynchronous}
          label={isAsynchronous ? t("asynchronousOn") : t("asynchronousOff")}
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
        startOpen={agentic !== TASK_AGENTIC.INHERIT || delegatedToAgent}
      >
        <AgenticField
          value={agentic}
          inherited={node.inheritedAgentic === true}
          onChange={setAgentic}
          delegatedToAgent={delegatedToAgent}
          offersDelegate={readsAgentic || delegatedToAgent}
          onToggleDelegate={() => setDelegate(toggledAgentDelegate(delegate))}
        />
      </EditorAdvanced>
    </EditorModal>
  );
}
