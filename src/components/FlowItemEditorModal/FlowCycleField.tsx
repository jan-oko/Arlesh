import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { FlowCyclePair } from "@/utils/tree-layout";
import {
  kindsBelow, cyclePairKey, cycleLevels, pathToIndex, indexToPath,
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
  // A Cycle Plan of the scope's own kind is the scope itself: the row's pressed "Planned" says so.
  if (pair.planKind === pair.scopeKind) return scope;
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
 * Edits a flow item's relative (Cycle Scope, Cycle Plan) pairs. Existing pairs show as a compact
 * chip list; a single edit/confirm toggle (pencil ↔ checkmark) switches to a drill-down picker
 * (mirrors the app's ScopePicker) that navigates the flow window's nested periods one level at a
 * time — clicking a cell at the chosen Cycle Scope Kind toggles that occurrence on/off immediately.
 * Each pair's row carries a **Planned** toggle: on, its Cycle Plan is its own Cycle Scope. A finer
 * plan an older pair carries is shown read-only on its row, and the toggle clears it.
 * Available only for a scoped flow — an Unscoped flow's items have no cycles.
 */
export default function FlowCycleField({ flowScopeN, flowScopeKind, value, onChange }: Props) {
  const { t } = useTranslation(["editor", "scopes"]);
  const scopeKinds = flowScopeKind !== null ? kindsBelow(flowScopeKind) : [];
  const [mode, setMode] = useState<"list" | "picker">(value.length === 0 ? "picker" : "list");
  const [targetKind, setTargetKind] = useState<CycleScopeKind | undefined>(scopeKinds[0]);
  const [path, setPath] = useState<number[]>([]);

  if (flowScopeN === null || flowScopeKind === null || targetKind === undefined) {
    return <span className={styles.depKind}>{t("editor:cycleWholeScope")}</span>;
  }

  const levels = cycleLevels(flowScopeN, flowScopeKind, targetKind);
  const displayPath = displayPathOf(levels, path);
  const atLeaf = displayPath.length === levels.length - 1;
  const currentLevel = levels[displayPath.length]!;
  const isPicking = mode === "picker";

  function toggleMode() {
    if (isPicking) {
      setMode("list");
      return;
    }
    setPath([]);
    setMode("picker");
  }

  function changeTargetKind(kind: CycleScopeKind) {
    setTargetKind(kind);
    setPath([]);
  }

  function descend(index: number) {
    setPath([...path, index]);
  }

  function goUp() {
    setPath(path.slice(0, -1));
  }

  // The picker chooses Cycle Scopes only: a cell toggles its occurrence on or off. Whether a pair
  // is planned is its row's own toggle.
  function toggleLeaf(index: number) {
    if (targetKind === undefined) return;
    const scopeIndex = pathToIndex(levels, [...displayPath, index]);
    const sameScope = (p: FlowCyclePair) => p.scopeKind === targetKind && p.scopeIndex === scopeIndex;
    if (value.some(sameScope)) {
      onChange(value.filter((p) => !sameScope(p)));
      return;
    }
    onChange([...value, { scopeKind: targetKind, scopeIndex, planKind: null, planStart: null, planEnd: null }]);
  }

  // On: the pair's Cycle Plan is its own Cycle Scope — for a whole-scope pair, the whole flow
  // window (its own kind, 1..n). Off: no Cycle Plan, which also clears a finer plan an older pair
  // may still carry.
  function togglePlanned(pair: FlowCyclePair, windowN: number, windowKind: string) {
    const key = cyclePairKey(pair);
    const whole = pair.scopeKind === null;
    const planned: FlowCyclePair = pair.planKind === null
      ? { ...pair, planKind: whole ? windowKind : pair.scopeKind, planStart: 1, planEnd: whole ? windowN : 1 }
      : { ...pair, planKind: null, planStart: null, planEnd: null };
    onChange(value.map((p) => (cyclePairKey(p) === key ? planned : p)));
  }

  function addWhole() {
    const pair: FlowCyclePair = { scopeKind: null, scopeIndex: null, planKind: null, planStart: null, planEnd: null };
    // One whole-scope pair at most, planned or not.
    if (!value.some((p) => p.scopeKind === null)) onChange([...value, pair]);
  }

  function removePair(pair: FlowCyclePair) {
    onChange(value.filter((p) => cyclePairKey(p) !== cyclePairKey(pair)));
  }

  return (
    <div>
      <div className={styles.tagPills}>
        {!isPicking && value.map((pair) => (
          <span key={cyclePairKey(pair)} className={styles.tagPill}>
            {pair.scopeKind === null ? t("editor:cycleWholeScope") : pairLabel(t, pair, flowScopeN, flowScopeKind)}
            <button
              type="button"
              aria-pressed={pair.planKind !== null}
              className={`${styles.statusPill}${pair.planKind !== null ? ` ${styles.statusPillActive}` : ""}`}
              onClick={() => togglePlanned(pair, flowScopeN, flowScopeKind)}
            >
              {t("editor:cyclePlanned")}
            </button>
            <button type="button" className={styles.tagPillRemove} onClick={() => removePair(pair)}>×</button>
          </span>
        ))}
        <button
          type="button"
          aria-label={isPicking ? t("editor:cycleDone") : t("editor:cycleEdit")}
          className={styles.depRemoveBtn}
          onClick={toggleMode}
        >
          {isPicking ? "✔" : "✏"}
        </button>
      </div>

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

          <div className={styles.statusPills}>
            <button type="button" className={styles.statusPill} onClick={addWhole}>{t("editor:cycleAddWhole")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
