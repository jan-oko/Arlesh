import { useState } from "react";

import { getOrCreateScope } from "@/api/scopes";
import type { TimeScope } from "@/api/time-scope";
import { useScopePicker } from "@/hooks/use-scope-picker";
import { addScopePeriods } from "@/utils/scope-calendar";
import type { CanonicalKind } from "@/utils/scope-ref";
import ScopePicker from "./ScopePicker";
import styles from "./ScopeField.module.css";

const DURATION_KINDS: CanonicalKind[] = ["day", "week", "month", "season"];

/** The two ways to enter a Time Scope. */
type ScopeForm = "boundaries" | "duration";

function toCanonicalKind(value: string): CanonicalKind {
  return DURATION_KINDS.find((kind) => kind === value) ?? "week";
}

function summarize(value: TimeScope | null): string {
  if (value === null) return "Unscoped";
  if (value.duration) return `${value.duration.n} ${value.duration.kind}`;
  return "Custom range";
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
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ScopeForm>(value?.duration ? "duration" : "boundaries");
  const rangePicker = useScopePicker("range");
  const anchorPicker = useScopePicker("single");
  const [durationN, setDurationN] = useState<number>(value?.duration?.n ?? 1);
  const [durationKind, setDurationKind] = useState<CanonicalKind>(
    DURATION_KINDS.find((kind) => kind === value?.duration?.kind) ?? "week",
  );

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
        <span className={styles.summary}>{summarize(value)}</span>
        <button type="button" onClick={() => setOpen((current) => !current)}>
          {open ? "close" : "edit scope"}
        </button>
        {value !== null && (
          <button type="button" onClick={() => onChange(null)}>
            clear
          </button>
        )}
      </div>
      {open && (
        <div className={styles.popover} role="group" aria-label="time scope picker">
          <div className={styles.formToggle}>
            <button
              type="button"
              aria-pressed={form === "boundaries"}
              onClick={() => setForm("boundaries")}
            >
              boundaries
            </button>
            <button
              type="button"
              aria-pressed={form === "duration"}
              onClick={() => setForm("duration")}
            >
              duration
            </button>
          </div>
          {form === "boundaries" ? (
            <>
              <ScopePicker picker={rangePicker} initialKind="month" />
              <button type="button" onClick={() => void applyBoundaries()}>
                apply
              </button>
            </>
          ) : (
            <>
              <label className={styles.durationRow}>
                length
                <input
                  type="number"
                  min={1}
                  value={durationN}
                  onChange={(event) => setDurationN(Math.max(1, Number(event.target.value)))}
                />
              </label>
              <select
                aria-label="duration kind"
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
              <button type="button" onClick={() => void applyDuration()}>
                apply
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
