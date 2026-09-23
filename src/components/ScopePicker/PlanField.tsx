import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getScope, resolveScope } from "@/api/scopes";
import type { Scope } from "@/api/scopes";
import type { TimeScope } from "@/api/time-scope";
import { useScopePicker } from "@/hooks/use-scope-picker";
import { useScopeLabels } from "@/hooks/use-scope-labels";
import { dayScopeDate, lastDayOfWindow, openingForRefs } from "@/utils/scope-calendar";
import { refsForScopes } from "@/utils/scope-ref";
import { formatScopeRange } from "@/utils/scope-format";
import ScopePicker, { type ScopeConstraint } from "./ScopePicker";
import styles from "./ScopeField.module.css";

/**
 * The inclusive Day range a resolved window constrains the picker to. Both ends read as Day
 * scopes rather than calendar dates: a Day runs 02:00 -> 02:00, so a window starting at 00:30
 * starts in the previous Day, and one ending at 02:00 ends with the Day before it.
 */
function constraintDates(startIso: string, endIso: string): { startDate: string; endDate: string } {
  const [date, time] = startIso.split("T");
  const startDate =
    date === undefined || time === undefined ? startIso : dayScopeDate(date, Number(time.slice(0, 2)));
  return { startDate, endDate: lastDayOfWindow(endIso) };
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
        setConstraint(constraintDates(start.start, end.end));
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
    const plan = await picker.resolve();
    // An empty selection means the question went unanswered, not that there is no plan: Apply
    // only ever commits a selection, and Clear is the only way to remove one.
    if (plan !== null) onChange(plan);
    setOpen(false);
  }

  const planKey = value === null ? null : `${value.start_id}:${value.end_id}`;
  const endpoints = fetched !== null && fetched.key === planKey ? fetched.scopes : null;
  const rangeLabel = endpoints === null ? null : formatScopeRange(endpoints[0], endpoints[1], labels);
  // The cells the stored plan occupies drive both where the picker opens and what it has
  // selected, so the period on screen is the period Apply would re-apply.
  const valueRefs = useMemo(() => (endpoints === null ? [] : refsForScopes(endpoints)), [endpoints]);
  // Open on the plan already chosen; with none (or one that names no cell), open on Day.
  const opening = openingForRefs(valueRefs);
  const summary = value === null ? labels.unplanned : (rangeLabel ?? "…");

  const seed = picker.seed;
  useEffect(() => {
    if (!open) return;
    seed(valueRefs);
  }, [open, valueRefs, seed]);

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
