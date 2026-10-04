import { useEffect, useRef, useState } from "react";
import { checkOrigin, isDerivedId, storedId } from "@/api/node-id";
import { useTranslation } from "react-i18next";
import { rowIdOf, isOccurrence } from "@/utils/node-identity";
import BlockReasonsField from "@/components/BlockReasonsField/BlockReasonsField";
import TagPicker from "@/components/TagPicker/TagPicker";
import type { MindmapNode } from "@/utils/tree-layout";
import { entityNodeId } from "@/utils/tree-layout";
import type { Domain } from "@/api/domains";
import type { AgenticBrief, AsyncTemplate, Delegate, Dependency, TaskAgentic, TaskArchival, TaskStatus } from "@/api/tasks";
import { EMPTY_AGENTIC_BRIEF, isEmptyBrief } from "@/api/tasks";
import { TASK_AGENTIC, TASK_ARCHIVAL } from "@/api/tasks";
import { storedAgenticState } from "@/utils/agentic";
import type { TimeScope } from "@/api/time-scope";
import type { OnScopeExit } from "@/api/scope-lifecycle";
import { fetchTaskDoneAt, listTaskDependencies } from "@/api/tasks";
import { fromDoneDateInput, nowDoneDateInput, toDoneDateInput } from "@/utils/done-date";
import { getErrorMessage } from "@/api/errors";
import { withAtomicGesture } from "@/api/gesture";
import EditorModal from "@/components/EditorModal/EditorModal";
import EditorAdvanced from "@/components/EditorModal/EditorAdvanced";
import ArchivedField from "@/components/EditorModal/ArchivedField";
import { canArchiveByHand } from "@/utils/hand-archive";
import AgenticField from "./AgenticField";
import AgenticBriefFields from "./AgenticBriefFields";
import ShortIdField from "./ShortIdField";
import TimeScopeField from "@/components/ScopePicker/TimeScopeField";
import OnScopeExitField from "@/components/ScopePicker/OnScopeExitField";
import PlanField from "@/components/ScopePicker/PlanField";
import DueField from "@/components/ScopePicker/DueField";
import { useInputCapture } from "@/hooks/use-input-capture";
import Switch from "@/components/Switch/Switch";
import AsyncTemplateFields from "@/components/AsyncTemplateEditor/AsyncTemplateFields";
import { EMPTY_ASYNC_TEMPLATE, asyncTemplateToSave } from "@/utils/async-template";
import { takesCompound } from "@/utils/compound";
import styles from "@/components/EditorModal/EditorModal.module.css";
import {
  AGENTIC_STATUS, TASK_STATUS, agentic as agenticStatus, convertedStatus, isBegun, isDone, isReview, ordinary, taskStatusOf,
} from "@/utils/status-mapping";
import { openQuestion } from "@/utils/open-question";
import AnswerField from "@/components/AnswerField/AnswerField";
import { isOverdue } from "@/utils/overdue";
import { blockedByText } from "@/utils/blocked-by";

