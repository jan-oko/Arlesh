import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getOrCreateScope, getScope } from "@/api/scopes";
import type { TimeScope } from "@/api/time-scope";
import { useScopePicker } from "@/hooks/use-scope-picker";
import { useScopeLabels } from "@/hooks/use-scope-labels";
import { addScopePeriods } from "@/utils/scope-calendar";
import { formatScopeRange } from "@/utils/scope-format";
import type { CanonicalKind } from "@/utils/scope-ref";
import ScopePicker from "./ScopePicker";
import styles from "./ScopeField.module.css";

const DURATION_KINDS: CanonicalKind[] = ["day", "week", "month", "season"];

/** The two ways to enter a Time Scope. */
type ScopeForm = "boundaries" | "duration";

function toCanonicalKind(value: string): CanonicalKind {
  return DURATION_KINDS.find((kind) => kind === value) ?? "week";
}

interface Props {
  value: TimeScope | null;
  onChange: (timeScope: TimeScope | null) => void;
}

/**
 * Edits a Task/Goal Time Scope: a **Boundaries** range (via the calendar picker) or a **Duration**
 * (anchor + N of a kind), snapshotted to a fixed window while persisting the duration parameters.
 */
export default function TimeScopeField({ value, onChange }: Props) {
  const { t } = useTranslation("editor");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ScopeForm>(value?.duration ? "duration" : "boundaries");
  const rangePicker = useScopePicker("range");
  const anchorPicker = useScopePicker("single");
  const [durationN, setDurationN] = useState<number>(value?.duration?.n ?? 1);
  const [durationKind, setDurationKind] = useState<CanonicalKind>(
    DURATION_KINDS.find((kind) => kind === value?.duration?.kind) ?? "week",
  );
  const labels = useScopeLabels();
  // The label(s) of a Boundaries/single value are fetched; Unscoped and duration are derived.
  const [rangeLabel, setRangeLabel] = useState<string | null>(null);
  useEffect(() => {
    if (value === null || value.duration) return;
    let active = true;
    void Promise.all([getScope(value.start_id), getScope(value.end_id)]).then(([start, end]) => {
      if (active && start != null && end != null) {
        setRangeLabel(formatScopeRange(start, end, labels));
      }
    });
    return () => {
      active = false;
    };
  }, [value, labels]);

  const summary =
    value === null
      ? labels.unscoped
      : value.duration
        ? labels.duration(value.duration.n, value.duration.kind)
        : (rangeLabel ?? "…");

  async function applyBoundaries() {
    const timeScope = await rangePicker.resolve();
    onChange(timeScope);
    setOpen(false);
  }

  async function applyDuration() {
    const anchor = anchorPicker.single;
    if (anchor === null || anchor.kind === "exact" || anchor.kind === "part_of_day") return;
    const endDate = addScopePeriods(durationKind, anchor.date, durationN - 1);
    const [start, end] = await Promise.all([
      getOrCreateScope(durationKind, anchor.date),
      getOrCreateScope(durationKind, endDate),
    ]);
    onChange({
      start_id: start.id,
      end_id: end.id,
      duration: { n: durationN, kind: durationKind },
    });
    setOpen(false);
  }

  return (
    <div className={styles.field}>
      <div className={styles.summaryRow}>
        <span className={styles.summary}>{summary}</span>
        <button type="button" className={styles.button} onClick={() => setOpen((current) => !current)}>
          {open ? "close" : "edit scope"}
        </button>
        {value !== null && (
          <button type="button" className={styles.button} onClick={() => onChange(null)}>
            {t("scopeClear")}
          </button>
        )}
      </div>
      {open && (
        <div className={styles.popover} role="group" aria-label="time scope picker">
          <div className={styles.formToggle}>
            <button
              type="button"
              className={styles.toggle}
              aria-pressed={form === "boundaries"}
              onClick={() => setForm("boundaries")}
            >
              {t("scopeBoundaries")}
            </button>
            <button
              type="button"
              className={styles.toggle}
              aria-pressed={form === "duration"}
              onClick={() => setForm("duration")}
            >
              {t("scopeDuration")}
            </button>
          </div>
          {form === "boundaries" ? (
            <>
              <ScopePicker picker={rangePicker} initialKind="month" />
              <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => void applyBoundaries()}>
                {t("scopeApply")}
              </button>
            </>
          ) : (
            <>
              <label className={styles.durationRow}>
                {t("scopeLength")}
                <input
                  type="number"
                  min={1}
                  className={`${styles.control} ${styles.numberInput}`}
                  value={durationN}
                  onChange={(event) => setDurationN(Math.max(1, Number(event.target.value)))}
                />
              </label>
              <select
                aria-label="duration kind"
                className={`${styles.control} ${styles.select}`}
                value={durationKind}
                onChange={(event) => setDurationKind(toCanonicalKind(event.target.value))}
              >
                {DURATION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
              <ScopePicker picker={anchorPicker} initialKind={durationKind} />
              <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => void applyDuration()}>
                {t("scopeApply")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
