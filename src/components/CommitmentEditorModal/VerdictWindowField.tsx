import { useTranslation } from "react-i18next";
import type { DurationSpec } from "@/api/time-scope";
import styles from "@/components/EditorModal/EditorModal.module.css";

/** The scope kinds a Verdict Window can be counted in. The four coarse Spans only: "two evenings
 * after" has no arithmetic, so the two sub-day kinds are not offered. */
const KINDS = [
  { value: "day", labelKey: "kindDay" },
  { value: "week", labelKey: "kindWeek" },
  { value: "month", labelKey: "kindMonth" },
  { value: "season", labelKey: "kindSeason" },
] as const;

interface Props {
  value: DurationSpec | null;
  onChange: (value: DurationSpec | null) => void;
}

/**
 * How long past the end of its window a Commitment stays answerable, as a count of any scope
 * kind — the same `(n, kind)` shape a Habit's Gap takes.
 *
 * The kind is deliberately **not** tied to the commitment's own window: a monthly commitment can
 * be answerable for two days, and a daily one for a week. Clearing the count returns the field to
 * inheriting the nearest commitment above it, which is not the same as never expiring.
 */
export default function VerdictWindowField({ value, onChange }: Props) {
  const { t } = useTranslation("editor");
  const kind = value?.kind ?? "day";

  function setCount(raw: string): void {
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n < 0) {
      onChange(null);
      return;
    }
    onChange({ n, kind });
  }

  return (
    <div>
      <div className={styles.statusPills}>
        <input
          className={styles.input}
          type="number"
          min={0}
          value={value?.n ?? ""}
          placeholder={t("verdictWindowNone")}
          aria-label={t("fieldVerdictWindow")}
          onChange={(e) => setCount(e.target.value)}
        />
        {KINDS.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={value === null}
            className={`${styles.statusPill}${kind === option.value ? ` ${styles.statusPillActive}` : ""}`}
            onClick={() => onChange(value === null ? null : { n: value.n, kind: option.value })}
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>
      <small>{t("verdictWindowHint")}</small>
    </div>
  );
}
