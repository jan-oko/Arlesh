import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { FlowCyclePair } from "@/utils/tree-layout";
import {
  kindsBelow, cyclePlanCellCount, cyclePairKey, cycleLevels, pathToIndex, indexToPath,
  type CycleScopeKind, type CycleLevel,
} from "@/utils/flow-cycle";
import styles from "@/components/EditorModal/EditorModal.module.css";

const PART_OF_DAY_BANDS = ["morning", "noon", "afternoon", "evening", "night", "premorning"] as const;

function kindLabel(t: TFunction<["editor", "scopes"]>, kind: string): string {
  switch (kind) {
    case "season": return t("editor:kindSeason");
    case "month": return t("editor:kindMonth");
    case "week": return t("editor:kindWeek");
    case "day": return t("editor:kindDay");
    case "part_of_day": return t("editor:kindPart");
    default: return kind;
  }
}

/** A navigation/leaf cell's label: the real band name for Part of Day, else "{Kind} {index}". */
function cellLabel(t: TFunction<["editor", "scopes"]>, kind: string, index: number): string {
  if (kind === "part_of_day") {
    const band = PART_OF_DAY_BANDS[index - 1];
    if (band !== undefined) return t(`scopes:part.${band}`);
  }
  return `${kindLabel(t, kind)} ${index}`;
}

/** Breadcrumb-style label for a full navigation path, coarsest first, skipping single-cell levels. */
function pathLabel(t: TFunction<["editor", "scopes"]>, levels: CycleLevel[], path: number[]): string {
  return levels
    .map((level, i) => (level.count > 1 ? cellLabel(t, level.kind, path[i]!) : null))
    .filter((label): label is string => label !== null)
    .join(" › ");
}

function pairLabel(t: TFunction<["editor", "scopes"]>, pair: FlowCyclePair, flowScopeN: number, flowScopeKind: string): string {
  const scope = pair.scopeKind === null || pair.scopeIndex === null
    ? t("editor:cycleWholeScope")
    : pathLabel(t, cycleLevels(flowScopeN, flowScopeKind, pair.scopeKind as CycleScopeKind), indexToPath(cycleLevels(flowScopeN, flowScopeKind, pair.scopeKind as CycleScopeKind), pair.scopeIndex));
  if (pair.planKind === null || pair.planStart === null) return scope;
  const range = pair.planEnd !== null && pair.planEnd !== pair.planStart ? `${pair.planStart}–${pair.planEnd}` : `${pair.planStart}`;
  return `${scope} · ${kindLabel(t, pair.planKind)} ${range}`;
}

/** The navigation path implied by a trivial (single-cell) root level, prepended to real choices. */
function displayPathOf(levels: CycleLevel[], path: number[]): number[] {
  return levels.length > 0 && levels[0]!.count === 1 ? [1, ...path] : path;
}

interface Props {
  flowScopeN: number | null;
  flowScopeKind: string | null;
  value: FlowCyclePair[];
  onChange: (pairs: FlowCyclePair[]) => void;
}

/**
 * Edits a flow item's relative (Cycle Scope, Cycle Plan) pairs: existing pairs list as rows: "Add
 * cycle" or a row's edit action opens a drill-down picker (mirrors the app's ScopePicker) that
 * navigates the flow window's nested periods one level at a time — clicking a cell at the chosen
 * Cycle Scope Kind toggles that occurrence on/off immediately. Available only for a scoped flow —
 * an Unscoped flow's items have no cycles.
 */
