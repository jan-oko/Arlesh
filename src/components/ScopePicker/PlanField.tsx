import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { TimeScope } from "@/api/time-scope";
import type { PlanConflict } from "@/api/mindmap";
import { usePlanPicker } from "@/hooks/use-plan-picker";
import { useScopeLabels } from "@/hooks/use-scope-labels";
import { formatScopeRange } from "@/utils/scope-format";
import { useScopeRangeLabel } from "@/hooks/use-scope-range-label";
import ScopePicker from "./ScopePicker";
import styles from "./ScopeField.module.css";

/** The Plan a Task takes from above, and the node it comes from, named for the user. */
export interface InheritedPlan {
  /** The inherited Plan, clipped to the Task's window — absent when it came to nothing. */
  plan: TimeScope | null;
  /** The planned node it comes from: its short id, or its node id where it has none. */
  source: string;
}

interface Props {
  value: TimeScope | null;
  timeScope: TimeScope | null;
  /** The Plan it inherits, shown read-only while it has none of its own, and what an own Plan must
   * sit inside. */
  inherited?: InheritedPlan | null;
  /** The plan rule it breaks, flagged until it is next edited. */
  conflict?: PlanConflict | null;
  onChange: (plan: TimeScope | null) => void;
}

/**
 * Edits a Task Plan: a scheduling window (one click = a single scope, two = a range), its picker
 * constrained to the task's Time Scope (a Plan must fall within it) and to the Plan it inherits.
 * Renders like the Time Scope. With no Plan of its own it shows the inherited one read-only, with
 * its source's short id, and the same control sets an own Plan over it (`docs/spec/time-scopes.md`,
 * *Plan inheritance*). The picker's state is `usePlanPicker`'s, shared with the `P` quick picker.
 */
export default function PlanField({ value, timeScope, inherited = null, conflict = null, onChange }: Props) {
  const { t } = useTranslation("editor");
  const [open, setOpen] = useState(false);
  const labels = useScopeLabels();
  // An own Plan sits inside the one it inherits, which already sits inside its window.
  const bound = inherited?.plan ?? timeScope;
  const { picker, constraint, opening, endpoints } = usePlanPicker(value, bound, open);
  const inheritedLabel = useScopeRangeLabel(inherited?.plan);

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
  const ownSummary = value === null ? labels.unplanned : (rangeLabel ?? "…");
  // With no Plan of its own it reads the one it inherits, named by where it comes from.
  const summary = value === null && inherited?.plan != null
    ? t("planInheritedFrom", { plan: inheritedLabel ?? "…", source: inherited.source })
    : ownSummary;
  const flag = conflict === "parent_plan"
    ? t("planOutsideInherited", { plan: inheritedLabel ?? "…" })
    : conflict === "empty" && inherited !== null
      ? t("planEmptyInherited", { source: inherited.source })
      : null;

  return (
    <div className={styles.field}>
      <div className={styles.summaryRow}>
        <span className={value === null && inherited?.plan != null ? `${styles.summary} ${styles.inherited}` : styles.summary}>
          {summary}
        </span>
        <button type="button" className={styles.button} onClick={toggleOpen}>
          {open ? "close" : "edit plan"}
        </button>
        {value !== null && (
          <button type="button" className={styles.button} onClick={() => onChange(null)}>
            {t("scopeClear")}
          </button>
        )}
      </div>
      {flag !== null && <span className={styles.conflict} role="status">{flag}</span>}
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
