import { useEffect } from "react";
import styles from "./StatusToast.module.css";

interface Props {
  message: string;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 3000;

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
  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return <div className={styles.toast}>{message}</div>;
}
