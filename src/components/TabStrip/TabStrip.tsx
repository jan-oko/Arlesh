import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useTabsStore } from "@/stores/use-tabs-store";
import { useTabCommands } from "@/hooks/use-tab-commands";
import { useTabRename } from "@/hooks/use-tab-rename";
import { useBoardWindows } from "@/hooks/use-board-windows";
import { useInputCapture } from "@/hooks/use-input-capture";
import { tabLabel } from "@/utils/tab-label";
import { tabDrop } from "@/utils/tab-drag";
import type { DropTarget } from "@/utils/tab-drag";
import { windowAtCursor } from "@/api/window";
import { currentWindowLabel } from "@/api/window-label";
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
 *
 * A drag **inside** the strip reorders. A drag that ends **outside** it is decided by where the
 * pointer was let go: over another window the tab moves into it, over the desktop it becomes a
 * window of its own. Drag-out and drag-back are one gesture, in both directions.
 *
 * The target cannot come from the drag itself — HTML drag-and-drop is per-webview and the other
 * window never hears about it — so it is resolved by geometry on the backend. `utils/tab-drag`
 * holds what to do with the answer, and the menu offers the same two moves for anyone who would
 * rather not drag.
 */
export default function TabStrip() {
  const { t } = useTranslation(["common"]);
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const activateTab = useTabsStore((s) => s.activateTab);
  const moveTab = useTabsStore((s) => s.moveTab);
  const { openTab, closeTab, tearOffTab, moveTabToWindow } = useTabCommands();
  const { editingId, start, commit, cancel } = useTabRename();
  const { windows, refresh: refreshWindows } = useBoardWindows();
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [menuAt, setMenuAt] = useState<MenuAt | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Whether the drag now ending was taken by the strip. A drop is a reorder and has already
  // happened; anything else that ends outside the strip is a tear-off. See `utils/tab-drag`.
  const droppedOnStrip = useRef(false);

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
    droppedOnStrip.current = true;
    if (draggingIndex !== null) moveTab(draggingIndex, toIndex);
    setDraggingIndex(null);
  }

  /**
   * The end of a drag: a reorder the strip already made, a move into another window, a tear-off,
   * or nothing.
   *
   * Which of those it is depends on where the pointer was let go, and only the backend can say —
   * an HTML drag never reaches another window. So the answer is asked for here and read by
   * `tabDrop`, which is where the decision lives.
   */
  function endDrag(tabId: string) {
    const onStrip = droppedOnStrip.current;
    droppedOnStrip.current = false;
    setDraggingIndex(null);
    // A reorder is already done and needs nothing asked of anybody.
    if (onStrip) return;

    void windowAtCursor()
      .catch((): DropTarget => undefined)
      .then((target) => {
        const drop = tabDrop(target, currentWindowLabel(), false);
        if (drop.kind === "move") moveTabToWindow(tabId, drop.label);
        if (drop.kind === "tearOff") tearOffTab(tabId);
      });
  }

  /** Opens the tab menu, having asked which other windows there are to offer. */
  function openMenu(at: MenuAt) {
    refreshWindows();
    setMenuAt(at);
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
            onDragStart={() => { droppedOnStrip.current = false; setDraggingIndex(index); }}
            onDragEnd={() => endDrag(tab.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); drop(index); }}
            onAuxClick={(e) => { if (e.button === MIDDLE_BUTTON) { e.preventDefault(); closeTab(tab.id); } }}
            onContextMenu={(e) => { e.preventDefault(); openMenu({ tabId: tab.id, x: e.clientX, y: e.clientY }); }}
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
          // Tearing off the only tab would move the window rather than divide it, so the entry is
          // absent rather than present and inert.
          onTearOff={tabs.length > 1 ? () => tearOffTab(menuAt.tabId) : null}
          windows={windows}
          onMoveToWindow={(label) => moveTabToWindow(menuAt.tabId, label)}
          onCloseTab={() => closeTab(menuAt.tabId)}
          onDismiss={() => setMenuAt(null)}
        />,
        document.body,
      )}
    </div>
  );
}