export default function FlowCycleField({ flowScopeN, flowScopeKind, value, onChange }: Props) {
  const { t } = useTranslation(["editor", "scopes"]);
  const scopeKinds = flowScopeKind !== null ? kindsBelow(flowScopeKind) : [];
  const [mode, setMode] = useState<"list" | "picker">(value.length === 0 ? "picker" : "list");
  const [targetKind, setTargetKind] = useState<CycleScopeKind | undefined>(scopeKinds[0]);
  const [path, setPath] = useState<number[]>([]);
  const [planKind, setPlanKind] = useState<string>("");
  const [planStart, setPlanStart] = useState<number | null>(null);
  const [planEnd, setPlanEnd] = useState<number | null>(null);

  if (flowScopeN === null || flowScopeKind === null || targetKind === undefined) {
    return <span className={styles.depKind}>{t("editor:cycleWholeScope")}</span>;
  }

  const levels = cycleLevels(flowScopeN, flowScopeKind, targetKind);
  const displayPath = displayPathOf(levels, path);
  const atLeaf = displayPath.length === levels.length - 1;
  const currentLevel = levels[displayPath.length]!;
  const planKinds = atLeaf ? kindsBelow(targetKind) : [];
  const planCount = atLeaf && planKind !== "" ? cyclePlanCellCount(targetKind, planKind) : 0;
  const isPicking = value.length === 0 || mode === "picker";

  function resetPlan() {
    setPlanKind("");
    setPlanStart(null);
    setPlanEnd(null);
  }

  function openAdd() {
    setTargetKind(scopeKinds[0]);
    setPath([]);
    resetPlan();
    setMode("picker");
  }

  function editPair(pair: FlowCyclePair) {
    if (pair.scopeKind === null || pair.scopeIndex === null) return;
    const kind = pair.scopeKind as CycleScopeKind;
    const kindLevels = cycleLevels(flowScopeN!, flowScopeKind!, kind);
    const fullPath = indexToPath(kindLevels, pair.scopeIndex);
    const trivialRoot = kindLevels.length > 0 && kindLevels[0]!.count === 1;
    setTargetKind(kind);
    setPath(fullPath.slice(trivialRoot ? 1 : 0, -1));
    setPlanKind(pair.planKind ?? "");
    setPlanStart(pair.planStart);
    setPlanEnd(pair.planEnd);
    setMode("picker");
  }

  function changeTargetKind(kind: CycleScopeKind) {
    setTargetKind(kind);
    setPath([]);
    resetPlan();
  }

  function descend(index: number) {
    setPath([...path, index]);
  }

  function goUp() {
    setPath(path.slice(0, -1));
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

  function toggleLeaf(index: number) {
    if (targetKind === undefined) return;
    const planFields = planKind !== "" && planStart !== null
      ? { planKind, planStart, planEnd: planEnd ?? planStart }
      : { planKind: null, planStart: null, planEnd: null };
    const pair: FlowCyclePair = { scopeKind: targetKind, scopeIndex: pathToIndex(levels, [...displayPath, index]), ...planFields };
    const key = cyclePairKey(pair);
    const exists = value.some((p) => cyclePairKey(p) === key);
    onChange(exists ? value.filter((p) => cyclePairKey(p) !== key) : [...value, pair]);
  }

  function addWhole() {
    const pair: FlowCyclePair = { scopeKind: null, scopeIndex: null, planKind: null, planStart: null, planEnd: null };
    if (!value.some((p) => cyclePairKey(p) === cyclePairKey(pair))) onChange([...value, pair]);
  }

  function removePair(pair: FlowCyclePair) {
    onChange(value.filter((p) => cyclePairKey(p) !== cyclePairKey(pair)));
  }

  return (
    <div>
      {!isPicking && value.length > 0 && (
        <div className={styles.depList}>
          {value.map((pair) => (
            <div key={cyclePairKey(pair)} className={styles.depItem}>
              <span>{pair.scopeKind === null ? t("editor:cycleWholeScope") : pairLabel(t, pair, flowScopeN, flowScopeKind)}</span>
              <span>
                {pair.scopeKind !== null && (
                  <button type="button" aria-label={t("editor:cycleEdit")} className={styles.depRemoveBtn} onClick={() => editPair(pair)}>✏</button>
                )}
                <button type="button" className={styles.depRemoveBtn} onClick={() => removePair(pair)}>×</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {!isPicking && (
        <div className={styles.statusPills}>
          <button type="button" className={styles.statusPill} onClick={openAdd}>{t("editor:cycleAdd")}</button>
          <button type="button" className={styles.statusPill} onClick={addWhole}>{t("editor:cycleAddWhole")}</button>
        </div>
      )}

      {isPicking && (
        <div>
          {scopeKinds.length > 1 && (
            <label className={styles.label}>
              {t("editor:cycleScopeKind")}
              <select className={`${styles.control} ${styles.select}`} value={targetKind} onChange={(e) => { const k = scopeKinds.find((sk) => sk === e.target.value); if (k !== undefined) changeTargetKind(k); }}>
                {scopeKinds.map((kind) => <option key={kind} value={kind}>{kindLabel(t, kind)}</option>)}
              </select>
            </label>
          )}

          {path.length > 0 && (
            <div className={styles.statusPills}>
              <button type="button" className={styles.statusPill} aria-label="up" onClick={goUp}>↑</button>
              <span className={styles.depKind}>{pathLabel(t, levels.slice(0, displayPath.length), displayPath)}</span>
            </div>
          )}

          <div className={styles.statusPills}>
            {Array.from({ length: currentLevel.count }, (_, i) => i + 1).map((index) => {
              if (!atLeaf) {
                return (
                  <button key={index} type="button" className={styles.statusPill} onClick={() => descend(index)}>
                    {cellLabel(t, currentLevel.kind, index)}
                  </button>
                );
              }
              const candidateIndex = pathToIndex(levels, [...displayPath, index]);
              const active = value.some((p) => p.scopeKind === targetKind && p.scopeIndex === candidateIndex);
              return (
                <button
                  key={index}
                  type="button"
                  aria-pressed={active}
                  className={`${styles.statusPill}${active ? ` ${styles.statusPillActive}` : ""}`}
                  onClick={() => toggleLeaf(index)}
                >
                  {cellLabel(t, currentLevel.kind, index)}
                </button>
              );
            })}
          </div>

          {atLeaf && planKinds.length > 0 && (
            <>
              <label className={styles.label}>
                {t("editor:cyclePlanKind")}
                <select className={`${styles.control} ${styles.select}`} value={planKind} onChange={(e) => { setPlanKind(e.target.value); setPlanStart(null); setPlanEnd(null); }}>
                  <option value="">{t("editor:cyclePlanNone")}</option>
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
                        {cellLabel(t, planKind, index)}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          <div className={styles.statusPills}>
            <button type="button" className={styles.statusPill} onClick={addWhole}>{t("editor:cycleAddWhole")}</button>
          </div>
          {value.length > 0 && (
            <div className={styles.actions}>
              <button type="button" className={styles.saveBtn} onClick={() => setMode("list")}>{t("editor:cycleDone")}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
