import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { TimeScope } from "@/api/time-scope";
import { usePlanPicker } from "@/hooks/use-plan-picker";
import { useScopeLabels } from "@/hooks/use-scope-labels";
import { formatScopeRange } from "@/utils/scope-format";
import ScopePicker from "./ScopePicker";
import styles from "./ScopeField.module.css";

interface Props {
  /** The Task's own explicit due, or `null` when it takes the default. */
  value: TimeScope | null;
  /** The window the due must fall within — the Task's effective Time Scope — or `null` for none. */
  bound: TimeScope | null;
  /** What the summary reads while there is no explicit due: the default the Task falls back on. */
  defaultLabel: string;
  onChange: (due: TimeScope | null) => void;
}

/**
 * Edits a Task's **due**: the window whose end makes it Overdue (one click = a single scope, two =
 * a range), its picker held to the Task's effective Time Scope, since a due must fall within it. It
 * is a Plan-shaped value under the same bound, so it shares the Plan picker's state
 * (`usePlanPicker`). With no explicit due the summary names the default, and Clear goes back to it.
 */
export default function DueField({ value, bound, defaultLabel, onChange }: Props) {
  const { t } = useTranslation("editor");
  const [open, setOpen] = useState(false);
  const labels = useScopeLabels();
  const { picker, constraint, opening, endpoints } = usePlanPicker(value, bound, open);

  async function apply() {
    const due = await picker.resolve();
    // As for a Plan: Apply only ever commits a selection, and Clear is the only way back.
    if (due !== null) onChange(due);
    setOpen(false);
  }

  const rangeLabel = endpoints === null ? null : formatScopeRange(endpoints[0], endpoints[1], labels);
  const summary = value === null ? defaultLabel : (rangeLabel ?? "…");

  return (
    <div className={styles.field}>
      <div className={styles.summaryRow}>
        <span className={styles.summary}>{summary}</span>
        <button type="button" className={styles.button} onClick={() => setOpen((current) => !current)}>
          {open ? t("dueClose") : t("dueEdit")}
        </button>
        {value !== null && (
          <button type="button" className={styles.button} onClick={() => onChange(null)}>
            {t("scopeClear")}
          </button>
        )}
      </div>
      {open && (
        <div className={styles.popover} role="group" aria-label={t("duePicker")}>
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
