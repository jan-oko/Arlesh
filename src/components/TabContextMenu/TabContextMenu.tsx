import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import styles from "./TabContextMenu.module.css";

interface Props {
  x: number;
  y: number;
  onRename: () => void;
  /** Closes the tab — the same action the strip's × performs, last tab included. */
  onCloseTab: () => void;
  /** Dismisses the menu without acting. */
  onDismiss: () => void;
}

/**
 * The right-click menu on a tab in the strip.
 *
 * Deliberately not `NodeContextMenu`: that menu's props are a node — its kind, its parent's kind,
 * its children's kinds, the clipboard — and every branch in it answers a question a tab cannot be
 * asked. Sharing it would mean making all of that optional and giving a tab a menu whose type says
 * it might offer "Paste as child". Two small menus are cheaper than one that fits neither.
 */
export default function TabContextMenu({ x, y, onRename, onCloseTab, onDismiss }: Props) {
  const { t } = useTranslation(["common"]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const clickAway = (event: MouseEvent) => {
      if (ref.current !== null && !ref.current.contains(event.target instanceof Node ? event.target : null)) {
        onDismiss();
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    document.addEventListener("mousedown", clickAway);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", clickAway);
      document.removeEventListener("keydown", escape);
    };
  }, [onDismiss]);

  return (
    <div ref={ref} className={styles.menu} style={{ left: x, top: y }} role="menu" aria-label={t("common:tabActions")}>
      <button
        type="button"
        role="menuitem"
        className={styles.item}
        onClick={() => { onDismiss(); onRename(); }}
      >
        {t("common:renameTab")}
      </button>
      <button
        type="button"
        role="menuitem"
        className={styles.item}
        onClick={() => { onDismiss(); onCloseTab(); }}
      >
        {t("common:closeTab")}
      </button>
    </div>
  );
}
