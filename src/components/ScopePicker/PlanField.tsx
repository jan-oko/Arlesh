import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getScope, resolveScope } from "@/api/scopes";
import type { Scope } from "@/api/scopes";
import type { TimeScope } from "@/api/time-scope";
import { useScopePicker } from "@/hooks/use-scope-picker";
import { useScopeLabels } from "@/hooks/use-scope-labels";
import { openingForScopes } from "@/utils/scope-calendar";
import { formatScopeRange } from "@/utils/scope-format";
import ScopePicker, { type ScopeConstraint } from "./ScopePicker";
import styles from "./ScopeField.module.css";

/** Converts an exclusive end datetime to the inclusive last date it covers. */
function inclusiveEndDate(exclusiveEndIso: string): string {
  const end = new Date(`${exclusiveEndIso}Z`);
  end.setUTCMinutes(end.getUTCMinutes() - 1);
  return end.toISOString().slice(0, 10);
}

interface Props {
  value: TimeScope | null;
  timeScope: TimeScope | null;
  onChange: (plan: TimeScope | null) => void;
}

/**
 * Edits a Task Plan: a scheduling window (one click = a single scope, two = a range), its picker
 * constrained to the task's Time Scope (a Plan must fall within it). Renders like the Time Scope.
 */
export default function PlanField({ value, timeScope, onChange }: Props) {
  const { t } = useTranslation("editor");
  const [open, setOpen] = useState(false);
  const [constraint, setConstraint] = useState<ScopeConstraint | undefined>(undefined);
  // The plan's endpoint scopes give both its label and the view the picker opens on. The fetch is
  // tagged with the endpoints it was made for, so a previous plan's scopes are never shown.
  const [fetched, setFetched] = useState<{ key: string; scopes: [Scope, Scope] } | null>(null);
  const labels = useScopeLabels();
  const picker = useScopePicker("range");

  useEffect(() => {
    if (!open || timeScope === null) return;
    let active = true;
    void Promise.all([
      resolveScope(timeScope.start_id),
      resolveScope(timeScope.end_id),
    ]).then(([start, end]) => {
      if (active && start != null && end != null) {
        setConstraint({ startDate: start.start.slice(0, 10), endDate: inclusiveEndDate(end.end) });
      }
    });
    return () => {
      active = false;
    };
  }, [open, timeScope]);

  useEffect(() => {
    if (value === null) return;
    let active = true;
    const key = `${value.start_id}:${value.end_id}`;
    void Promise.all([getScope(value.start_id), getScope(value.end_id)]).then(([start, end]) => {
      if (active && start != null && end != null) setFetched({ key, scopes: [start, end] });
    });
    return () => {
      active = false;
    };
  }, [value]);

  function toggleOpen() {
    setConstraint(undefined);
    setOpen((current) => !current);
  }

  async function apply() {
    onChange(await picker.resolve());
    setOpen(false);
  }

  const planKey = value === null ? null : `${value.start_id}:${value.end_id}`;
  const endpoints = fetched !== null && fetched.key === planKey ? fetched.scopes : null;
  const rangeLabel = endpoints === null ? null : formatScopeRange(endpoints[0], endpoints[1], labels);
  // Open on the plan already chosen; with none (or one that names no cell), open on Day.
  const opening = endpoints === null ? null : openingForScopes(endpoints);
  const summary = value === null ? labels.unplanned : (rangeLabel ?? "…");

  return (
    <div className={styles.field}>
      <div className={styles.summaryRow}>
        <span className={styles.summary}>{summary}</span>
        <button type="button" className={styles.button} onClick={toggleOpen}>
          {open ? "close" : "edit plan"}
        </button>
        {value !== null && (
          <button type="button" className={styles.button} onClick={() => onChange(null)}>
            {t("scopeClear")}
          </button>
        )}
      </div>
      {open && (
        <div className={styles.popover} role="group" aria-label="plan picker">
          {/* Keyed on the opening so a late-arriving scope re-opens the picker on it. */}
          <ScopePicker
            key={opening === null ? "default" : `${opening.kind}:${opening.anchor}`}
            picker={picker}
            initialKind={opening?.kind ?? "day"}
            {...(opening ? { initialAnchor: opening.anchor } : {})}
            {...(constraint ? { constraint } : {})}
          />
          <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => void apply()}>
            {t("scopeApply")}
          </button>
        </div>
      )}
    </div>
  );
}