export interface TaskSaveData {
  title: string;
  /** In the model of the kind the form leaves the Task: the backend converts it when the same save
   * changes the flag, and refuses when there is no counterpart. */
  status: TaskStatus;
  blockReasons: string[];
  tagIds: number[];
  addedDeps: Dependency[];
  removedDeps: Dependency[];
  timeScope: TimeScope | null;
  onScopeExit: OnScopeExit | null;
  plan: TimeScope | null;
  /** The task's own explicit due, `null` for the default. Absent when the form has no Due field —
   * a Habit occurrence's or a wait's check task's — so the save says nothing about it. */
  dueScope?: TimeScope | null;
  /** `backlog` when deliberately set aside, `archived` when archived by hand. Never `backlog` while
   * `plan` is set — the form keeps the two exclusive, so the save never has to be refused for it —
   * and never both backlogged and archived: one value. */
  archival: TaskArchival;
  /** The task's own Agentic state. `"inherit"` is a real instruction — it clears a stored flag
   * and puts the task back to reading its ancestors — not an absent value. */
  agentic: TaskAgentic;
  /** Whether doing this task starts a wait. A plain boolean — the flag does not inherit, so
   * there is no third "unset" state for it to be in. */
  asynchronous: boolean;
  /** Whether the task **consists of its sub-items**: its status is then derived, and the save
   * leaves it alone. Only ever true for a stored task. */
  compound: boolean;
  /** The optional **Expectation template** — the wait finishing the task spawns. `null` when the
   * section is empty, and always `null` when the task is not asynchronous. */
  asyncTemplate: AsyncTemplate | null;
  /** The task's own **agentic brief**, `null` when the section is empty. Saved whatever the flag
   * says — the flag can be inherited and come back — and shown only while the task reads as
   * Agentic. */
  agenticBrief: AgenticBrief | null;
  /** The task's new delegate, present only when the form changed it — `null` takes it back. Absent
   * says nothing about delegation at all, so a save that never touched it cannot overwrite it. */
  delegate?: Delegate | null;
  isPrivate: boolean;
  /** The task's new done date (`YYYY-MM-DDTHH:MM:SS`, local), present only when the form changed
   * it on a task saved Done. Absent leaves the recorded one alone. */
  doneAt?: string;
}

/** The pills each model offers, in order. Review is never picked: it shows, disabled, while the
 * agent's question is open. */
const ORDINARY_PILLS: readonly TaskStatus[] = Object.values(TASK_STATUS).map(ordinary);
const AGENTIC_PILLS: readonly TaskStatus[] = [
  AGENTIC_STATUS.TODO, AGENTIC_STATUS.ON_AGENT, AGENTIC_STATUS.DOING, AGENTIC_STATUS.DONE,
].map(agenticStatus);

function sameStatus(a: TaskStatus | null, b: TaskStatus): boolean {
  return a !== null && a.kind === b.kind && a.status === b.status;
}

function depKey(dep: Dependency): string { return `${dep.type}-${dep.id}`; }
/** The stored archival a save writes: archived by hand wins, then backlogged, else live. The form
 * keeps the two switches exclusive, so the order only settles what cannot happen. */
function savedArchival(archivedByHand: boolean, backlogged: boolean): TaskArchival {
  if (archivedByHand) return TASK_ARCHIVAL.ARCHIVED;
  return backlogged ? TASK_ARCHIVAL.BACKLOG : TASK_ARCHIVAL.LIVE;
}

/** The edge type a dependency on `candidate` is stored under. */
function dependencyKindOf(candidate: MindmapNode): Dependency["type"] {
  if (candidate.kind === "goal") return "goal";
  if (candidate.kind === "expectation") return "expectation";
  return "task";
}
function depEquals(a: Dependency, b: Dependency): boolean { return a.type === b.type && a.id === b.id; }

interface Props {
  node: MindmapNode;
  allTags: Domain[];
  domainNames: Map<number, string>;
  availableForDep: MindmapNode[];
  onSave: (data: TaskSaveData) => Promise<void>;
  onCheckScopeClamp?: (nodeType: "task" | "goal", dbId: number, timeScope: TimeScope) => Promise<boolean>;
  /** Answers the agent's open question, from the agentic section: stores the answer and releases
   * the wait. Omitted, the question is not drawn there. */
  onAnswer?: ((question: MindmapNode, answer: string) => Promise<boolean>) | undefined;
  /** `Shift+W`: open with Asynchronous switched on and the Expectation section's title focused. */
  openAtTemplate?: boolean;
  onClose: () => void;
}

