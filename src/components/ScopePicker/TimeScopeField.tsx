import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getOrCreateScope, getScope } from "@/api/scopes";
import type { Scope } from "@/api/scopes";
import type { TimeScope } from "@/api/time-scope";
import { useScopePicker } from "@/hooks/use-scope-picker";
import { useScopeLabels } from "@/hooks/use-scope-labels";
import { addScopePeriods, openingForRefs } from "@/utils/scope-calendar";
import { formatScopeRange } from "@/utils/scope-format";
import { refsForScopes, type CanonicalKind } from "@/utils/scope-ref";
import ScopePicker from "./ScopePicker";
import styles from "./ScopeField.module.css";

const DURATION_KINDS: CanonicalKind[] = ["day", "week", "month", "season"];

/** The two ways to enter a Time Scope. */
export type ScopeForm = "boundaries" | "duration";

function toCanonicalKind(value: string): CanonicalKind {
  return DURATION_KINDS.find((kind) => kind === value) ?? "week";
}

interface Props {
  value: TimeScope | null;
  onChange: (timeScope: TimeScope | null) => void;
  /** The form an empty field opens in. A stored value always opens in the form it was set in. */
  defaultForm?: ScopeForm;
}

/**
 * Edits a Task/Goal Time Scope: a **Boundaries** range (via the calendar picker) or a **Duration**
 * (anchor + N of a kind), snapshotted to a fixed window while persisting the duration parameters.
 */
export default function TimeScopeField({ value, onChange, defaultForm = "boundaries" }: Props) {
  const { t } = useTranslation("editor");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ScopeForm>(
    value === null ? defaultForm : value.duration ? "duration" : "boundaries",
  );
  const rangePicker = useScopePicker("range");
  const anchorPicker = useScopePicker("single");
  const [durationN, setDurationN] = useState<number>(value?.duration?.n ?? 1);
  const [durationKind, setDurationKind] = useState<CanonicalKind>(
    DURATION_KINDS.find((kind) => kind === value?.duration?.kind) ?? "week",
  );
  const labels = useScopeLabels();
  // The endpoint scopes of a Boundaries/single value are fetched; they give both its label and the
  // view the picker opens on. Unscoped and duration values derive without a fetch. The fetch is
  // tagged with the endpoints it was made for, so a previous value's scopes are never shown.
  const [fetched, setFetched] = useState<{ key: string; scopes: [Scope, Scope] } | null>(null);
  const boundariesKey =
    value === null || value.duration ? null : `${value.start_id}:${value.end_id}`;
  useEffect(() => {
    if (value === null || value.duration) return;
    let active = true;
    const key = `${value.start_id}:${value.end_id}`;
    void Promise.all([getScope(value.start_id), getScope(value.end_id)]).then(([start, end]) => {
      if (active && start != null && end != null) setFetched({ key, scopes: [start, end] });
    });
    return () => {
      active = false;
    };
  }, [value]);

  const endpoints = fetched !== null && fetched.key === boundariesKey ? fetched.scopes : null;
  const rangeLabel = endpoints === null ? null : formatScopeRange(endpoints[0], endpoints[1], labels);
  // The cells the stored scope occupies drive both where the picker opens and what it has
  // selected, so the period on screen is the period Apply would re-apply.
  const valueRefs = useMemo(() => (endpoints === null ? [] : refsForScopes(endpoints)), [endpoints]);
  // Open on the scope already chosen; with none (or one that names no cell), open on Month.
  const opening = openingForRefs(valueRefs);

  const seed = rangePicker.seed;
  useEffect(() => {
    if (!open) return;
    seed(valueRefs);
  }, [open, valueRefs, seed]);

  const summary =
    value === null
      ? labels.unscoped
      : value.duration
        ? labels.duration(value.duration.n, value.duration.kind)
        : (rangeLabel ?? "…");

  async function applyBoundaries() {
    const timeScope = await rangePicker.resolve();
    // An empty selection means the question went unanswered, not that there is no scope: Apply
    // only ever commits a selection, and Clear is the only way to remove one.
    if (timeScope !== null) onChange(timeScope);
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
              {/* Keyed on the opening so a late-arriving scope re-opens the picker on it. */}
              <ScopePicker
                key={opening === null ? "default" : `${opening.kind}:${opening.anchor}`}
                picker={rangePicker}
                initialKind={opening?.kind ?? "month"}
                {...(opening ? { initialAnchor: opening.anchor } : {})}
              />
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
