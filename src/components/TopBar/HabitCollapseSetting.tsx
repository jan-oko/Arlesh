import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDisplayStore } from "@/stores/use-display-store";
import {
  MAX_HABIT_COLLAPSE_THRESHOLD,
  MIN_HABIT_COLLAPSE_THRESHOLD,
} from "@/utils/habit-collapse";
import styles from "./HabitCollapseSetting.module.css";

/**
 * How many consecutive passed iterations of a Habit the Mindmap draws before folding them into one
 * node. Applies to every Habit at once — it is a statement about how much history you want on
 * screen, not about any one of them.
 *
 * The typed text is kept locally while it is being edited so a half-typed value ("1" on the way to
 * "12") does not get clamped out from under the cursor; the store only ever sees a whole number in
 * range.
 */
export default function HabitCollapseSetting() {
  const { t } = useTranslation("habits");
  const threshold = useDisplayStore((s) => s.habitCollapseThreshold);
  const setThreshold = useDisplayStore((s) => s.setHabitCollapseThreshold);
  const [draft, setDraft] = useState<string | null>(null);
  const inputId = useId();

  function commit(text: string): void {
    setDraft(null);
    const value = Number.parseInt(text, 10);
    if (Number.isNaN(value)) return;
    setThreshold(value);
  }

  return (
    <div className={styles.row}>
      <label htmlFor={inputId}>{t("collapse.thresholdLabel")}</label>
      <span className={styles.field}>
        <input
          id={inputId}
          className={styles.input}
          type="number"
          inputMode="numeric"
          min={MIN_HABIT_COLLAPSE_THRESHOLD}
          max={MAX_HABIT_COLLAPSE_THRESHOLD}
          value={draft ?? String(threshold)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(e.currentTarget.value); }}
        />
        <span className={styles.unit}>{t("collapse.thresholdUnit")}</span>
      </span>
    </div>
  );
}
