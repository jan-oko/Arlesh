import { useEffect } from "react";
import { dismissDelay, TOAST_FADE_MS } from "@/utils/toast-timing";
import styles from "./StatusToast.module.css";

interface Props {
  message: string;
  onDismiss: () => void;
}

/**
 * A transient notice about the thing the user just acted on — a retype status remap, a refused
 * typed-child chord, a convert-to-flow error.
 *
 * It takes no position. It used to be placed at the anchor node's laid-out position, which is a
 * d3 *layout* coordinate (display root at the origin, half the tree negative) rendered outside the
 * canvas's pan/zoom transform, so the number never meant what the CSS read it as and long messages
 * ran off the left edge. Nothing near the node was worth that: the node the message is about is
 * the selected one, already on screen and already highlighted. See the stylesheet.
 */
export default function StatusToast({ message, onDismiss }: Props) {
  const delay = dismissDelay(message);

  useEffect(() => {
    const timer = setTimeout(onDismiss, delay);
    return () => clearTimeout(timer);
  }, [onDismiss, delay]);

  // The one inline style, and deliberately not a coordinate: the fade has to start when this
  // particular message has been read, or a longer toast would sit invisible until it unmounted.
  // It overrides only the delay of the stylesheet's `animation` shorthand.
  return (
    <div className={styles.toast} style={{ animationDelay: `${(delay - TOAST_FADE_MS) / 1000}s` }}>
      {message}
    </div>
  );
}
