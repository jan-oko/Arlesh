import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { FlowCyclePair } from "@/utils/tree-layout";
import {
  kindsBelow, cycleScopeCellCount, cyclePlanCellCount, cyclePairKey, type CycleScopeKind,
} from "@/utils/flow-cycle";
import styles from "@/components/EditorModal/EditorModal.module.css";

function kindLabel(t: TFunction<"editor">, kind: string): string {
  switch (kind) {
    case "season": return t("kindSeason");
    case "month": return t("kindMonth");
    case "week": return t("kindWeek");
    case "day": return t("kindDay");
    case "part_of_day": return t("kindPart");
    default: return kind;
  }
}

function pairLabel(t: TFunction<"editor">, pair: FlowCyclePair): string {
  const scope = pair.scopeKind === null || pair.scopeIndex === null
    ? t("cycleWholeScope")
    : `${kindLabel(t, pair.scopeKind)} ${pair.scopeIndex}`;
  if (pair.planKind === null || pair.planStart === null) return scope;
  const range = pair.planEnd !== null && pair.planEnd !== pair.planStart ? `${pair.planStart}–${pair.planEnd}` : `${pair.planStart}`;
  return `${scope} · ${kindLabel(t, pair.planKind)} ${range}`;
}

interface Props {
  flowScopeN: number | null;
  flowScopeKind: string | null;
  value: FlowCyclePair[];
  onChange: (pairs: FlowCyclePair[]) => void;
}

/**
 * Edits a flow item's relative (Cycle Scope, Cycle Plan) pairs on a grid that mimics the Scope
 * Picker but speaks in relative terms ("Day 3 of the flow window"). Available only for a scoped
 * flow — an Unscoped flow's items have no cycles.
 */
export default function FlowCycleField({ flowScopeN, flowScopeKind, value, onChange }: Props) {
  const { t } = useTranslation("editor");
  const scopeKinds = flowScopeKind !== null ? kindsBelow(flowScopeKind) : [];
  const [scopeKind, setScopeKind] = useState<CycleScopeKind | undefined>(scopeKinds[0]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [planKind, setPlanKind] = useState<string>("");
  const [planStart, setPlanStart] = useState<number | null>(null);
  const [planEnd, setPlanEnd] = useState<number | null>(null);

  if (flowScopeN === null || flowScopeKind === null || scopeKind === undefined) {
    return <span className={styles.depKind}>{t("cycleWholeScope")}</span>;
  }

  const planKinds = kindsBelow(scopeKind);
  const scopeCount = cycleScopeCellCount(flowScopeN, flowScopeKind, scopeKind);
  const planCount = planKind !== "" ? cyclePlanCellCount(scopeKind, planKind) : 0;

  function changeScopeKind(kind: CycleScopeKind) {
    setScopeKind(kind);
    setSelected(new Set());
    setPlanKind("");
    setPlanStart(null);
    setPlanEnd(null);
  }

  function toggleScope(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  }

  function changePlanKind(kind: string) {
    setPlanKind(kind);
    setPlanStart(null);
    setPlanEnd(null);
  }

  // Range select: first click sets a single slot; a later click extends to a range; re-click resets.
  function clickPlan(index: number) {
    if (planStart === null || planStart !== planEnd) {
      setPlanStart(index);
      setPlanEnd(index);
    } else if (index === planStart) {
      setPlanStart(null);
      setPlanEnd(null);
    } else {
      setPlanStart(Math.min(planStart, index));
      setPlanEnd(Math.max(planStart, index));
    }
  }

  function addSelected() {
    if (scopeKind === undefined) return;
    const planFields = planKind !== "" && planStart !== null
      ? { planKind, planStart, planEnd: planEnd ?? planStart }
      : { planKind: null, planStart: null, planEnd: null };
    const next = [...value];
    for (const index of [...selected].sort((a, b) => a - b)) {
      const pair: FlowCyclePair = { scopeKind, scopeIndex: index, ...planFields };
      if (!next.some((p) => cyclePairKey(p) === cyclePairKey(pair))) next.push(pair);
    }
    void invoke("debug_log", {
      message: `[FlowCycleField.addSelected] scopeKind=${String(scopeKind)} selected=${JSON.stringify([...selected])} value=${JSON.stringify(value)} next=${JSON.stringify(next)}`,
    }).catch(() => {});
    onChange(next);
    setSelected(new Set());
  }

  function addWhole() {
    const pair: FlowCyclePair = { scopeKind: null, scopeIndex: null, planKind: null, planStart: null, planEnd: null };
    if (!value.some((p) => cyclePairKey(p) === cyclePairKey(pair))) onChange([...value, pair]);
  }

  function removePair(pair: FlowCyclePair) {
    onChange(value.filter((p) => cyclePairKey(p) !== cyclePairKey(pair)));
  }

  const addDisabled = selected.size === 0 || (planKind !== "" && planStart === null);

  return (
    <div>
      {value.length > 0 && (
        <div className={styles.depList}>
          {value.map((pair) => (
            <div key={cyclePairKey(pair)} className={styles.depItem}>
              <span>{pairLabel(t, pair)}</span>
              <button type="button" className={styles.depRemoveBtn} onClick={() => removePair(pair)}>×</button>
            </div>
          ))}
        </div>
      )}

      <label className={styles.label}>
        {t("cycleScopeKind")}
        <select className={`${styles.control} ${styles.select}`} value={scopeKind} onChange={(e) => { const k = scopeKinds.find((sk) => sk === e.target.value); if (k !== undefined) changeScopeKind(k); }}>
          {scopeKinds.map((kind) => <option key={kind} value={kind}>{kindLabel(t, kind)}</option>)}
        </select>
      </label>
      <div className={styles.statusPills}>
        {Array.from({ length: scopeCount }, (_, i) => i + 1).map((index) => (
          <button
            key={index}
            type="button"
            aria-pressed={selected.has(index)}
            className={`${styles.statusPill}${selected.has(index) ? ` ${styles.statusPillActive}` : ""}`}
            onClick={() => toggleScope(index)}
          >
            {`${kindLabel(t, scopeKind)} ${index}`}
          </button>
        ))}
      </div>

      {planKinds.length > 0 && (
        <>
          <label className={styles.label}>
            {t("cyclePlanKind")}
            <select className={`${styles.control} ${styles.select}`} value={planKind} onChange={(e) => changePlanKind(e.target.value)}>
              <option value="">{t("cyclePlanNone")}</option>
              {planKinds.map((kind) => <option key={kind} value={kind}>{kindLabel(t, kind)}</option>)}
            </select>
          </label>
          {planKind !== "" && (
            <div className={styles.statusPills}>
              {Array.from({ length: planCount }, (_, i) => i + 1).map((index) => {
                const active = planStart !== null && planEnd !== null && index >= planStart && index <= planEnd;
                return (
                  <button
                    key={index}
                    type="button"
                    aria-pressed={active}
                    className={`${styles.statusPill}${active ? ` ${styles.statusPillActive}` : ""}`}
                    onClick={() => clickPlan(index)}
                  >
                    {`${kindLabel(t, planKind)} ${index}`}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      <div className={styles.statusPills}>
        <button type="button" className={styles.statusPill} disabled={addDisabled} onClick={addSelected}>{t("cycleAdd")}</button>
        <button type="button" className={styles.statusPill} onClick={addWhole}>{t("cycleAddWhole")}</button>
      </div>
    </div>
  );
}
