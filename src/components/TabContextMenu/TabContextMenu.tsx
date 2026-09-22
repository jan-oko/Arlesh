import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { BoardWindow } from "@/hooks/use-board-windows";
import styles from "./TabContextMenu.module.css";

interface Props {
  x: number;
  y: number;
  onRename: () => void;
  /** Closes the tab — the same action the strip's × performs, last tab included. */
  onCloseTab: () => void;
  /** Takes the tab out into a window of its own; absent when this tab is the window's only one. */
  onTearOff: (() => void) | null;
  /** The other open windows this tab could be moved into. Empty when there is only this one. */
  windows: BoardWindow[];
  onMoveToWindow: (label: string) => void;
  /** Dismisses the menu without acting. */
  onDismiss: () => void;
}

/**
 * The right-click menu on a tab in the strip.
 *
 * It is also where a tab leaves this window, in either direction: into a window of its own, or
 * into one that is already open. Dragging does the same two things — where the pointer is let go
 * decides which — so this is the alternative for anyone who would rather not drag, not the only
 * route.
 *
 * Naming the windows is the one thing a drag cannot do. A drag shows you where you are dropping;
 * this tells you which window you are choosing before you commit to it, which is what you want
 * when the one you mean is behind another.
 *
 * Deliberately not `NodeContextMenu`: that menu's props are a node — its kind, its parent's kind,
 * its children's kinds, the clipboard — and every branch in it answers a question a tab cannot be
 * asked. Sharing it would mean making all of that optional and giving a tab a menu whose type says
 * it might offer "Paste as child". Two small menus are cheaper than one that fits neither.
 */
export default function TabContextMenu({
  x, y, onRename, onCloseTab, onTearOff, windows, onMoveToWindow, onDismiss,
}: Props) {
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
      {onTearOff !== null && (
        <button
          type="button"
          role="menuitem"
          className={styles.item}
          onClick={() => { onDismiss(); onTearOff(); }}
        >
          {t("common:tearOffTab")}
        </button>
      )}
      {/* One entry per other window, named by what its strip shows. A submenu would be a second
          layer of navigation for a list that is almost always one item long. */}
      {windows.map((window) => (
        <button
          key={window.label}
          type="button"
          role="menuitem"
          className={styles.item}
          onClick={() => { onDismiss(); onMoveToWindow(window.label); }}
        >
          {t("common:moveTabToWindow", { name: window.name })}
        </button>
      ))}
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
