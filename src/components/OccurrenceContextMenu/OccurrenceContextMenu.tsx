import { Fragment, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { OccurrenceMenuAction, OccurrenceMenuEntry } from "@/utils/occurrence-menu";
import styles from "@/components/NodeContextMenu/NodeContextMenu.module.css";

interface Props {
  x: number;
  y: number;
  /** The entries that apply to this occurrence, from `occurrenceMenuEntries`. */
  entries: OccurrenceMenuEntry[];
  onAction: (action: OccurrenceMenuAction) => void;
  onClose: () => void;
}

/**
 * The context menu of a virtual Habit node, drawn like the ordinary node menu but offering only
 * what applies to an occurrence — nothing is shown disabled for being impossible.
 */
export default function OccurrenceContextMenu({ x, y, entries, onAction, onClose }: Props) {
  const { t } = useTranslation("contextMenu");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target;
      if (ref.current !== null && target instanceof Node && !ref.current.contains(target)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  function label(action: OccurrenceMenuAction): string {
    switch (action) {
      case "edit": return t("occurrence.edit");
      case "plan": return t("occurrence.plan");
      case "follow-cycle-plan": return t("occurrence.followCyclePlan");
      case "unplan": return t("occurrence.unplan");
      case "delete": return t("occurrence.delete");
      case "restore": return t("occurrence.restore");
      case "collapse": return t("collapse");
      case "expand": return t("expand");
      case "status:todo": return t("occurrence.status.todo");
      case "status:in_progress": return t("occurrence.status.in_progress");
      case "status:done": return t("occurrence.status.done");
      case "status:active": return t("occurrence.status.active");
      case "status:achieved": return t("occurrence.status.achieved");
    }
  }

  return (
    <div ref={ref} className={styles.menu} style={{ left: x, top: y }} role="menu">
      {entries.map((entry, index) => (
        <Fragment key={entry.action}>
          {index > 0 && entries[index - 1]?.group !== entry.group && <div className={styles.separator} />}
          <button
            className={styles.item}
            type="button"
            role="menuitem"
            onClick={() => { onAction(entry.action); onClose(); }}
          >
            {label(entry.action)}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
