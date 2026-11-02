import { useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { bubblePlacement } from "@/utils/bubble-placement";
import styles from "./HelpTip.module.css";

interface Props {
  /** The help itself, shown while the mark is hovered, focused or tapped. */
  text: string;
  /** The mark's accessible name, e.g. "Help: Agents are at capacity". */
  label: string;
}

/**
 * A small question mark beside a setting that shows its help on hover, on keyboard focus and on a
 * tap. The help stays in the document as the mark's description (`aria-describedby`), so a screen
 * reader reads it either way; only its visibility follows the pointer and the focus.
 *
 * The bubble is fixed to the viewport and placed by the room available, so a mark near either
 * edge, or near the bottom, never pushes it off the screen or widens the page.
 */
export default function HelpTip({ text, label }: Props) {
  const id = useId();
  const markRef = useRef<HTMLButtonElement>(null);
  const [shown, setShown] = useState(false);
  // A touch has no hover to show the bubble, so its tap toggles; a mouse already showed it on the
  // way in, and its click must not hide it again.
  const touched = useRef(false);
  const [placement, setPlacement] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    if (!shown || markRef.current === null) return;
    const rect = markRef.current.getBoundingClientRect();
    setPlacement(bubblePlacement(rect, { width: window.innerWidth, height: window.innerHeight }));
  }, [shown]);

  return (
    <span className={styles.tip} onMouseEnter={() => setShown(true)} onMouseLeave={() => setShown(false)}>
      <button
        ref={markRef}
        type="button"
        className={styles.mark}
        aria-label={label}
        aria-describedby={id}
        onFocus={() => setShown(true)}
        onBlur={() => setShown(false)}
        onTouchStart={() => { touched.current = true; }}
        onClick={() => {
          const byTouch = touched.current;
          touched.current = false;
          setShown((open) => (byTouch ? !open : true));
        }}
        onKeyDown={(e) => { if (e.key === "Escape") setShown(false); }}
      >
        ?
      </button>
      <span
        id={id}
        role="tooltip"
        className={`${styles.bubble} ${shown ? styles.shown : ""}`}
        style={placement}
      >
        {text}
      </span>
    </span>
  );
}