export default function TaskEditorModal({ node, allTags, domainNames, availableForDep, onSave, onCheckScopeClamp, onAnswer, openAtTemplate = false, onClose }: Props) {
  useInputCapture();
  const { t } = useTranslation(["editor", "status", "nodeKinds", "undo", "expectation"]);
  const [title, setTitle] = useState(node.rowTitle ?? node.title);
  const [status, setStatus] = useState<TaskStatus>(taskStatusOf(node));
  const [blockReasons, setBlockReasons] = useState<string[]>(node.blockReasons ?? []);
  const [tagIds, setTagIds] = useState<number[]>(node.tagIds);
  const [timeScope, setTimeScope] = useState<TimeScope | null>(node.timeScope ?? null);
  const [onScopeExit, setOnScopeExit] = useState<OnScopeExit | null>(node.onScopeExit ?? null);
  const [plan, setPlan] = useState<TimeScope | null>(node.plan ?? null);
  const [dueScope, setDueScope] = useState<TimeScope | null>(node.dueScope ?? null);
  const [isBacklogged, setIsBacklogged] = useState(node.backlogged === true);
  // The hand archive, offered on a stored task only (see `canArchiveByHand`).
  const takesArchive = canArchiveByHand(node);
  const [isArchivedByHand, setIsArchivedByHand] = useState(node.archivedByHand === true);
  const [agentic, setAgentic] = useState<TaskAgentic>(storedAgenticState(node.agentic));
  const [isAsynchronous, setIsAsynchronous] = useState(node.asynchronous === true || openAtTemplate);
  const [isCompound, setIsCompound] = useState(node.compound === true);
  const [asyncTemplate, setAsyncTemplate] = useState<AsyncTemplate>(node.asyncTemplate ?? EMPTY_ASYNC_TEMPLATE);
  const [agenticBrief, setAgenticBrief] = useState<AgenticBrief>(node.agenticBrief ?? EMPTY_AGENTIC_BRIEF);
  const templateRef = useRef<HTMLDivElement>(null);
  const [isPrivate, setIsPrivate] = useState(node.isPrivate ?? false);
  const [initialDeps, setInitialDeps] = useState<Dependency[]>([]);
  const [currentDeps, setCurrentDeps] = useState<Dependency[]>([]);
  const [depSearch, setDepSearch] = useState("");
  // The done date, as the Advanced field holds it, and as it was loaded — saved only when changed.
  const [doneAt, setDoneAt] = useState("");
  const [loadedDoneAt, setLoadedDoneAt] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const dbId = rowIdOf(node);

  // Where the editor opens: on the title, or — from `Shift+W` — on the Expectation section.
  useEffect(() => {
    if (openAtTemplate) {
      templateRef.current?.scrollIntoView?.({ block: "nearest" });
      templateRef.current?.querySelector("input")?.focus();
    } else {
      titleRef.current?.focus();
      titleRef.current?.select();
    }
  }, [openAtTemplate]);

  useEffect(() => {
    void listTaskDependencies(dbId).then((deps) => { setInitialDeps(deps); setCurrentDeps(deps); });
  }, [dbId]);

  // A wait's check task has no done date of its own: its completion is the check it records.
  const hasDoneDate = checkOrigin(node.origin) === undefined;
  // Done as the task was opened, in either model — what has a done date to show.
  const savedDone = isDone(taskStatusOf(node));
  useEffect(() => {
    if (!hasDoneDate || !savedDone) return;
    let cancelled = false;
    void fetchTaskDoneAt(dbId).then((at) => {
      if (cancelled) return;
      setDoneAt(toDoneDateInput(at));
      setLoadedDoneAt(toDoneDateInput(at));
    });
    return () => { cancelled = true; };
  }, [dbId, hasDoneDate, savedDone]);


  function removeDep(dep: Dependency) {
    setCurrentDeps((prev) => prev.filter((d) => !depEquals(d, dep)));
  }

  function addDep(candidate: MindmapNode) {
    const kind = dependencyKindOf(candidate);
    const id = rowIdOf(candidate);
    // A wait is always a stored row; a Task or a Goal may be a Habit occurrence.
    const dep: Dependency = kind === "expectation" ? { type: kind, id: storedId(id) } : { type: kind, id };
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
      // An occurrence's window is its iteration's and cannot change, so there is nothing to clamp.
      if (timeScope !== null && !isDerivedId(dbId) && onCheckScopeClamp && !(await onCheckScopeClamp("task", dbId, timeScope))) {
        setIsSaving(false);
        return;
      }
      // One Gesture, all or nothing: the update, the block reasons, the tags and the dependencies
      // are several commands but one thing the user filled in, so they are one
      // Ctrl+Z — and a refusal partway takes back the ones that landed rather than leaving a form
      // half-applied. The clamp prompt above is outside it, having written nothing yet.
      await withAtomicGesture(t("undo:gestures.editTask"), async () => {
        await onSave({
          title: title.trim(), status: shownStatus ?? status, blockReasons: blockReasons.map((r) => r.trim()).filter((r) => r !== ""),
          tagIds, addedDeps, removedDeps, timeScope,
          onScopeExit: timeScope !== null ? (onScopeExit ?? "keep") : null,
          plan,
          ...(hasDueField ? { dueScope } : {}),
          archival: savedArchival(isArchivedByHand, isBacklogged),
          agentic,
          asynchronous: isAsynchronous,
          compound: isCompound,
          // An empty section is no template; one with anything in it but a title takes the default.
          asyncTemplate: asyncTemplateToSave(
            asyncTemplate, isAsynchronous, t("expectation:templateDefaultTitle", { title: title.trim() }),
          ),
          agenticBrief: isEmptyBrief(agenticBrief) ? null : agenticBrief,
          isPrivate,
          ...(isDone(status) && doneAt !== "" && doneAt !== loadedDoneAt
            ? { doneAt: fromDoneDateInput(doneAt) } : {}),
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
    // Backlog and Archived are one stored value: setting one aside un-archives it, in front of
    // the user.
    if (next) setIsArchivedByHand(false);
  }

  function setArchivedAndClearBacklog(next: boolean) {
    setIsArchivedByHand(next);
    if (next) setIsBacklogged(false);
  }

  function setPlanAndClearBacklog(next: TimeScope | null) {
    setPlan(next);
    if (next !== null) setIsBacklogged(false);
  }

  // Starting a set-aside task — In Progress or Started — takes it out of the backlog — you cannot be doing something
  // you have put down — and the backend does exactly this to a bare status change. Here the switch
  // moves in front of the user instead, so the save is not the first they hear of it. Only this
  // direction: a task already in progress may still be set aside, and keeps its status when it is.
  function setStatusAndClearBacklog(next: TaskStatus) {
    setStatus(next);
    if (isBegun(next)) setIsBacklogged(false);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && event.target === titleRef.current) { event.preventDefault(); void handleSave(); }
    if (event.key === "Escape") onClose();
  }

  // The Due field. A check task's due is the day it fell due, so it has none. While the task has
  // its own window it shares the on-exit pills' row, held to that window; otherwise it is a row of
  // its own below the Plan — on an unscoped task, or on one that inherits its window, which derives
  // its due from it and so shows the row only to take back an explicit due already set. A Habit
  // occurrence always shows it: its default comes from its Habit's clock, and an explicit one set
  // here wins over it.
  const occurrence = isOccurrence(node);
  const inheritedScope = node.inheritedTimeScope ?? null;
  const hasDueField = checkOrigin(node.origin) === undefined
    && (occurrence || timeScope !== null || inheritedScope === null || dueScope !== null);
  const dueDefaultLabel = occurrence
    ? t("dueDefaultHabit")
    : timeScope !== null && (onScopeExit ?? "keep") === "keep" && !isBacklogged
      ? t("dueDefaultTimeScope")
      : t("dueDefaultNone");
  const dueField = (
    <div className={styles.label}>
      {t("fieldDue")}
      <DueField value={dueScope} bound={timeScope ?? inheritedScope} defaultLabel={dueDefaultLabel} onChange={setDueScope} />
    </div>
  );

  const readsAgentic = agentic === TASK_AGENTIC.YES || (agentic === TASK_AGENTIC.INHERIT && node.inheritedAgentic === true);
  // The status pills are the model the form leaves the Task in: the Agentic one while it reads as
  // Agentic. A flag flipped here shows the counterpart the save will convert to — none, when there
  // is none, and the save is then refused by name.
  const pills = readsAgentic ? AGENTIC_PILLS : ORDINARY_PILLS;
  const shownStatus = convertedStatus(status, readsAgentic);
  const question = readsAgentic && isReview(status) ? openQuestion(node) : undefined;

  const depSearchLower = depSearch.toLowerCase();
  const searchResults = depSearch.trim() === "" ? [] : availableForDep
    .filter((n) => n.kind === "task" || n.kind === "goal" || n.kind === "expectation")
    .filter((n) => n.title.toLowerCase().includes(depSearchLower))
    .filter((n) => {
      const id = rowIdOf(n);
      const type = dependencyKindOf(n);
      return !currentDeps.some((d) => d.type === type && d.id === id);
    })
    .slice(0, 8);

  function depTitle(dep: Dependency): string {
    return availableForDep.find((n) => n.id === entityNodeId(dep.type, dep.id))?.title ?? `${dep.type} #${dep.id}`;
  }

  // The blocks the *current* (editable) dependencies make, recomputed live so removing a dependency
  // drops its row. Whether a target is met is the backend's rule (the load's `met` fact); a target
  // not on the board is not known to be met.
  const virtualBlockers = currentDeps.flatMap((dep) => {
    const target = availableForDep.find((n) => n.id === entityNodeId(dep.type, dep.id));
    const label = blockedByText(dep.type, target?.shortId, dep.id, depTitle(dep));
    return target?.met === true ? [] : [label];
  });

  return (
    <EditorModal heading={t("editTask")} onClose={onClose} onKeyDown={handleKeyDown} isSaving={isSaving} onSave={() => void handleSave()} saveError={saveError}>
      <label className={styles.label}>
        {t("fieldTitle")}
        <input ref={titleRef} className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} type="text" />
      </label>
      <div className={styles.label}>
        {t("fieldStatus")}
        {/* A compound task's status is derived from its sub-items: the pills show it and take
            no clicks, and say why. Switching Compound off below frees them, starting from the
            status the task was showing. */}
        <div className={styles.statusPills}>
          {pills.map((s) => (
            <button key={s.status} type="button" disabled={isCompound} className={`${styles.statusPill}${sameStatus(shownStatus, s) ? ` ${styles.statusPillActive}` : ""}`} onClick={() => setStatusAndClearBacklog(s)}>
              {s.kind === "agentic" ? t(`status:agentic.${s.status}`) : t(`status:task.${s.status}`)}
            </button>
          ))}
          {shownStatus !== null && isReview(shownStatus) && (
            <button type="button" disabled className={`${styles.statusPill} ${styles.statusPillActive}`} title={t("statusReviewDerived")}>
              {t("status:agentic.review")}
            </button>
          )}
        </div>
        {isCompound && <span className={styles.fieldHint}>{t("statusFromSubItems")}</span>}
      </div>
      <div className={styles.label}>
        {t("fieldTimeScope")}
        <TimeScopeField
          value={timeScope}
          onChange={setTimeScope}
          {...(isOccurrence(node) ? { lockedReason: t("editor:scopeLockedOccurrence") } : {})}
          {...(checkOrigin(node.origin) !== undefined ? { lockedReason: t("editor:scopeLockedCheck") } : {})}
        />
      </div>
      {timeScope !== null && (
        <div className={styles.fieldPair}>
          <div className={styles.label}>
            {t("fieldOnScopeExit")}
            <OnScopeExitField value={onScopeExit} onChange={setOnScopeExit} />
          </div>
          {hasDueField && dueField}
        </div>
      )}
      <div className={styles.label}>
        {t("fieldPlan")}
        {/* An overdue task is past its due: its Plan may leave its window, as the backend allows. */}
        <PlanField
          value={plan}
          timeScope={isOverdue(node) && !isDone(status) ? null : timeScope}
          onChange={setPlanAndClearBacklog}
        />
      </div>
      {timeScope === null && hasDueField && dueField}
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
          question as whether it is set aside at all — and it is what the List View's "Asynchronous
          first" setting reads. While it is on, an Expectation section follows it: the template of the
          wait finishing the task spawns. Left empty, there is no template and nothing is spawned. */}
      <div className={styles.label}>
        {t("fieldAsynchronous")}
        <Switch
          checked={isAsynchronous}
          onChange={setIsAsynchronous}
          label={isAsynchronous ? t("asynchronousOn") : t("asynchronousOff")}
        />
      </div>
      {isAsynchronous && (
        <div ref={templateRef} role="group" aria-label={t("expectation:templateSection")}>
          <span className={styles.label}>{t("expectation:templateSection")}</span>
          <AsyncTemplateFields
            value={asyncTemplate}
            onChange={setAsyncTemplate}
            titlePlaceholder={t("expectation:templateDefaultTitle", { title: title.trim() })}
            allTags={allTags}
            domainNames={domainNames}
          />
        </div>
      )}
      {/* Compound, after Asynchronous and its wait: the status follows the sub-items. A stored
          task's flag, or a Habit occurrence's — a check task keeps a status of its own. */}
      {takesCompound(node) && (
        <div className={styles.label}>
          {t("fieldCompound")}
          <Switch
            checked={isCompound}
            onChange={setIsCompound}
            label={isCompound ? t("compoundOn") : t("compoundOff")}
          />
        </div>
      )}
      <BlockReasonsField
        reasons={blockReasons}
        onChange={setBlockReasons}
        virtualBlockers={virtualBlockers}
        capacityBlocked={node.capacityBlocked === true}
        compoundBlocked={node.compoundBlocked === true}
        coolingUntil={node.coolingUntil}
      />
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
      {/* In Advanced: the Agentic control, then — while the task reads as Agentic, its own flag or
          an inherited one — the agent's open question with its answer field, and the brief an
          agent reads about the work, collapsible on its own. Advanced opens by itself while any of
          it is engaged: an own flag, a question waiting, or a brief already written. */}
      <EditorAdvanced
        isPrivate={isPrivate}
        onPrivateChange={setIsPrivate}
        startOpen={isArchivedByHand || agentic !== TASK_AGENTIC.INHERIT || question !== undefined || (readsAgentic && !isEmptyBrief(agenticBrief))}
      >
        {takesArchive && <ArchivedField checked={isArchivedByHand} onChange={setArchivedAndClearBacklog} />}
        {/* Its short id — the one the MCP and a "Blocked by …" reason name it by — so the user can
            name the Task to an agent. A node the load gave no short id shows nothing. */}
        {node.shortId !== undefined && <ShortIdField shortId={node.shortId} />}
        {/* The done date: when a Done task was done, set back for work marked done late — an
            Interval's next window and a cooldown count from it. Left empty on a task marked Done
            in this save, it is the moment of saving. */}
        {hasDoneDate && isDone(status) && (
          <label className={styles.label} title={t("doneAtHint")}>
            {t("fieldDoneAt")}
            <input
              type="datetime-local"
              className={styles.input}
              value={doneAt}
              max={nowDoneDateInput()}
              onChange={(e) => setDoneAt(e.target.value)}
            />
          </label>
        )}
        <AgenticField
          value={agentic}
          inherited={node.inheritedAgentic === true}
          onChange={setAgentic}
        />
        {question !== undefined && onAnswer !== undefined && (
          <div role="group" aria-label={t("agenticQuestionSection")}>
            <AnswerField question={question} onSend={(answer) => onAnswer(question, answer)} />
          </div>
        )}
        {readsAgentic && (
          <div role="group" aria-label={t("agenticBriefSection")}>
            <AgenticBriefFields value={agenticBrief} onChange={setAgenticBrief} />
          </div>
        )}
      </EditorAdvanced>
    </EditorModal>
  );
}
