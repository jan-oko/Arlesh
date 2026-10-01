import { useId } from "react";
import styles from "./HelpTip.module.css";

interface Props {
  /** The help itself, shown while the mark is hovered or focused. */
  text: string;
  /** The mark's accessible name, e.g. "Help: Agents are at capacity". */
  label: string;
}

/**
 * A small question mark beside a setting that shows its help on hover and on keyboard focus. The
 * help stays in the document as the mark's description (`aria-describedby`), so a screen reader
 * reads it either way; only its visibility follows the pointer and the focus.
 */
export default function HelpTip({ text, label }: Props) {
  const id = useId();
  return (
    <span className={styles.tip}>
      <button type="button" className={styles.mark} aria-label={label} aria-describedby={id}>
        ?
      </button>
      <span id={id} role="tooltip" className={styles.bubble}>{text}</span>
    </span>
  );
}
