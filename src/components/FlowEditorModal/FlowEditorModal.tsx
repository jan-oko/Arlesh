import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import type { InstanceType, ConsumptionKind, BlockingMode, CatchupPolicy } from "@/api/flows";
import { getFlowRecurrence } from "@/api/flows";
import { getScope } from "@/api/scopes";
import EditorModal from "@/components/EditorModal/EditorModal";
import RecurrenceField from "./RecurrenceField";
import { defaultRecurrence, type RecurrenceUi } from "./recurrence-ui";
import { useValidFlowTargets } from "@/hooks/use-valid-flow-targets";
import styles from "@/components/EditorModal/EditorModal.module.css";

/** Flow Window kinds: coarse Spans (a Duration length) plus sub-day Phases (part/exact). */
const FLOW_SCOPE_KINDS = ["day", "week", "month", "season", "part", "exact"] as const;
type FlowScopeKind = (typeof FLOW_SCOPE_KINDS)[number];

/** Part-of-day bands offered for a Phase-`part` window. */
const PART_BANDS = ["morning", "noon", "afternoon", "evening", "night", "premorning"] as const;

function isPhaseKind(kind: FlowScopeKind): boolean {
  return kind === "part" || kind === "exact";
}

const INSTANCE_TYPES: InstanceType[] = ["goal", "task"];

const NODE_KINDS: NodeKind[] = ["aspect", "project", "domain", "goal", "task", "tag", "info", "flow"];

function isNodeKind(value: string): value is NodeKind {
  return NODE_KINDS.some((kind) => kind === value);
}

/** A chosen Target Node, retaining its display title for the summary chip. */
interface TargetSelection {
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
  /** Absent = leave recurrence untouched; present (object or null) = set-or-clear it. */
  recurrence?: RecurrenceSave | null;
}

function toFlowScopeKind(value: string): FlowScopeKind {
  return FLOW_SCOPE_KINDS.find((kind) => kind === value) ?? "week";
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
  const match = candidates.find((c) => c.id === `${flow.targetType}-${flow.targetId}`);
  const kind = match?.kind ?? (isNodeKind(flow.targetType) ? flow.targetType : null);
  if (kind === null) return null;
  return { kind, id: flow.targetId, title: match?.title ?? `#${flow.targetId}` };
}

interface Props {
  node: MindmapNode;
  availableTargets: MindmapNode[];
  heading?: string;
  onSave: (data: FlowSaveData) => Promise<void>;
  onClose: () => void;
}

/**
 * Edits a Flow template: its title, Instance Type (goal|task), Duration-form flow scope,
 * and default Target Node. Flow items and their cycle scopes are edited separately (Phase 7.3).
 */
export default function FlowEditorModal({ node, availableTargets, heading, onSave, onClose }: Props) {
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
  const [target, setTarget] = useState<TargetSelection | null>(targetFromNode(node, availableTargets));
  const [targetSearch, setTargetSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Recurrence (Habit) is edit-only — it needs a persisted flow to key on.
  const flowId = parseInt(node.id.split("-").pop() ?? "", 10);
  const isEdit = flowId > 0;
  const [recurrence, setRecurrence] = useState<RecurrenceUi>(() => defaultRecurrence(todayIso()));

  // No anchor at template time → a coarse filter that hides targets too small to ever hold the flow.
  const validIds = useValidFlowTargets(availableTargets, scoped, durationN, durationKind, null);

  useEffect(() => { titleRef.current?.focus(); titleRef.current?.select(); }, []);

  // Prefill the Recurrence from the stored one (if this flow is already a Habit).
  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;
    void (async () => {
      const rec = await getFlowRecurrence(flowId);
      if (rec === null || cancelled) return;
      const startScope = await getScope(rec.start_scope_id);
      const endScope = rec.end_scope_id !== null ? await getScope(rec.end_scope_id) : null;
      if (cancelled) return;
      setRecurrence({
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
      });
    })();
    return () => { cancelled = true; };
  }, [isEdit, flowId]);

  function selectTarget(candidate: MindmapNode) {
    const id = parseInt(candidate.id.split("-").pop() ?? "0", 10);
    setTarget({ kind: candidate.kind, id, title: candidate.title });
    setTargetSearch("");
  }

  async function handleSave() {
    if (title.trim() === "") return;
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
        ...(isEdit && scoped ? { recurrence: recurrenceSave } : {}),
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

  const searchLower = targetSearch.trim().toLowerCase();
  const searchResults = searchLower === "" ? [] : availableTargets
    .filter((n) => n.kind !== "flow" && n.id !== node.id)
    .filter((n) => n.title.toLowerCase().includes(searchLower))
    .filter((n) => validIds === null || validIds.has(n.id))
    .filter((n) => !(target !== null && n.id === `${target.kind}-${target.id}`))
    .slice(0, 8);

  return (
    <EditorModal heading={heading ?? t("editFlow")} onClose={onClose} onKeyDown={handleKeyDown} isSaving={isSaving} onSave={() => void handleSave()} saveError={saveError}>
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
        <label className={styles.tagOption}>
          <input type="checkbox" checked={scoped} onChange={(e) => setScoped(e.target.checked)} />
          {t("flowScoped")}
        </label>
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
      {scoped && isEdit && (
        <div className={styles.label}>
          {t("fieldRecurrence")}
          <RecurrenceField value={recurrence} onChange={setRecurrence} />
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
      </div>
    </EditorModal>
  );
}
