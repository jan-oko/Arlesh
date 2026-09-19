import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useTabsStore } from "@/stores/use-tabs-store";
import { useTabCommands } from "@/hooks/use-tab-commands";
import { useTabRename } from "@/hooks/use-tab-rename";
import { useInputCapture } from "@/hooks/use-input-capture";
import { tabLabel } from "@/utils/tab-label";
import TabContextMenu from "@/components/TabContextMenu/TabContextMenu";
import styles from "./TabStrip.module.css";

const ADD_ICON = "+";
const CLOSE_ICON = "×";
/** The mouse button that closes a tab, per the browser convention. */
const MIDDLE_BUTTON = 1;

/** Where a right-click landed, and on which tab. */
interface MenuAt {
  tabId: string;
  x: number;
  y: number;
}

/**
 * The open tabs, above the top bar.
 *
 * A tab is labelled by the subtree it is rooted at, unless it has been given a name — right-click
 * for that — in which case the name wins and the derived label keeps being maintained underneath
 * it. One showing the whole tree is labelled for that rather than left nameless. Closing is offered
 * three times — an ×, a middle-click and the menu — because each is a gesture somebody already has.
 */
export default function TabStrip() {
  const { t } = useTranslation(["common"]);
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const activateTab = useTabsStore((s) => s.activateTab);
  const moveTab = useTabsStore((s) => s.moveTab);
  const { openTab, closeTab } = useTabCommands();
  const { editingId, start, commit, cancel } = useTabRename();
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [menuAt, setMenuAt] = useState<MenuAt | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // A rename is a text field in the strip, so the app's own single-key bindings must stand down
  // while it is open — the same contract the Mindmap's inline title editor honours.
  useInputCapture(editingId !== null);

  useEffect(() => {
    if (editingId === null) return;
    const id = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => clearTimeout(id);
  }, [editingId]);

  function drop(toIndex: number) {
    if (draggingIndex !== null) moveTab(draggingIndex, toIndex);
    setDraggingIndex(null);
  }

  const wholeTree = t("common:tabWholeTree");

  return (
    <div className={styles.strip} role="tablist" aria-label={t("common:tabs")}>
      {tabs.map((tab, index) => {
        const label = tabLabel(tab, wholeTree);
        return (
          <div
            key={tab.id}
            className={`${styles.tab}${tab.id === activeTabId ? ` ${styles.tabActive}` : ""}${draggingIndex === index ? ` ${styles.tabDragging}` : ""}`}
            draggable={editingId !== tab.id}
            onDragStart={() => setDraggingIndex(index)}
            onDragEnd={() => setDraggingIndex(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); drop(index); }}
            onAuxClick={(e) => { if (e.button === MIDDLE_BUTTON) { e.preventDefault(); closeTab(tab.id); } }}
            onContextMenu={(e) => { e.preventDefault(); setMenuAt({ tabId: tab.id, x: e.clientX, y: e.clientY }); }}
          >
            {editingId === tab.id ? (
              <input
                ref={inputRef}
                className={styles.rename}
                aria-label={t("common:tabName")}
                // Empty is a real answer — it is how the name comes off — so the derived label shows
                // as the placeholder: what an empty field would give you back is on screen.
                defaultValue={tab.customTitle ?? tab.title ?? ""}
                placeholder={tab.title ?? wholeTree}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); commit(tab.id, e.currentTarget.value); }
                  if (e.key === "Escape") { e.stopPropagation(); cancel(); }
                }}
                onBlur={(e) => commit(tab.id, e.currentTarget.value)}
                dir="auto"
              />
            ) : (
              <button
                type="button"
                role="tab"
                aria-selected={tab.id === activeTabId}
                className={styles.label}
                title={label}
                onClick={() => activateTab(tab.id)}
              >
                {label}
              </button>
            )}
            <button
              type="button"
              className={styles.close}
              aria-label={t("common:closeTab")}
              onClick={() => closeTab(tab.id)}
            >
              <span aria-hidden="true">{CLOSE_ICON}</span>
            </button>
          </div>
        );
      })}
      <button type="button" className={styles.add} aria-label={t("common:newTab")} onClick={openTab}>
        <span aria-hidden="true">{ADD_ICON}</span>
      </button>
      {menuAt !== null && createPortal(
        <TabContextMenu
          x={menuAt.x}
          y={menuAt.y}
          onRename={() => start(menuAt.tabId)}
          onCloseTab={() => closeTab(menuAt.tabId)}
          onDismiss={() => setMenuAt(null)}
        />,
        document.body,
      )}
    </div>
  );
}
