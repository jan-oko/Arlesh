import { useEffect } from "react";
import type { Position } from "@/utils/tree-layout";
import styles from "./StatusToast.module.css";

interface Props {
  message: string;
  position: Position;
  onDismiss: () => void;
}

const NODE_HEIGHT = 36;
const AUTO_DISMISS_MS = 3000;

export default function StatusToast({ message, position, onDismiss }: Props) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      className={styles.toast}
      style={{ left: position.x, top: position.y + NODE_HEIGHT + 4 }}
    >
      {message}
    </div>
  );
}
