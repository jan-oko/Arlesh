import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useScopePicker } from "@/hooks/use-scope-picker";
import { useScopeLabels } from "@/hooks/use-scope-labels";
import { formatScopeAnchor } from "@/utils/scope-format";
import type { CanonicalKind } from "@/utils/scope-ref";
import ScopePicker from "./ScopePicker";
import styles from "./ScopeField.module.css";

interface Props {
  /** The fixed scope kind the anchor must be picked from (e.g. a flow's Duration kind). */
  kind: CanonicalKind;
  /** The anchor's current start date (ISO `YYYY-MM-DD`). */
  date: string;
  onChange: (date: string) => void;
}

/**
 * Edits a single absolute scope of a fixed kind (e.g. a Habit's Recurrence start/end, always a
 * scope of the flow's Duration kind) — a calendar cell, not an arbitrary date. Locked to `kind`:
 * the picker can't navigate to a coarser or finer view.
 */
export default function AnchorScopeField({ kind, date, onChange }: Props) {
  const { t } = useTranslation("editor");
  const [open, setOpen] = useState(false);
  const labels = useScopeLabels();
  const picker = useScopePicker("single");

  function apply() {
    const ref = picker.single;
    if (ref === null || ref.kind !== kind) return;
    onChange(ref.date);
    setOpen(false);
  }

  return (
    <div className={styles.field}>
      <div className={styles.summaryRow}>
        <span className={styles.summary}>{formatScopeAnchor(kind, date, labels)}</span>
        <button type="button" className={styles.button} onClick={() => setOpen((current) => !current)}>
          {open ? "close" : "edit"}
        </button>
      </div>
      {open && (
        <div className={styles.popover} role="group" aria-label="anchor scope picker">
          <ScopePicker picker={picker} initialKind={kind} lockKind />
          <button type="button" className={`${styles.button} ${styles.primary}`} onClick={apply}>
            {t("scopeApply")}
          </button>
        </div>
      )}
    </div>
  );
}
