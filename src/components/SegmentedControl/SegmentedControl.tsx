import styles from "./SegmentedControl.module.css";

interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  value: T;
  options: ReadonlyArray<Option<T>>;
  onChange: (value: T) => void;
  /** The group's accessible name. */
  ariaLabel: string;
}

/**
 * A row of large buttons of which exactly one is selected, filling the width it is given. Each is
 * at least 44 px tall, the size of a finger, and the selected one is filled. A radio group to
 * assistive technology: it is one choice among a few, always visible, never a menu to open.
 */
export default function SegmentedControl<T extends string>({ value, options, onChange, ariaLabel }: Props<T>) {
  return (
    <div className={styles.group} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={styles.segment}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
