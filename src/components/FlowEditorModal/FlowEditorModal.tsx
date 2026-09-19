import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { entityNodeId } from "@/utils/tree-layout";
import type { InstanceType, ConsumptionKind, BlockingMode, CatchupPolicy } from "@/api/flows";
import { getFlowRecurrence, habitCompletionCount } from "@/api/flows";
import type { DurationSpec } from "@/api/time-scope";
import VerdictWindowField from "@/components/CommitmentEditorModal/VerdictWindowField";
import { getScope } from "@/api/scopes";
import { getErrorMessage } from "@/api/errors";
import EditorModal from "@/components/EditorModal/EditorModal";
import EditorAdvanced from "@/components/EditorModal/EditorAdvanced";
import Switch from "@/components/Switch/Switch";
import RecurrenceField from "./RecurrenceField";
import { defaultRecurrence, type RecurrenceUi } from "./recurrence-ui";
import { useValidFlowTargets } from "@/hooks/use-valid-flow-targets";
import RootPlanField, { type RootPlanValue } from "./RootPlanField";
import { useInputCapture } from "@/hooks/use-input-capture";
import styles from "@/components/EditorModal/EditorModal.module.css";

/** Flow Window kinds: coarse Spans (a Duration length) plus sub-day Phases (part/exact). */
const FLOW_SCOPE_KINDS = ["day", "week", "month", "season", "part", "exact"] as const;
type FlowScopeKind = (typeof FLOW_SCOPE_KINDS)[number];

/** Part-of-day bands offered for a Phase-`part` window. */
const PART_BANDS = ["morning", "noon", "afternoon", "evening", "night", "premorning"] as const;

function isPhaseKind(kind: FlowScopeKind): boolean {
  return kind === "part" || kind === "exact";
}

/** What a Flow's root materialises as. **Commitment** is how a nightly rule recurs: through the
 * Habit machinery that already exists rather than a second recurrence engine. */
// In the same order the type cycle puts the three kinds in, Commitment last.
const INSTANCE_TYPES: InstanceType[] = ["goal", "task", "commitment"];

const NODE_KINDS: NodeKind[] = ["aspect", "project", "domain", "goal", "task", "tag", "info", "flow"];

function isNodeKind(value: string): value is NodeKind {
  return NODE_KINDS.some((kind) => kind === value);
}

/** A chosen Target Node, retaining its display title for the summary chip. */
export interface TargetSelection {
  kind: NodeKind;
  id: number;
  title: string;
}

/** Recurrence to persist alongside a flow save: an object sets/replaces it, `null` clears it. */
export interface RecurrenceSave {
  startDate: string;
  gapN: number | null;
  gapKind: string | null;
  endDate: string | null;
  consumptionKind: ConsumptionKind;
  blockingMode: BlockingMode | null;
  catchupPolicy: CatchupPolicy | null;
}

export interface FlowSaveData {
  title: string;
  instanceType: InstanceType;
  targetType: string | null;
  targetId: number | null;
  durationN: number | null;
  durationKind: string | null;
  windowPart: string | null;
  windowTimeStart: string | null;
  windowTimeEnd: string | null;
  /** Root Cycle Plan (task instance type only); all null when unplanned or a goal instance. */
  rootPlanKind: string | null;
  rootPlanStart: number | null;
  rootPlanEnd: number | null;
  /** The **Verdict Window** bounding this Habit's iterations (commitment instance type only); both
   * null leaves them answerable indefinitely, and a flow that is not a commitment one clears them
   * rather than keeping a window nothing would ever read. */
  verdictWindowN: number | null;
  verdictWindowKind: string | null;
  isPrivate: boolean;
  /** Absent = leave recurrence untouched; present (object or null) = set-or-clear it. */
  recurrence?: RecurrenceSave | null;
  /**
   * Edit-habit reconciliation choice, when a schedule change collides with completed iterations:
   * `"fork"` applies the edit to a clone (archiving the original), `"discard"` clears the
   * completions and regenerates. Absent = no divergence, save the edited flow directly.
   */
  reconcile?: "fork" | "discard";
}

