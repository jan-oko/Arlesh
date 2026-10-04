import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { NodeKind } from "@/utils/tree-layout";
import type { ArchiveOffer } from "@/utils/hand-archive";
import { canConvertNodeToFlow } from "@/utils/mindmap-tree";
import type { ContextMenuAction } from "./context-action";
import styles from "./NodeContextMenu.module.css";

interface Props {
  x: number;
  y: number;
  nodeKind: NodeKind;
  /** Kind of this node's parent (null at the root) — decides whether a flow can be placed here. */
  parentKind?: NodeKind | null;
  isCollapsed: boolean;
  hasClipboard: boolean;
  /** The hand archive's item, or `null` to offer none. */
  archive?: ArchiveOffer;
  onAction: (action: ContextMenuAction) => void;
  onClose: () => void;
}

export default function NodeContextMenu({ x, y, nodeKind, parentKind = null, isCollapsed, hasClipboard, archive = null, onAction, onClose }: Props) {
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
  // A Flow templates a Goal/Task subtree, so it may be created under any node that can hold one.
  const canCreateFlow = nodeKind === "aspect" || nodeKind === "domain" || nodeKind === "project" || nodeKind === "goal";
  const isFlow = nodeKind === "flow";
  const canConvertToFlow = canConvertNodeToFlow(nodeKind, parentKind);

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
      <div className={styles.separator} />
      {item(t("cut"), "cut")}
      {item(t("copy"), "copy")}
      {item(t("pasteAsChild"), "paste", !hasClipboard)}
      <div className={styles.separator} />
      {item(isCollapsed ? t("expand") : t("collapse"), isCollapsed ? "expand" : "collapse")}
      {(canCreateFlow || canConvertToFlow || isFlow) && <div className={styles.separator} />}
      {canCreateFlow && item(t("newFlow"), "new-flow")}
      {canConvertToFlow && item(t("convertToFlow"), "convert-to-flow")}
      {isFlow && item(t("startFlow"), "start-flow")}
      <div className={styles.separator} />
      {archive !== null && item(t(archive), "archive")}
      {item(t("delete"), "delete")}
    </div>
  );
}
