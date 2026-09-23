import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useTabsStore } from "@/stores/use-tabs-store";
import { useTabCommands } from "@/hooks/use-tab-commands";
import { useTabRename } from "@/hooks/use-tab-rename";
import { useBoardWindows } from "@/hooks/use-board-windows";
import { useInputCapture } from "@/hooks/use-input-capture";
import { tabLabel } from "@/utils/tab-label";
import { useTabClaims, useTabDropTarget, claimDropped } from "@/hooks/use-tab-drop-target";
import { carriesTab, encodeTabDrag, TAB_DRAG_TYPE } from "@/utils/tab-drag";
import { useTabTearOff } from "@/hooks/use-tab-tear-off";
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
 * A drag **inside** the strip reorders. Dropped anywhere on **another** Arlesh window, the tab moves
 * into it; dropped where no Arlesh window takes it, it becomes a window of its own. Drag-out and
 * drag-back are one gesture, in both directions. The desktop carries the drag between windows, and
 * the drag carries which tab it is — see `utils/tab-drag` — and the menu offers the same two moves
 * for anyone who would rather not drag.
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

  // Every window takes a dragged tab anywhere on it, and hands over the tabs other windows take.
  // A tab dragged out that neither this window nor another took becomes a window of its own.
  const tearOff = useTabTearOff(tearOffTab);
  useTabDropTarget(tearOff.landedHere);
  const handOver = useCallback(
    (tabId: string, into: string) => {
      tearOff.claimed(tabId);
      moveTabToWindow(tabId, into);
    },
    [tearOff, moveTabToWindow],
  );
  useTabClaims(handOver);

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

  /** Starts a tab's drag, carrying which tab it is and which window it is leaving. */
  function startDrag(event: React.DragEvent, tabId: string, index: number) {
    event.dataTransfer.setData(TAB_DRAG_TYPE, encodeTabDrag({ tabId, window: currentWindowLabel() }));
    event.dataTransfer.effectAllowed = "move";
    tearOff.started();
    setDraggingIndex(index);
  }

  /** Accepts a dragged tab over a tab, so that the drop lands there. */
  function acceptDrag(event: React.DragEvent) {
    if (!carriesTab([...event.dataTransfer.types])) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  /**
   * A tab dropped on a tab: this window's own is a reorder, another window's is asked for.
   *
   * The tab is found by the id the drag carries rather than by the index the drag started from,
   * because only a drag that began here has an index here.
   */
  function drop(event: React.DragEvent, toIndex: number) {
    if (!carriesTab([...event.dataTransfer.types])) return;
    event.preventDefault();
    const dropped = claimDropped(event.dataTransfer.getData(TAB_DRAG_TYPE));
    if (dropped.kind === "own") {
      tearOff.landedHere();
      const fromIndex = tabs.findIndex((tab) => tab.id === dropped.tabId);
      if (fromIndex !== -1) moveTab(fromIndex, toIndex);
    }
    setDraggingIndex(null);
  }

  /**
   * The end of a tab's drag, from the window it left.
   *
   * A drop on this window has been dealt with, and a drop on another reaches this window as that
   * window's claim. Anything else becomes a window of its own — see `useTabTearOff` for why this is
   * not read off the drag's `dropEffect`.
   */
  function endDrag(tabId: string) {
    setDraggingIndex(null);
    tearOff.ended(tabId);
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
            onDragStart={(e) => startDrag(e, tab.id, index)}
            onDragEnd={() => endDrag(tab.id)}
            onDragOver={acceptDrag}
            onDrop={(e) => drop(e, index)}
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
