import type { ReactNode } from "react";
import styles from "./StatusStepButton.module.css";

interface Props {
  /** The control's accessible name, already translated. */
  label: string;
  /** Steps the node's status (or verdict, or release) — the same action as the cycle key. */
  onStep: () => void;
  children: ReactNode;
}

/**
 * A card's status glyph as a control (docs/spec/touch.md): a tap steps the status cycle and
 * nothing else. It marks itself `data-gesture-skip`, so the view's touch gestures leave it to the
 * click, and it stops that click and a second quick one from reaching the card, so the node is
 * neither selected nor opened. The hit area is a fingertip wide whatever the glyph's own size.
 */
export default function StatusStepButton({ label, onStep, children }: Props) {
  return (
    <button
      type="button"
      className={styles.button}
      data-gesture-skip=""
      aria-label={label}
      onClick={(event) => { event.stopPropagation(); onStep(); }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {children}
    </button>
  );
}
