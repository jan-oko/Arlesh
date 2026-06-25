import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { NodeKind } from "@/utils/tree-layout";
import type { ContextMenuAction } from "./context-action";
import styles from "./NodeContextMenu.module.css";

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
  const { t } = useTranslation("contextMenu");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const canEnter = nodeKind !== "task" && nodeKind !== "goal" && nodeKind !== "tag";
  const canChangeType = nodeKind !== "aspect";

  function item(label: string, action: ContextMenuAction, disabled = false) {
    return (
      <button key={action} className={styles.item} disabled={disabled} onClick={() => { onAction(action); onClose(); }} type="button">
        {label}
      </button>
    );
  }

  return (
    <div ref={ref} className={styles.menu} style={{ left: x, top: y }}>
      {canEnter && item(t("enterSubtree"), "enter")}
      {item(t("rename"), "rename")}
      {canChangeType && item(t("typeNext"), "type-up")}
      {canChangeType && item(t("typePrev"), "type-down")}
      <div className={styles.separator} />
      {item(t("cut"), "cut")}
      {item(t("copy"), "copy")}
      {item(t("pasteAsChild"), "paste", !hasClipboard)}
      <div className={styles.separator} />
      {item(isCollapsed ? t("expand") : t("collapse"), isCollapsed ? "expand" : "collapse")}
      <div className={styles.separator} />
      {item(t("delete"), "delete")}
    </div>
  );
}
