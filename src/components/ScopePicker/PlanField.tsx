import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { TimeScope } from "@/api/time-scope";
import { usePlanPicker } from "@/hooks/use-plan-picker";
import { useScopeLabels } from "@/hooks/use-scope-labels";
import { formatScopeRange } from "@/utils/scope-format";
import ScopePicker from "./ScopePicker";
import styles from "./ScopeField.module.css";

interface Props {
  value: TimeScope | null;
  timeScope: TimeScope | null;
  onChange: (plan: TimeScope | null) => void;
}

/**
 * Edits a Task Plan: a scheduling window (one click = a single scope, two = a range), its picker
 * constrained to the task's Time Scope (a Plan must fall within it). Renders like the Time Scope.
 * The picker's state is `usePlanPicker`'s, shared with the `P` quick picker.
 */
export default function PlanField({ value, timeScope, onChange }: Props) {
  const { t } = useTranslation("editor");
  const [open, setOpen] = useState(false);
  const labels = useScopeLabels();
  const { picker, constraint, opening, endpoints } = usePlanPicker(value, timeScope, open);

  function toggleOpen() {
    setOpen((current) => !current);
  }

  async function apply() {
    const plan = await picker.resolve();
    // An empty selection means the question went unanswered, not that there is no plan: Apply
    // only ever commits a selection, and Clear is the only way to remove one.
    if (plan !== null) onChange(plan);
    setOpen(false);
  }

  const rangeLabel = endpoints === null ? null : formatScopeRange(endpoints[0], endpoints[1], labels);
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
            autoFocus
            onCommit={() => void apply()}
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
