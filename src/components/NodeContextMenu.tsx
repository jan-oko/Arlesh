import { useEffect, useRef } from "react";
import type { NodeKind } from "@/utils/tree-layout";
import styles from "./NodeContextMenu.module.css";

export type ContextMenuAction =
  | "enter"
  | "rename"
  | "type-up"
  | "type-down"
  | "cut"
  | "copy"
  | "paste"
  | "collapse"
  | "expand"
  | "delete";

interface Props {
  x: number;
  y: number;
  nodeKind: NodeKind;
  isCollapsed: boolean;
  hasClipboard: boolean;
  onAction: (action: ContextMenuAction) => void;
  onClose: () => void;
}

export default function NodeContextMenu({ x, y, nodeKind, isCollapsed, hasClipboard, onAction, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const canEnter = nodeKind !== "task" && nodeKind !== "goal" && nodeKind !== "tag";
  const canChangeType = nodeKind !== "aspect";

  function item(label: string, action: ContextMenuAction, disabled = false) {
    return (
      <button
        key={action}
        className={styles.item}
        disabled={disabled}
        onClick={() => { onAction(action); onClose(); }}
        type="button"
      >
        {label}
      </button>
    );
  }

  return (
    <div ref={ref} className={styles.menu} style={{ left: x, top: y }}>
      {canEnter && item("Enter subtree", "enter")}
      {item("Rename", "rename")}
      {canChangeType && item("Type →", "type-up")}
      {canChangeType && item("Type ←", "type-down")}
      <div className={styles.separator} />
      {item("Cut", "cut")}
      {item("Copy", "copy")}
      {item("Paste as child", "paste", !hasClipboard)}
      <div className={styles.separator} />
      {item(isCollapsed ? "Expand" : "Collapse", isCollapsed ? "expand" : "collapse")}
      <div className={styles.separator} />
      {item("Delete", "delete")}
    </div>
  );
}
