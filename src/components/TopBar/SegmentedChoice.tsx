import styles from "./ScopeSelector.module.css";

interface Props<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}

/**
 * One named row of mutually exclusive choices, exactly one of them pressed.
 *
 * A row of `aria-pressed` buttons rather than a `<select>`: both the scope selector's choices are
 * two-valued, and a dropdown that has to be opened to learn which of two rules is active hides the
 * very thing the control exists to state.
 */
export default function SegmentedChoice<T extends string>({ label, value, options, onChange }: Props<T>) {
  return (
    <div className={styles.segmentRow} role="group" aria-label={label}>
      <span className={styles.segmentLabel}>{label}</span>
      <div className={styles.segments}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={styles.segment}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
