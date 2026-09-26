import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { ScopeKey } from "@/api/scopes";
import { useScopePicker } from "@/hooks/use-scope-picker";
import { useScopeLabels } from "@/hooks/use-scope-labels";
import { formatScopeAnchor } from "@/utils/scope-format";
import { keyForRef } from "@/utils/scope-key";
import ScopePicker from "./ScopePicker";
import styles from "./PlanScopeField.module.css";

interface Props {
  /** The scope chosen, or `null` for none. */
  value: ScopeKey | null;
  onChange: (scope: ScopeKey | null) => void;
  /** Hover text for the trigger: what the scope does to the board. */
  hint: string;
}

/**
 * Picks the one scope the Plan preset narrows the board to — any calendar cell, any kind — with the
 * app's own Scope Picker, or clears it. Drawn in the top bar beside the preset it belongs to, so the
 * picker floats below it rather than pushing the bar open. The key is the cell's own value (ADR 0009), so nothing is
 * read back to name it.
 */
export default function PlanScopeField({ value, onChange, hint }: Props) {
  const { t } = useTranslation(["filter", "scopes"]);
  const [open, setOpen] = useState(false);
  const labels = useScopeLabels();
  const picker = useScopePicker("single");

  function label(key: ScopeKey): string {
    switch (key.kind) {
      case "exact": return `${key.start} – ${key.end}`;
      case "part_of_day": return `${formatScopeAnchor("day", key.date, labels)} ${t(`scopes:part.${key.part}`)}`;
      default: return formatScopeAnchor(key.kind, key.date, labels);
    }
  }

  function apply() {
    const ref = picker.single;
    if (ref !== null) onChange(keyForRef(ref));
    setOpen(false);
  }

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("filter:planScopeLabel")}
        title={hint}
        onClick={() => setOpen((current) => !current)}
      >
        {value === null ? <span className={styles.unset}>{t("filter:planScopeAny")}</span> : label(value)}
      </button>
      {value !== null && (
        <button type="button" className={styles.clear} onClick={() => onChange(null)}>
          {t("filter:planScopeClear")}
        </button>
      )}
      {open && (
        <>
          <div className={styles.backdrop} onClick={() => setOpen(false)} />
          <div className={styles.popover} role="group" aria-label={t("filter:planScopePicker")}>
            <ScopePicker picker={picker} initialKind={value?.kind === "exact" || value === null ? "week" : value.kind} />
            <button type="button" className={styles.apply} onClick={apply}>
              {t("filter:planScopeApply")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
