import styles from "./Switch.module.css";

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible text label rendered beside the switch (also its accessible name). */
  label: string;
  /** Greys the switch out and refuses the click, for a question that does not apply here. */
  disabled?: boolean;
  /** Why it is disabled, on hover. Ignored while the switch is live. */
  title?: string;
}

/** A labelled on/off switch — a restyled checkbox used across the filter and editor modals. */
export default function Switch({ checked, onChange, label, disabled = false, title }: Props) {
  return (
    <label className={`${styles.row}${disabled ? ` ${styles.disabled}` : ""}`} title={title}>
      <input
        type="checkbox"
        className={styles.input}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
