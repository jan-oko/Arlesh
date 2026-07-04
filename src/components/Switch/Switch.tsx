import styles from "./Switch.module.css";

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible text label rendered beside the switch (also its accessible name). */
  label: string;
}

/** A labelled on/off switch — a restyled checkbox used across the filter and editor modals. */
export default function Switch({ checked, onChange, label }: Props) {
  return (
    <label className={styles.row}>
      <input
        type="checkbox"
        className={styles.input}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
