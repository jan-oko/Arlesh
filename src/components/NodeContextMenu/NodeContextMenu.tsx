import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { NodeKind } from "@/utils/tree-layout";
import type { InstanceType } from "@/api/flows";
import { validTypesForCycling, typeAcceptsChildren } from "@/utils/node-meta";
import { canConvertNodeToFlow } from "@/utils/mindmap-tree";
import type { ContextMenuAction } from "./context-action";
import styles from "./NodeContextMenu.module.css";

interface Props {
  x: number;
  y: number;
  nodeKind: NodeKind;
  /** Kind of this node's parent (null at the root) — decides whether a flow can be placed here. */
  parentKind?: NodeKind | null;
  /** Distinct kinds of this node's direct children — a target type that can't hold one is not offered. */
  childKinds?: NodeKind[];
  /** For a flow item, its flow's Instance Type: a commitment flow is not offered a goal item. */
  flowInstanceType?: InstanceType;
  isCollapsed: boolean;
  hasClipboard: boolean;
  onAction: (action: ContextMenuAction) => void;
  onClose: () => void;
}

export default function NodeContextMenu({ x, y, nodeKind, parentKind = null, childKinds = [], flowInstanceType, isCollapsed, hasClipboard, onAction, onClose }: Props) {
  const { t } = useTranslation(["contextMenu", "nodeKinds"]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const canEnter = nodeKind !== "task" && nodeKind !== "goal" && nodeKind !== "tag";
  // The kinds this node can be set to: its valid cycle types (minus its current kind), excluding any
  // that couldn't hold the node's existing children.
  const typeOptions = validTypesForCycling(nodeKind, parentKind, flowInstanceType)
    .filter((k) => k !== nodeKind && typeAcceptsChildren(k, childKinds));
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
      {typeOptions.length > 0 && (
        <div className={styles.submenuItem}>
          <button className={`${styles.item} ${styles.submenuLabel}`} type="button">
            {t("setType")}<span className={styles.chevron}>›</span>
          </button>
          <div className={styles.submenu}>
            {typeOptions.map((k) => (
              <button key={k} className={styles.item} type="button" onClick={() => { onAction(`set-type:${k}`); onClose(); }}>
                {t(`nodeKinds:${k}`)}
              </button>
            ))}
          </div>
        </div>
      )}
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
      {item(t("delete"), "delete")}
    </div>
  );
}
