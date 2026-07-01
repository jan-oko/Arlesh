import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { resolveScope } from "@/api/scopes";
import type { TimeScope } from "@/api/time-scope";
import { useScopePicker } from "@/hooks/use-scope-picker";
import ScopePicker, { type ScopeConstraint } from "./ScopePicker";
import styles from "./ScopeField.module.css";

/** Converts an exclusive end datetime to the inclusive last date it covers. */
function inclusiveEndDate(exclusiveEndIso: string): string {
  const end = new Date(`${exclusiveEndIso}Z`);
  end.setUTCMinutes(end.getUTCMinutes() - 1);
  return end.toISOString().slice(0, 10);
}

interface Props {
  value: number | null;
  timeScope: TimeScope | null;
  onChange: (planScopeId: number | null) => void;
}

/**
 * Edits a Task Plan: a single scope, its picker constrained to the task's Time Scope window (a
 * Plan must fall within it). With no Time Scope, the picker is unconstrained.
 */
export default function PlanField({ value, timeScope, onChange }: Props) {
  const { t } = useTranslation("editor");
  const [open, setOpen] = useState(false);
  const [constraint, setConstraint] = useState<ScopeConstraint | undefined>(undefined);
  const picker = useScopePicker("single");

  // Resolve the Time Scope window to a date constraint whenever the picker is open with a scope.
  useEffect(() => {
    if (!open || timeScope === null) return;
    let active = true;
    void Promise.all([
      resolveScope(timeScope.start_id),
      resolveScope(timeScope.end_id),
    ]).then(([start, end]) => {
      if (active) {
        setConstraint({ startDate: start.start.slice(0, 10), endDate: inclusiveEndDate(end.end) });
      }
    });
    return () => {
      active = false;
    };
  }, [open, timeScope]);

  function toggleOpen() {
    // Clear any stale constraint before (re)opening; the effect refetches when a scope is set.
    setConstraint(undefined);
    setOpen((current) => !current);
  }

  async function apply() {
    const resolved = await picker.resolve();
    onChange(resolved === null ? null : resolved.start_id);
    setOpen(false);
  }

  return (
    <div className={styles.field}>
      <div className={styles.summaryRow}>
        <span className={styles.summary}>{value === null ? "Unplanned" : "Planned"}</span>
        <button type="button" onClick={toggleOpen}>
          {open ? "close" : "edit plan"}
        </button>
        {value !== null && (
          <button type="button" onClick={() => onChange(null)}>
            {t("scopeClear")}
          </button>
        )}
      </div>
      {open && (
        <div className={styles.popover} role="group" aria-label="plan picker">
          <ScopePicker
            picker={picker}
            initialKind="day"
            {...(constraint ? { constraint } : {})}
          />
          <button type="button" onClick={() => void apply()}>
            {t("scopeApply")}
          </button>
        </div>
      )}
    </div>
  );
}
