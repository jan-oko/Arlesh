import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { kindsBelow, cycleScopeCellCount } from "@/utils/flow-cycle";
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

/** The flow root's relative Cycle Plan: a plan kind plus a 1-based `[start, end]` offset range. */
export interface RootPlanValue { kind: string; start: number; end: number }

interface Props {
  /** The flow window (Span form). A null/Phase window has no relative plan grid. */
  flowScopeN: number | null;
  flowScopeKind: string | null;
  value: RootPlanValue | null;
  onChange: (value: RootPlanValue | null) => void;
}

/**
 * Edits the flow **root**'s relative Cycle Plan — a plan window inside the flow window, in relative
 * terms ("Day 3 of the flow window"). Shown only for a task-instance flow with a Span window (the
 * root's own scope is the window, so unlike a flow item there is no cycle-scope grid, only the plan).
 * The dropdown's "{kind} (instance scope)" option plans the root into the whole flow window.
 */
export default function RootPlanField({ flowScopeN, flowScopeKind, value, onChange }: Props) {
  const { t } = useTranslation("editor");
  const [planKind, setPlanKind] = useState<string>(value?.kind ?? "");
  const [start, setStart] = useState<number | null>(value?.start ?? null);
  const [end, setEnd] = useState<number | null>(value?.end ?? null);

  const planKinds = flowScopeKind !== null ? kindsBelow(flowScopeKind) : [];
  if (flowScopeN === null || flowScopeKind === null || planKinds.length === 0) {
    return <span className={styles.depKind}>{t("cycleWholeScope")}</span>;
  }
  const windowN = flowScopeN;
  const windowKind = flowScopeKind;
  // Planned into the whole flow window: the window's own kind, 1..n — the dropdown's
  // "{kind} (instance scope)" option.
  const whole = planKind === windowKind;
  const count = planKind !== "" && !whole ? cycleScopeCellCount(windowN, windowKind, planKind) : 0;

  function emit(kind: string, s: number | null, e: number | null) {
    onChange(kind !== "" && s !== null ? { kind, start: s, end: e ?? s } : null);
  }

  function changeKind(kind: string) {
    setPlanKind(kind);
    if (kind === windowKind) {
      setStart(1);
      setEnd(windowN);
      emit(kind, 1, windowN);
      return;
    }
    setStart(null);
    setEnd(null);
    emit(kind, null, null);
  }

  // Range select: from no/prior-range selection a click sets a single cell; a second click extends
  // to a range; re-clicking the single cell clears it.
  function clickCell(index: number) {
    if (start === null || start !== end) {
      setStart(index); setEnd(index); emit(planKind, index, index);
    } else if (index === start) {
      setStart(null); setEnd(null); emit(planKind, null, null);
    } else {
      const s = Math.min(start, index), e = Math.max(start, index);
      setStart(s); setEnd(e); emit(planKind, s, e);
    }
  }

  return (
    <div>
      <select
        aria-label={t("cyclePlanKind")}
        className={`${styles.control} ${styles.select}`}
        value={planKind}
        onChange={(e) => changeKind(e.target.value)}
      >
        <option value="">{t("cyclePlanNone")}</option>
        <option value={windowKind}>{t("cyclePlanInstanceScope", { kind: kindLabel(t, windowKind) })}</option>
        {planKinds.map((kind) => <option key={kind} value={kind}>{kindLabel(t, kind)}</option>)}
      </select>
      {planKind !== "" && !whole && (
        <div className={styles.statusPills}>
          {Array.from({ length: count }, (_, i) => i + 1).map((index) => {
            const active = start !== null && end !== null && index >= start && index <= end;
            return (
              <button
                key={index}
                type="button"
                aria-pressed={active}
                className={`${styles.statusPill}${active ? ` ${styles.statusPillActive}` : ""}`}
                onClick={() => clickCell(index)}
              >
                {`${kindLabel(t, planKind)} ${index}`}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
