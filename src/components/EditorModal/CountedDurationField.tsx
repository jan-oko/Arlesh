import { useTranslation } from "react-i18next";
import type { DurationSpec } from "@/api/time-scope";
import styles from "@/components/EditorModal/EditorModal.module.css";

/** The scope kinds a count can be taken in: the four coarse Spans. "Every two evenings" has no
 * arithmetic, so the two sub-day kinds are not offered. */
const KINDS = [
  { value: "day", labelKey: "kindDay" },
  { value: "week", labelKey: "kindWeek" },
  { value: "month", labelKey: "kindMonth" },
  { value: "season", labelKey: "kindSeason" },
] as const;

interface Props {
  value: DurationSpec | null;
  onChange: (value: DurationSpec | null) => void;
  /** The field's accessible name. */
  label: string;
  /** What an empty count means, shown in the empty input. */
  emptyLabel: string;
}

/**
 * A simple counted scope — N days, weeks, months or seasons — the shape a wait's Check every and an
 * Expectation template's Time Scope rule both take. An empty or zero count is no value at all.
 */
export default function CountedDurationField({ value, onChange, label, emptyLabel }: Props) {
  const { t } = useTranslation("editor");
  const kind = value?.kind ?? "day";

  function setCount(raw: string): void {
    const n = parseInt(raw, 10);
    onChange(Number.isNaN(n) || n < 1 ? null : { n, kind });
  }

  return (
    <div className={styles.statusPills}>
      <input
        className={styles.input}
        type="number"
        min={1}
        value={value?.n ?? ""}
        placeholder={emptyLabel}
        aria-label={label}
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
  );
}