function toFlowScopeKind(value: string): FlowScopeKind {
  return FLOW_SCOPE_KINDS.find((kind) => kind === value) ?? "week";
}

/** Flattens the root Cycle Plan into the `FlowSaveData` fields (all null when unplanned). */
function planFields(plan: RootPlanValue | null): Pick<FlowSaveData, "rootPlanKind" | "rootPlanStart" | "rootPlanEnd"> {
  return plan === null
    ? { rootPlanKind: null, rootPlanStart: null, rootPlanEnd: null }
    : { rootPlanKind: plan.kind, rootPlanStart: plan.start, rootPlanEnd: plan.end };
}

/** Flattens the Verdict Window into its `FlowSaveData` fields (both null when there is none). */
function verdictWindowFields(
  window: DurationSpec | null,
): Pick<FlowSaveData, "verdictWindowN" | "verdictWindowKind"> {
  return window === null
    ? { verdictWindowN: null, verdictWindowKind: null }
    : { verdictWindowN: window.n, verdictWindowKind: window.kind };
}

/** Local wall-clock today as `YYYY-MM-DD`, the default Recurrence start. */
function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function targetFromNode(node: MindmapNode, candidates: MindmapNode[]): TargetSelection | null {
  const flow = node.flow;
  if (flow === undefined || flow.targetType === null || flow.targetId === null) return null;
  // Normalize a domain-table target_type to the `domain-<id>` key the tree actually uses, so the
  // pre-selected target resolves to its real title instead of falling back to `#<id>`.
  const lookupId = entityNodeId(flow.targetType, flow.targetId);
  const match = candidates.find((c) => c.id === lookupId);
  const kind = match?.kind ?? (isNodeKind(flow.targetType) ? flow.targetType : null);
  if (kind === null) return null;
  return { kind, id: flow.targetId, title: match?.title ?? `#${flow.targetId}` };
}

interface Props {
  node: MindmapNode;
  availableTargets: MindmapNode[];
  /**
   * The flow's parent, shown as the Target Node's value while no explicit target is set — an empty
   * target means "follow my parent", not "no target", so the field reads that way.
   */
  inheritedTarget?: TargetSelection | null;
  heading?: string;
  onSave: (data: FlowSaveData) => Promise<void>;
  onClose: () => void;
}

/**
 * Edits a Flow template: its title, Instance Type (goal|task), Duration-form flow scope,
 * and Target Node. Flow items and their cycle scopes are edited separately (Phase 7.3).
 */
export default function FlowEditorModal({ node, availableTargets, inheritedTarget = null, heading, onSave, onClose }: Props) {
  useInputCapture();
  const { t } = useTranslation(["editor", "nodeKinds", "scopes"]);
  const [title, setTitle] = useState(node.title);
  const [instanceType, setInstanceType] = useState<InstanceType>(node.flow?.instanceType ?? "task");
  // A null flow scope means the flow's instances are Unscoped.
  const [scoped, setScoped] = useState<boolean>(node.flow?.durationN != null && node.flow.durationKind != null);
  const [durationN, setDurationN] = useState<number>(node.flow?.durationN ?? 1);
  const [durationKind, setDurationKind] = useState<FlowScopeKind>(toFlowScopeKind(node.flow?.durationKind ?? "week"));
  const [windowPart, setWindowPart] = useState<string>(node.flow?.windowPart ?? "evening");
  const [timeStart, setTimeStart] = useState<string>(node.flow?.windowTimeStart ?? "10:00");
  const [timeEnd, setTimeEnd] = useState<string>(node.flow?.windowTimeEnd ?? "12:00");
  const [rootPlan, setRootPlan] = useState<RootPlanValue | null>(
    node.flow?.rootPlanKind != null && node.flow.rootPlanStart != null && node.flow.rootPlanEnd != null
      ? { kind: node.flow.rootPlanKind, start: node.flow.rootPlanStart, end: node.flow.rootPlanEnd }
      : null,
  );
  const [verdictWindow, setVerdictWindow] = useState<DurationSpec | null>(
    node.flow?.verdictWindowN != null && node.flow.verdictWindowKind != null
      ? { n: node.flow.verdictWindowN, kind: node.flow.verdictWindowKind }
      : null,
  );
  const [target, setTarget] = useState<TargetSelection | null>(targetFromNode(node, availableTargets));
  const [isPrivate, setIsPrivate] = useState(node.isPrivate ?? false);
  const [targetSearch, setTargetSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Recurrence (Habit) is edit-only — it needs a persisted flow to key on.
  const flowId = parseInt(node.id.split("-").pop() ?? "", 10);
  const isEdit = flowId > 0;
  const [recurrence, setRecurrence] = useState<RecurrenceUi>(() => defaultRecurrence(todayIso()));
  // For edit-habit reconciliation: how many completed iterations exist, the schedule snapshot to
  // diff against, and whether the reconcile prompt is showing.
  const [completionCount, setCompletionCount] = useState(0);
  const loadedRecurrenceRef = useRef<RecurrenceUi | null>(null);
  const [reconcilePrompt, setReconcilePrompt] = useState(false);

  // No anchor at template time → a coarse filter that hides targets too small to ever hold the flow.
  const validIds = useValidFlowTargets(availableTargets, scoped, durationN, durationKind, null);

  useEffect(() => { titleRef.current?.focus(); titleRef.current?.select(); }, []);

  // Prefill the Recurrence from the stored one (if this flow is already a Habit).
  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;
    void (async () => {
      const rec = await getFlowRecurrence(flowId);
      if (cancelled) return;
      if (rec === null) {
        loadedRecurrenceRef.current = null;
        return;
      }
      const startScope = await getScope(rec.start_scope_id);
      const endScope = rec.end_scope_id !== null ? await getScope(rec.end_scope_id) : null;
      const count = await habitCompletionCount(flowId);
      if (cancelled) return;
      const loaded: RecurrenceUi = {
        isHabit: true,
        startDate: startScope.start_date,
        gapEnabled: rec.gap_n !== null,
        gapN: rec.gap_n ?? 1,
        gapKind: rec.gap_kind ?? "day",
        endEnabled: endScope !== null,
        endDate: endScope?.start_date ?? startScope.start_date,
        consumptionKind: rec.consumption_kind,
        blockingMode: rec.blocking_mode ?? "overlapping",
        catchupPolicy: rec.catchup_policy ?? "next",
      };
      loadedRecurrenceRef.current = loaded;
      setRecurrence(loaded);
      setCompletionCount(count);
    })();
    return () => { cancelled = true; };
  }, [isEdit, flowId]);

  function selectTarget(candidate: MindmapNode) {
    const id = parseInt(candidate.id.split("-").pop() ?? "0", 10);
    setTarget({ kind: candidate.kind, id, title: candidate.title });
    setTargetSearch("");
  }

  // True when the edit changes the flow window or the Repetition (start/gap/end) — the things that
  // alter which iteration scopes exist, and so would orphan completed iterations.
  function scheduleChanged(): boolean {
    const f = node.flow;
    const wasScoped = f?.durationKind != null;
    if (scoped !== wasScoped) return true;
    if (scoped && f !== undefined) {
      if (durationKind !== f.durationKind) return true;
      if (!isPhaseKind(durationKind) && durationN !== f.durationN) return true;
      if (durationKind === "part" && windowPart !== f.windowPart) return true;
      if (durationKind === "exact" && (timeStart !== f.windowTimeStart || timeEnd !== f.windowTimeEnd)) return true;
    }
    const loaded = loadedRecurrenceRef.current;
    if (loaded === null) return recurrence.isHabit; // becoming a habit for the first time
    if (recurrence.startDate !== loaded.startDate) return true;
    if (recurrence.gapEnabled !== loaded.gapEnabled) return true;
    if (recurrence.gapEnabled && (recurrence.gapN !== loaded.gapN || recurrence.gapKind !== loaded.gapKind)) return true;
    if (recurrence.endEnabled !== loaded.endEnabled) return true;
    return recurrence.endEnabled && recurrence.endDate !== loaded.endDate;
  }

  async function doSave(reconcile?: "fork" | "discard") {
    setIsSaving(true);
    setSaveError(null);
    try {
      const phase = isPhaseKind(durationKind);
      // Recurrence is set/cleared only for an already-persisted, scoped flow.
      const recurrenceSave: RecurrenceSave | null =
        recurrence.isHabit
          ? {
              startDate: recurrence.startDate,
              gapN: recurrence.gapEnabled ? recurrence.gapN : null,
              gapKind: recurrence.gapEnabled ? recurrence.gapKind : null,
              endDate: recurrence.endEnabled ? recurrence.endDate : null,
              consumptionKind: recurrence.consumptionKind,
              blockingMode: recurrence.consumptionKind === "accumulating" ? recurrence.blockingMode : null,
              catchupPolicy:
                recurrence.consumptionKind === "accumulating" && recurrence.blockingMode === "blocking"
                  ? recurrence.catchupPolicy
                  : null,
            }
          : null;
      await onSave({
        title: title.trim(),
        instanceType,
        targetType: target?.kind ?? null,
        targetId: target?.id ?? null,
        // A Phase window carries its band/time, not a length, so its N is fixed at 1.
        durationN: scoped ? (phase ? 1 : durationN) : null,
        durationKind: scoped ? durationKind : null,
        windowPart: scoped && durationKind === "part" ? windowPart : null,
        windowTimeStart: scoped && durationKind === "exact" ? timeStart : null,
        windowTimeEnd: scoped && durationKind === "exact" ? timeEnd : null,
        // The root Plan applies only to a task-instance flow with a Span window.
        ...planFields(instanceType === "task" && scoped && !phase ? rootPlan : null),
        // And the Verdict Window only to a commitment one: nothing else has a verdict to bound.
        ...verdictWindowFields(instanceType === "commitment" ? verdictWindow : null),
        isPrivate,
        ...(isEdit && scoped ? { recurrence: recurrenceSave } : {}),
        ...(reconcile !== undefined ? { reconcile } : {}),
      });
    } catch (err) {
      setSaveError(getErrorMessage(err));
      setIsSaving(false);
    }
  }

  async function handleSave() {
    if (title.trim() === "") return;
    // A schedule change that would orphan completed iterations must be reconciled first.
    if (isEdit && recurrence.isHabit && completionCount > 0 && scheduleChanged()) {
      setReconcilePrompt(true);
      return;
    }
    await doSave();
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && event.target === titleRef.current) { event.preventDefault(); void handleSave(); }
    if (event.key === "Escape") onClose();
  }

  const searchLower = targetSearch.trim().toLowerCase();
  const searchResults = searchLower === "" ? [] : availableTargets
    .filter((n) => n.kind !== "flow" && n.id !== node.id)
    .filter((n) => n.title.toLowerCase().includes(searchLower))
    .filter((n) => validIds === null || validIds.has(n.id))
    .filter((n) => !(target !== null && n.id === `${target.kind}-${target.id}`))
    .slice(0, 8);

  return (
    <EditorModal heading={heading ?? t("editFlow")} onClose={onClose} onKeyDown={handleKeyDown} isSaving={isSaving} onSave={() => void handleSave()} saveError={saveError}>
      {reconcilePrompt && (
        <div className={styles.label}>
          <span className={styles.depKind}>{t("reconcilePrompt", { count: completionCount })}</span>
          <div className={styles.statusPills}>
            <button type="button" className={styles.statusPill} onClick={() => { setReconcilePrompt(false); void doSave("fork"); }}>
              {t("reconcileFork")}
            </button>
            <button type="button" className={styles.statusPill} onClick={() => { setReconcilePrompt(false); void doSave("discard"); }}>
              {t("reconcileDiscard")}
            </button>
            <button type="button" className={styles.statusPill} onClick={() => setReconcilePrompt(false)}>
              {t("reconcileCancel")}
            </button>
          </div>
        </div>
      )}
      <label className={styles.label}>
        {t("fieldTitle")}
        <input ref={titleRef} className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} type="text" />
      </label>
      <div className={styles.label}>
        {t("fieldInstanceType")}
        <div className={styles.statusPills}>
          {INSTANCE_TYPES.map((it) => (
            <button key={it} type="button" className={`${styles.statusPill}${instanceType === it ? ` ${styles.statusPillActive}` : ""}`} onClick={() => setInstanceType(it)}>
              {t(`nodeKinds:${it}`)}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.label}>
        {t("fieldFlowScope")}
        <Switch checked={scoped} onChange={setScoped} label={t("flowScoped")} />
        {scoped ? (
          <div className={styles.durationRow}>
            <select
              aria-label={t("scopeDuration")}
              className={`${styles.control} ${styles.select}`}
              value={durationKind}
              onChange={(e) => setDurationKind(toFlowScopeKind(e.target.value))}
            >
              {FLOW_SCOPE_KINDS.map((kind) => (
                <option key={kind} value={kind}>{kind}</option>
              ))}
            </select>
            {durationKind === "part" ? (
              <select
                aria-label={t("fieldFlowScope")}
                className={`${styles.control} ${styles.select}`}
                value={windowPart}
                onChange={(e) => setWindowPart(e.target.value)}
              >
                {PART_BANDS.map((band) => (
                  <option key={band} value={band}>{band}</option>
                ))}
              </select>
            ) : durationKind === "exact" ? (
              <>
                <input
                  type="time"
                  aria-label={t("windowTimeStart")}
                  className={styles.control}
                  value={timeStart}
                  onChange={(e) => setTimeStart(e.target.value)}
                />
                <input
                  type="time"
                  aria-label={t("windowTimeEnd")}
                  className={styles.control}
                  value={timeEnd}
                  onChange={(e) => setTimeEnd(e.target.value)}
                />
              </>
            ) : (
              <input
                type="number"
                min={1}
                aria-label={t("fieldFlowScope")}
                className={`${styles.control} ${styles.numberInput}`}
                value={durationN}
                onChange={(e) => setDurationN(Math.max(1, Number(e.target.value)))}
              />
            )}
          </div>
        ) : (
          <span className={styles.depKind}>{t("scopes:unscoped")}</span>
        )}
      </div>
      {instanceType === "commitment" && (
        <div className={styles.label}>
          {t("fieldVerdictWindow")}
          <VerdictWindowField value={verdictWindow} onChange={setVerdictWindow} />
        </div>
      )}
      {instanceType === "task" && scoped && !isPhaseKind(durationKind) && (
        <div className={styles.label}>
          {t("fieldPlan")}
          <RootPlanField flowScopeN={durationN} flowScopeKind={durationKind} value={rootPlan} onChange={setRootPlan} />
        </div>
      )}
      {scoped && isEdit && (
        <div className={styles.label}>
          {t("fieldRecurrence")}
          <RecurrenceField value={recurrence} onChange={setRecurrence} durationKind={durationKind} />
        </div>
      )}
      <div className={styles.label}>
        {t("fieldTarget")}
        {target !== null && (
          <div className={styles.depList}>
            <div className={styles.depItem}>
              <span>{target.title}<span className={styles.depKind}>{t(`nodeKinds:${target.kind}`)}</span></span>
              <button type="button" className={styles.depRemoveBtn} onClick={() => setTarget(null)}>×</button>
            </div>
          </div>
        )}
        {target === null && inheritedTarget !== null && (
          <div className={styles.depList}>
            <div className={`${styles.depItem} ${styles.depItemInherited}`}>
              <span>{inheritedTarget.title}<span className={styles.depKind}>{t(`nodeKinds:${inheritedTarget.kind}`)}</span></span>
              <span className={styles.depKind}>{t("targetInherited")}</span>
            </div>
          </div>
        )}
        {target === null && (
          <div className={styles.depSearchWrap}>
            <input type="text" className={styles.depSearch} placeholder={t("placeholderTargetSearch")} value={targetSearch} onChange={(e) => setTargetSearch(e.target.value)} />
            {searchResults.length > 0 && (
              <div className={styles.depResults}>
                {searchResults.map((n) => (
                  <div key={n.id} className={styles.depResult} onMouseDown={(e) => { e.preventDefault(); selectTarget(n); }}>
                    <span>{n.title}</span>
                    <span className={styles.depKind}>{t(`nodeKinds:${n.kind}`)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <EditorAdvanced isPrivate={isPrivate} onPrivateChange={setIsPrivate} />
    </EditorModal>
  );
}
